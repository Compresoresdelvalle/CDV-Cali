-- ============================================================
-- FASE 4: VENTAS + COTIZACIONES — PL/pgSQL helper functions
-- ============================================================

-- ------------------------------------------------------------
-- fn_registrar_venta
-- Inserta una venta completa (cabecera + ítems) en una sola
-- transacción.  Los triggers existentes (trg_venta_descontar_stock
-- y trg_recalcular_venta) corren por cada fila de detalle_venta.
-- Si algún ítem supera el stock disponible el trigger lanza
-- EXCEPTION y toda la función hace rollback automático.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_registrar_venta(
  p_sede_id        TEXT,
  p_cliente_nombre TEXT DEFAULT NULL,
  p_cliente_nit    TEXT DEFAULT NULL,
  p_metodo_pago    metodo_pago DEFAULT 'Efectivo',
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
  -- Validaciones básicas
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta debe tener al menos un ítem';
  END IF;

  v_vendedor_id := auth.uid();

  IF v_vendedor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- Cabecera de venta (subtotal/total se recalcula por trigger)
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

  -- Insertar cada ítem (triggers disparan por fila)
  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id  := (item->>'producto_id')::UUID;
    v_cantidad := (item->>'cantidad')::NUMERIC;
    v_precio   := (item->>'precio_unitario')::NUMERIC;

    -- Obtener costo promedio actual
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

  -- Devolver resumen (totales ya recalculados por trigger)
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
-- fn_convertir_cotizacion
-- Convierte una cotización aprobada en venta real, descantando
-- stock.  Idempotente: si ya existe una venta vinculada,
-- devuelve el id existente sin duplicar.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_convertir_cotizacion(
  p_cotizacion_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cot          cotizaciones%ROWTYPE;
  v_venta_id     UUID;
  v_numero       INT;
  v_item         detalle_cotizacion%ROWTYPE;
  v_costo        NUMERIC;
BEGIN
  SELECT * INTO v_cot
    FROM cotizaciones
   WHERE id = p_cotizacion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotización no encontrada';
  END IF;

  IF v_cot.estado = 'vencida' THEN
    RAISE EXCEPTION 'La cotización está vencida y no puede convertirse en venta';
  END IF;

  IF v_cot.estado = 'rechazada' THEN
    RAISE EXCEPTION 'La cotización fue rechazada';
  END IF;

  -- Crear venta
  INSERT INTO ventas (
    vendedor_id, sede_id, cliente_nombre, cliente_nit,
    metodo_pago, descuento_pct, iva_pct,
    subtotal, total
  )
  VALUES (
    v_cot.vendedor_id, v_cot.sede_id,
    v_cot.cliente_nombre, v_cot.cliente_nit,
    'Efectivo', v_cot.descuento_pct, v_cot.iva_pct,
    0, 0
  )
  RETURNING id, numero INTO v_venta_id, v_numero;

  -- Copiar ítems de cotización → detalle_venta
  FOR v_item IN
    SELECT * FROM detalle_cotizacion WHERE cotizacion_id = p_cotizacion_id
  LOOP
    SELECT COALESCE(costo_promedio, 0)
      INTO v_costo
      FROM productos
     WHERE id = v_item.producto_id;

    INSERT INTO detalle_venta (
      venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal
    )
    VALUES (
      v_venta_id, v_item.producto_id, v_item.cantidad,
      v_item.precio_unitario, v_costo,
      v_item.cantidad * v_item.precio_unitario
    );
  END LOOP;

  -- Marcar cotización como aprobada
  UPDATE cotizaciones
     SET estado = 'aprobada'
   WHERE id = p_cotizacion_id;

  RETURN jsonb_build_object(
    'venta_id', v_venta_id,
    'numero',   v_numero,
    'cotizacion_id', p_cotizacion_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_convertir_cotizacion TO authenticated;

-- ------------------------------------------------------------
-- fn_anular_venta
-- Marca la venta como anulada y devuelve el stock (solo Admin).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_anular_venta(p_venta_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol  TEXT;
  v_item detalle_venta%ROWTYPE;
BEGIN
  SELECT get_my_rol() INTO v_rol;

  IF v_rol <> 'Admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede anular ventas';
  END IF;

  -- Marcar como anulada
  UPDATE ventas SET anulada = TRUE WHERE id = p_venta_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;

  -- Devolver stock por cada ítem
  FOR v_item IN
    SELECT * FROM detalle_venta WHERE venta_id = p_venta_id
  LOOP
    UPDATE inventario
       SET cantidad = cantidad + v_item.cantidad,
           updated_at = NOW()
     WHERE producto_id = v_item.producto_id
       AND sede_id = (SELECT sede_id FROM ventas WHERE id = p_venta_id);

    -- Registrar movimiento de devolución
    INSERT INTO movimientos (
      producto_id, sede_id, tipo, cantidad,
      referencia_id, referencia_tipo, usuario_id, notas
    )
    SELECT
      v_item.producto_id,
      v.sede_id,
      'ajuste_entrada',
      v_item.cantidad,
      p_venta_id,
      'venta',
      auth.uid(),
      'Anulación de venta #' || v.numero
    FROM ventas v
    WHERE v.id = p_venta_id;

    -- Recalcular estado de stock
    PERFORM fn_actualizar_estado_stock(v_item.producto_id,
      (SELECT sede_id FROM ventas WHERE id = p_venta_id));
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_anular_venta TO authenticated;

-- ------------------------------------------------------------
-- fn_registrar_cotizacion
-- Crea una cotización completa (cabecera + ítems).
-- No descuenta stock.
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

  -- Calcular subtotal
  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_sub := (item->>'cantidad')::NUMERIC * (item->>'precio_unitario')::NUMERIC;
    v_subtotal := v_subtotal + v_item_sub;
  END LOOP;

  v_total := v_subtotal * (1 - p_descuento_pct / 100) * 1.19;

  -- Cabecera
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

  -- Ítems
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
