-- QA Campaña — Fase 11 (Ajustes Cotizaciones) — hallazgo F11-03
--
-- El stress test de `fn_editar_cotizacion` reveló que `cotizaciones.cliente_nombre`
-- es NOT NULL, pero ni los formularios ni el RPC exigían el nombre del cliente.
-- Editar/registrar una cotización con `cliente_nombre` vacío → crash 23502
-- (null value in column "cliente_nombre" violates not-null constraint).
--
-- Solución: validar server-side que el nombre no sea NULL ni vacío, y guardar
-- el valor con TRIM para no aceptar solo-espacios.

CREATE OR REPLACE FUNCTION public.fn_editar_cotizacion(
  p_cotizacion_id uuid,
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
  p_cuentas_ids bigint[] DEFAULT '{}'::bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       UUID;
  v_my_rol    TEXT;
  v_my_sede   TEXT;
  v_estado    TEXT;
  v_sede      TEXT;
  v_venta_id  UUID;
  v_iva       NUMERIC;
  v_validez   INT;
  v_subtotal  NUMERIC := 0;
  v_total     NUMERIC;
  item        JSONB;
  v_prod_id   UUID;
  v_cant      NUMERIC;
  v_precio    NUMERIC;
  v_cuenta_id BIGINT;
BEGIN
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La cotización debe tener al menos un ítem';
  END IF;
  IF p_cliente_nombre IS NULL OR TRIM(p_cliente_nombre) = '' THEN
    RAISE EXCEPTION 'El nombre del cliente es obligatorio';
  END IF;
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  v_my_rol  := get_my_rol();
  v_my_sede := get_my_sede_id();

  SELECT estado::TEXT, sede_id, venta_id
    INTO v_estado, v_sede, v_venta_id
    FROM cotizaciones WHERE id = p_cotizacion_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotización no encontrada';
  END IF;

  IF v_my_rol <> 'Admin' AND v_sede IS DISTINCT FROM v_my_sede THEN
    RAISE EXCEPTION 'No puedes editar una cotización de otra sede';
  END IF;
  IF v_venta_id IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede editar una cotización ya convertida en venta';
  END IF;
  IF v_estado NOT IN ('borrador', 'enviada', 'rechazada') THEN
    RAISE EXCEPTION 'No se puede editar una cotización en estado %', v_estado;
  END IF;

  v_iva := COALESCE(p_iva_pct, NULLIF(fn_get_parametro('iva_pct'), '')::NUMERIC, 19);
  v_validez := COALESCE(p_vigencia_dias, NULLIF(fn_get_parametro('validez_cotizacion_dias'), '')::INT, 15);
  IF v_iva < 0 OR v_iva > 100 THEN
    RAISE EXCEPTION 'iva_pct debe estar entre 0 y 100 (recibido %)', v_iva;
  END IF;
  IF v_validez < 1 OR v_validez > 365 THEN
    RAISE EXCEPTION 'vigencia_dias debe estar entre 1 y 365 (recibido %)', v_validez;
  END IF;
  IF p_descuento_pct < 0 OR p_descuento_pct > 100 THEN
    RAISE EXCEPTION 'descuento_pct debe estar entre 0 y 100';
  END IF;

  -- Subtotal server-authoritative: el precio sale del catálogo, no del cliente.
  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_prod_id := (item->>'producto_id')::UUID;
    v_cant    := (item->>'cantidad')::NUMERIC;
    IF v_cant IS NULL OR v_cant <= 0 THEN
      RAISE EXCEPTION 'Cantidad de ítem debe ser > 0';
    END IF;
    SELECT precio_venta INTO v_precio
      FROM productos WHERE id = v_prod_id AND activo = true;
    IF v_precio IS NULL THEN
      RAISE EXCEPTION 'Producto % no encontrado o inactivo', v_prod_id;
    END IF;
    v_subtotal := v_subtotal + v_cant * v_precio;
  END LOOP;
  v_total := v_subtotal * (1 - p_descuento_pct / 100) * (1 + v_iva / 100);

  UPDATE cotizaciones SET
    cliente_nombre      = TRIM(p_cliente_nombre),
    cliente_nit         = p_cliente_nit,
    cliente_email       = p_cliente_email,
    cliente_telefono    = p_cliente_telefono,
    descuento_pct       = p_descuento_pct,
    iva_pct             = v_iva,
    vigencia_dias       = v_validez,
    subtotal            = v_subtotal,
    total               = v_total,
    estado              = 'borrador',
    observaciones       = p_observaciones,
    condiciones_pago    = p_condiciones_pago,
    tiempo_entrega_nota = p_tiempo_entrega_nota
  WHERE id = p_cotizacion_id;

  DELETE FROM detalle_cotizacion WHERE cotizacion_id = p_cotizacion_id;
  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_prod_id := (item->>'producto_id')::UUID;
    v_cant    := (item->>'cantidad')::NUMERIC;
    SELECT precio_venta INTO v_precio FROM productos WHERE id = v_prod_id;
    INSERT INTO detalle_cotizacion (cotizacion_id, producto_id, cantidad, precio_unitario, subtotal)
    VALUES (p_cotizacion_id, v_prod_id, v_cant, v_precio, v_cant * v_precio);
  END LOOP;

  -- Sincronizar cuentas bancarias del PDF (atómico con el resto)
  DELETE FROM cotizacion_cuentas_bancarias WHERE cotizacion_id = p_cotizacion_id;
  IF array_length(p_cuentas_ids, 1) > 0 THEN
    FOREACH v_cuenta_id IN ARRAY p_cuentas_ids LOOP
      INSERT INTO cotizacion_cuentas_bancarias (cotizacion_id, cuenta_id)
      VALUES (p_cotizacion_id, v_cuenta_id) ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'cotizacion_id', p_cotizacion_id,
    'subtotal', v_subtotal, 'total', v_total
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_editar_cotizacion(uuid,text,text,text,text,numeric,integer,numeric,text,text,text,jsonb,bigint[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_editar_cotizacion(uuid,text,text,text,text,numeric,integer,numeric,text,text,text,jsonb,bigint[]) TO authenticated;
