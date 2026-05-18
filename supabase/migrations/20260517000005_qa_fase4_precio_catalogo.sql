-- QA Campaña — Fase 4: precio server-authoritative (hallazgo F4-05)
--
-- `fn_registrar_venta` y `fn_registrar_cotizacion` tomaban `precio_unitario`
-- del payload del cliente, sin validarlo contra el catálogo. Un vendedor con
-- la consola del navegador podía registrar una venta con `precio_unitario: 1`.
--
-- Decisión del cliente: el precio SIEMPRE sale del catálogo (`productos
-- .precio_venta`); la negociación se hace con `descuento_pct` (ya topado a
-- 0-100% por constraint). Por eso ambas funciones ahora IGNORAN el precio que
-- manda el cliente y leen el del producto.

-- ── fn_registrar_venta ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_registrar_venta(
  p_sede_id text,
  p_cliente_nombre text DEFAULT NULL,
  p_cliente_nit text DEFAULT NULL,
  p_metodo_pago text DEFAULT 'Efectivo',
  p_descuento_pct numeric DEFAULT 0,
  p_observaciones text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vendedor_id UUID;
  v_mi_sede     TEXT;
  v_mi_rol      TEXT;
  v_venta_id    UUID;
  v_numero      INT;
  item          JSONB;
  v_prod_id     UUID;
  v_cantidad    NUMERIC;
  v_precio      NUMERIC;
  v_costo       NUMERIC;
BEGIN
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta debe tener al menos un ítem';
  END IF;

  v_vendedor_id := auth.uid();
  IF v_vendedor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT sede_id, rol::TEXT INTO v_mi_sede, v_mi_rol
    FROM usuarios WHERE id = v_vendedor_id;

  IF v_mi_rol <> 'Admin' AND v_mi_sede <> p_sede_id THEN
    RAISE EXCEPTION
      'No tienes permiso para vender en esta sede. Tu sede es %, la sede solicitada es %',
      v_mi_sede, p_sede_id;
  END IF;

  INSERT INTO ventas (
    vendedor_id, sede_id, cliente_nombre, cliente_nit,
    metodo_pago, descuento_pct, iva_pct, observaciones, subtotal, total
  ) VALUES (
    v_vendedor_id, p_sede_id, p_cliente_nombre, p_cliente_nit,
    p_metodo_pago, p_descuento_pct, 19, p_observaciones, 0, 0
  )
  RETURNING id, numero INTO v_venta_id, v_numero;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id  := (item->>'producto_id')::UUID;
    v_cantidad := (item->>'cantidad')::NUMERIC;

    IF v_cantidad IS NULL OR v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida para el producto %', v_prod_id;
    END IF;

    -- Precio SIEMPRE del catálogo (server-authoritative). El precio que
    -- manda el cliente se ignora; la negociación se hace con descuento_pct.
    SELECT precio_venta, COALESCE(costo_promedio, 0)
      INTO v_precio, v_costo
      FROM productos WHERE id = v_prod_id AND activo = true;

    IF v_precio IS NULL THEN
      RAISE EXCEPTION 'Producto % no encontrado o inactivo', v_prod_id;
    END IF;

    INSERT INTO detalle_venta (
      venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal
    ) VALUES (
      v_venta_id, v_prod_id, v_cantidad, v_precio, v_costo, v_cantidad * v_precio
    );
  END LOOP;

  RETURN (
    SELECT jsonb_build_object(
      'venta_id', v.id, 'numero', v.numero, 'total', v.total, 'fecha', v.fecha
    ) FROM ventas v WHERE v.id = v_venta_id
  );
END;
$function$;

-- ── fn_registrar_cotizacion ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_registrar_cotizacion(
  p_sede_id text,
  p_cliente_nombre text DEFAULT NULL,
  p_cliente_nit text DEFAULT NULL,
  p_cliente_email text DEFAULT NULL,
  p_cliente_telefono text DEFAULT NULL,
  p_descuento_pct numeric DEFAULT 0,
  p_vigencia_dias integer DEFAULT NULL,
  p_iva_pct numeric DEFAULT NULL,
  p_observaciones text DEFAULT NULL,
  p_condiciones_pago text DEFAULT NULL,
  p_tiempo_entrega_nota text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_cuentas_ids bigint[] DEFAULT '{}'::bigint[],
  p_ot_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_vendedor_id UUID; v_cot_id UUID; v_numero INT;
  v_subtotal NUMERIC := 0; v_total NUMERIC;
  v_iva NUMERIC; v_validez INT;
  v_my_rol TEXT; v_my_sede TEXT;
  v_ot_sede TEXT;
  item JSONB; v_item_sub NUMERIC;
  v_precio_cat NUMERIC; v_prod_id UUID; v_cant NUMERIC;
  v_cuenta_id BIGINT;
BEGIN
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La cotización debe tener al menos un ítem';
  END IF;
  v_vendedor_id := auth.uid();
  IF v_vendedor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  v_my_rol := get_my_rol();
  v_my_sede := get_my_sede_id();
  IF v_my_rol <> 'Admin' AND p_sede_id IS DISTINCT FROM v_my_sede THEN
    RAISE EXCEPTION 'No puedes crear cotización en una sede distinta a la tuya';
  END IF;

  IF p_ot_id IS NOT NULL THEN
    SELECT sede_id INTO v_ot_sede FROM ordenes_servicio WHERE id = p_ot_id;
    IF v_ot_sede IS NULL THEN
      RAISE EXCEPTION 'OT vinculada no existe (id %)', p_ot_id;
    END IF;
    IF v_my_rol <> 'Admin' AND v_ot_sede <> v_my_sede THEN
      RAISE EXCEPTION 'No puedes vincular cotización a una OT de otra sede';
    END IF;
  END IF;

  v_iva := COALESCE(p_iva_pct, NULLIF(fn_get_parametro('iva_pct'),'')::NUMERIC, 19);
  v_validez := COALESCE(p_vigencia_dias, NULLIF(fn_get_parametro('validez_cotizacion_dias'),'')::INT, 15);

  IF v_iva < 0 OR v_iva > 100 THEN
    RAISE EXCEPTION 'iva_pct debe estar entre 0 y 100 (recibido %)', v_iva;
  END IF;
  IF v_validez < 1 OR v_validez > 365 THEN
    RAISE EXCEPTION 'vigencia_dias debe estar entre 1 y 365 (recibido %)', v_validez;
  END IF;
  IF p_descuento_pct < 0 OR p_descuento_pct > 100 THEN
    RAISE EXCEPTION 'descuento_pct debe estar entre 0 y 100';
  END IF;

  -- Subtotal — el precio SIEMPRE sale del catálogo (server-authoritative);
  -- el `precio_unitario` que manda el cliente se ignora.
  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_prod_id := (item->>'producto_id')::UUID;
    v_cant    := (item->>'cantidad')::NUMERIC;
    IF v_cant IS NULL OR v_cant <= 0 THEN
      RAISE EXCEPTION 'Cantidad de ítem debe ser > 0';
    END IF;
    SELECT precio_venta INTO v_precio_cat
      FROM productos WHERE id = v_prod_id AND activo = true;
    IF v_precio_cat IS NULL THEN
      RAISE EXCEPTION 'Producto % no encontrado o inactivo', v_prod_id;
    END IF;
    v_subtotal := v_subtotal + v_cant * v_precio_cat;
  END LOOP;
  v_total := v_subtotal * (1 - p_descuento_pct/100) * (1 + v_iva/100);

  INSERT INTO cotizaciones (
    vendedor_id, sede_id, cliente_nombre, cliente_nit, cliente_email, cliente_telefono,
    descuento_pct, iva_pct, vigencia_dias, subtotal, total, estado,
    observaciones, condiciones_pago, tiempo_entrega_nota, ot_id
  ) VALUES (
    v_vendedor_id, p_sede_id, p_cliente_nombre, p_cliente_nit, p_cliente_email, p_cliente_telefono,
    p_descuento_pct, v_iva, v_validez, v_subtotal, v_total, 'borrador',
    p_observaciones, p_condiciones_pago, p_tiempo_entrega_nota, p_ot_id
  ) RETURNING id, numero INTO v_cot_id, v_numero;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_prod_id := (item->>'producto_id')::UUID;
    v_cant    := (item->>'cantidad')::NUMERIC;
    SELECT precio_venta INTO v_precio_cat FROM productos WHERE id = v_prod_id;
    v_item_sub := v_cant * v_precio_cat;
    INSERT INTO detalle_cotizacion (cotizacion_id, producto_id, cantidad, precio_unitario, subtotal)
    VALUES (v_cot_id, v_prod_id, v_cant, v_precio_cat, v_item_sub);
  END LOOP;

  IF array_length(p_cuentas_ids, 1) > 0 THEN
    FOREACH v_cuenta_id IN ARRAY p_cuentas_ids LOOP
      INSERT INTO cotizacion_cuentas_bancarias (cotizacion_id, cuenta_id)
      VALUES (v_cot_id, v_cuenta_id) ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('cotizacion_id', v_cot_id, 'numero', v_numero, 'total', v_total);
END;
$function$;
