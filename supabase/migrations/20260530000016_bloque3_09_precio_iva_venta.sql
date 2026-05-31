-- ============================================================================
-- Bloque 3 — #9: Editar PRECIO de venta e IMPUESTO (IVA) durante la venta.
--
-- Antes: fn_registrar_venta IGNORABA el precio que enviaba el frontend (usaba
-- siempre productos.precio_venta) y guardaba iva_pct = 19 HARDCODEADO.
--
-- Ahora:
--   - Acepta `p_iva_pct` (IVA por venta; 0 = exento, 19 = estándar, u otro).
--     Se valida/clampa a [0, 100]. El total se recalcula solo vía
--     trg_recalcular_total_venta (usa ventas.iva_pct).
--   - Por cada ítem, usa el `precio_unitario` que envía el front si viene y es
--     válido (>= 0); si no, cae al precio de catálogo (precio_venta).
--   - El COSTO sigue saliendo del catálogo (costo_promedio) para no falsear el
--     margen — el operario edita el precio de venta, no el costo.
--
-- Se mantiene intacto: gate de rol (Admin/Vendedor) y bloqueo de sede
-- (el vendedor vende solo desde su propia sede).
--
-- Cambio de firma (se agrega p_iva_pct) → se DROP+CREATE para no dejar una
-- versión sobrecargada que confunda a PostgREST. p_iva_pct tiene DEFAULT 19,
-- así que las llamadas viejas (sin ese parámetro) siguen funcionando.
-- ============================================================================

DROP FUNCTION IF EXISTS public.fn_registrar_venta(text, text, text, text, numeric, text, jsonb);

CREATE OR REPLACE FUNCTION public.fn_registrar_venta(
  p_sede_id text,
  p_cliente_nombre text DEFAULT NULL::text,
  p_cliente_nit text DEFAULT NULL::text,
  p_metodo_pago text DEFAULT 'Efectivo'::text,
  p_descuento_pct numeric DEFAULT 0,
  p_observaciones text DEFAULT NULL::text,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_iva_pct numeric DEFAULT 19
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vendedor_id   UUID;
  v_mi_sede       TEXT;
  v_mi_rol        TEXT;
  v_venta_id      UUID;
  v_numero        INT;
  v_iva           NUMERIC;
  item            JSONB;
  v_prod_id       UUID;
  v_cantidad      NUMERIC;
  v_precio        NUMERIC;
  v_precio_cat    NUMERIC;
  v_precio_in     NUMERIC;
  v_costo         NUMERIC;
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

  -- Gate de rol: solo Admin/Vendedor registran ventas.
  IF v_mi_rol IS NULL OR v_mi_rol NOT IN ('Admin', 'Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar ventas (rol %)', COALESCE(v_mi_rol, 'desconocido');
  END IF;

  -- Corrección #3: el Vendedor vende SOLO desde su propia sede (Admin, cualquiera).
  IF v_mi_rol <> 'Admin' AND v_mi_sede IS DISTINCT FROM p_sede_id THEN
    RAISE EXCEPTION 'No puedes vender desde otra sede. Tu sede es %, la sede solicitada es %', v_mi_sede, p_sede_id;
  END IF;

  -- #9: IVA por venta, validado y clampado a [0, 100] (0 = exento).
  v_iva := GREATEST(0, LEAST(100, COALESCE(p_iva_pct, 19)));

  INSERT INTO ventas (
    vendedor_id, sede_id, cliente_nombre, cliente_nit,
    metodo_pago, descuento_pct, iva_pct, observaciones, subtotal, total
  ) VALUES (
    v_vendedor_id, p_sede_id, p_cliente_nombre, p_cliente_nit,
    p_metodo_pago, p_descuento_pct, v_iva, p_observaciones, 0, 0
  )
  RETURNING id, numero INTO v_venta_id, v_numero;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id  := (item->>'producto_id')::UUID;
    v_cantidad := (item->>'cantidad')::NUMERIC;

    IF v_cantidad IS NULL OR v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida para el producto %', v_prod_id;
    END IF;

    -- Precio que envía el front (puede venir null/ausente).
    v_precio_in := NULLIF(item->>'precio_unitario', '')::NUMERIC;

    SELECT precio_venta, COALESCE(costo_promedio, 0)
      INTO v_precio_cat, v_costo
      FROM productos WHERE id = v_prod_id AND activo = true;

    IF v_precio_cat IS NULL THEN
      RAISE EXCEPTION 'Producto % no encontrado o inactivo', v_prod_id;
    END IF;

    -- #9: usar el precio del front si es válido (>= 0); si no, el de catálogo.
    v_precio := CASE
      WHEN v_precio_in IS NOT NULL AND v_precio_in >= 0 THEN v_precio_in
      ELSE v_precio_cat
    END;

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
