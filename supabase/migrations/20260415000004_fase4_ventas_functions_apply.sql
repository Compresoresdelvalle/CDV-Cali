-- ============================================================
-- FASE 4 APPLY: funciones de ventas y cotizaciones
-- Aplica fn_registrar_venta y fn_registrar_cotizacion (nunca
-- se habían ejecutado en Supabase), y corrige fn_anular_venta
-- que tiene bugs: columna notas→observaciones, tipo ENUM
-- 'ajuste_entrada'→'ajuste', y falta stock_anterior/posterior.
-- ============================================================

-- ------------------------------------------------------------
-- fn_registrar_venta
-- ------------------------------------------------------------
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

  -- Cabecera de venta (subtotal/total se recalcula por trigger trg_recalcular_venta)
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

  -- Insertar cada ítem — trg_venta_descontar_stock descuenta stock por fila
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

-- ------------------------------------------------------------
-- fn_registrar_cotizacion
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_registrar_cotizacion(
  p_sede_id          TEXT,
  p_cliente_nombre   TEXT DEFAULT NULL,
  p_cliente_nit      TEXT DEFAULT NULL,
  p_cliente_email    TEXT DEFAULT NULL,
  p_cliente_telefono TEXT DEFAULT NULL,
  p_descuento_pct    NUMERIC DEFAULT 0,
  p_vigencia_dias    INT DEFAULT 30,
  p_observaciones    TEXT DEFAULT NULL,
  p_items            JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vendedor_id   UUID;
  v_cot_id        UUID;
  v_numero        INT;
  item            JSONB;
  v_subtotal      NUMERIC := 0;
  v_item_sub      NUMERIC;
  v_total         NUMERIC;
BEGIN
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La cotización debe tener al menos un ítem';
  END IF;

  v_vendedor_id := auth.uid();

  IF v_vendedor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_sub := (item->>'cantidad')::NUMERIC * (item->>'precio_unitario')::NUMERIC;
    v_subtotal := v_subtotal + v_item_sub;
  END LOOP;

  v_total := v_subtotal * (1 - p_descuento_pct / 100) * 1.19;

  INSERT INTO cotizaciones (
    vendedor_id, sede_id, cliente_nombre, cliente_nit,
    cliente_email, cliente_telefono,
    descuento_pct, iva_pct, vigencia_dias,
    subtotal, total, estado
  )
  VALUES (
    v_vendedor_id, p_sede_id, p_cliente_nombre, p_cliente_nit,
    p_cliente_email, p_cliente_telefono,
    p_descuento_pct, 19, p_vigencia_dias,
    v_subtotal, v_total, 'borrador'
  )
  RETURNING id, numero INTO v_cot_id, v_numero;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_sub := (item->>'cantidad')::NUMERIC * (item->>'precio_unitario')::NUMERIC;

    INSERT INTO detalle_cotizacion (
      cotizacion_id, producto_id, cantidad, precio_unitario, subtotal
    )
    VALUES (
      v_cot_id,
      (item->>'producto_id')::UUID,
      (item->>'cantidad')::NUMERIC,
      (item->>'precio_unitario')::NUMERIC,
      v_item_sub
    );
  END LOOP;

  RETURN jsonb_build_object(
    'cotizacion_id', v_cot_id,
    'numero',        v_numero,
    'total',         v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_registrar_cotizacion TO authenticated;

-- ------------------------------------------------------------
-- fn_anular_venta — corregida
-- Fixes: 'ajuste_entrada'→'ajuste', notas→observaciones,
--        agrega stock_anterior y stock_posterior (NOT NULL)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_anular_venta(p_venta_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol       TEXT;
  v_anulada   BOOLEAN;
  v_item      detalle_venta%ROWTYPE;
  v_sede_id   TEXT;
  v_stock_ant INTEGER;
  v_stock_post INTEGER;
BEGIN
  SELECT get_my_rol() INTO v_rol;

  IF v_rol <> 'Admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede anular ventas';
  END IF;

  SELECT anulada, sede_id INTO v_anulada, v_sede_id
  FROM ventas WHERE id = p_venta_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;

  IF v_anulada THEN
    RAISE EXCEPTION 'La venta ya fue anulada anteriormente';
  END IF;

  UPDATE ventas SET anulada = TRUE WHERE id = p_venta_id;

  FOR v_item IN
    SELECT * FROM detalle_venta WHERE venta_id = p_venta_id
  LOOP
    -- Capturar stock antes (con lock)
    SELECT cantidad INTO v_stock_ant
    FROM inventario
    WHERE producto_id = v_item.producto_id AND sede_id = v_sede_id
    FOR UPDATE;

    v_stock_post := COALESCE(v_stock_ant, 0) + v_item.cantidad;

    UPDATE inventario
       SET cantidad   = v_stock_post,
           updated_at = NOW()
     WHERE producto_id = v_item.producto_id AND sede_id = v_sede_id;

    INSERT INTO movimientos (
      producto_id, sede_id, tipo, cantidad,
      stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, observaciones
    )
    SELECT
      v_item.producto_id,
      v_sede_id,
      'ajuste',
      v_item.cantidad,
      COALESCE(v_stock_ant, 0),
      v_stock_post,
      p_venta_id,
      'venta',
      auth.uid(),
      'Anulación de venta #' || v.numero
    FROM ventas v WHERE v.id = p_venta_id;

    PERFORM fn_actualizar_estado_stock(v_item.producto_id, v_sede_id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_anular_venta TO authenticated;
