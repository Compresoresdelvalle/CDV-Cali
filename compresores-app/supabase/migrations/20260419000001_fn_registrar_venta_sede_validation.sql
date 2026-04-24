-- ============================================================
-- Agrega validación de sede en fn_registrar_venta
-- Usuarios no-Admin solo pueden vender en su propia sede.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_registrar_venta(
  p_sede_id        TEXT,
  p_cliente_nombre TEXT DEFAULT NULL,
  p_cliente_nit    TEXT DEFAULT NULL,
  p_metodo_pago    TEXT DEFAULT 'Efectivo',
  p_descuento_pct  NUMERIC DEFAULT 0,
  p_observaciones  TEXT DEFAULT NULL,
  p_items          JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vendedor_id  UUID;
  v_mi_sede      TEXT;
  v_mi_rol       TEXT;
  v_venta_id     UUID;
  v_numero       INT;
  item           JSONB;
  v_prod_id      UUID;
  v_cantidad     NUMERIC;
  v_precio       NUMERIC;
  v_costo        NUMERIC;
BEGIN
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta debe tener al menos un ítem';
  END IF;

  v_vendedor_id := auth.uid();

  IF v_vendedor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- Validar que el usuario puede vender en la sede solicitada
  SELECT sede_id, rol::TEXT
    INTO v_mi_sede, v_mi_rol
    FROM usuarios
   WHERE id = v_vendedor_id;

  IF v_mi_rol <> 'Admin' AND v_mi_sede <> p_sede_id THEN
    RAISE EXCEPTION
      'No tienes permiso para vender en esta sede. Tu sede es %, la sede solicitada es %',
      v_mi_sede, p_sede_id;
  END IF;

  INSERT INTO ventas (
    vendedor_id, sede_id, cliente_nombre, cliente_nit,
    metodo_pago, descuento_pct, iva_pct, observaciones,
    subtotal, total
  )
  VALUES (
    v_vendedor_id, p_sede_id, p_cliente_nombre, p_cliente_nit,
    p_metodo_pago, p_descuento_pct, 19, p_observaciones,
    0, 0
  )
  RETURNING id, numero INTO v_venta_id, v_numero;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id  := (item->>'producto_id')::UUID;
    v_cantidad := (item->>'cantidad')::NUMERIC;
    v_precio   := (item->>'precio_unitario')::NUMERIC;

    SELECT COALESCE(costo_promedio, 0)
      INTO v_costo
      FROM productos
     WHERE id = v_prod_id;

    INSERT INTO detalle_venta (
      venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal
    )
    VALUES (
      v_venta_id, v_prod_id, v_cantidad, v_precio, v_costo,
      v_cantidad * v_precio
    );
  END LOOP;

  RETURN (
    SELECT jsonb_build_object(
      'venta_id', v.id,
      'numero',   v.numero,
      'total',    v.total,
      'fecha',    v.fecha
    )
    FROM ventas v
    WHERE v.id = v_venta_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_registrar_venta TO authenticated;
