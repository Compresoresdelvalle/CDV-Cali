-- ============================================================
-- FASE 4: Guards de seguridad en funciones de ventas/cotizaciones
-- ============================================================

-- ------------------------------------------------------------
-- fn_convertir_cotizacion — agregar guard de idempotencia
-- Previene crear dos ventas si se llama dos veces en la misma
-- cotización que ya fue convertida (estado = 'aprobada').
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

  -- Guard de estado inválido
  IF v_cot.estado = 'aprobada' THEN
    RAISE EXCEPTION 'La cotización ya fue convertida en venta';
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
  -- Los triggers (trg_venta_descontar_stock, trg_recalcular_venta)
  -- corren por cada fila y manejan el descuento de stock.
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

  -- Marcar cotización como aprobada (guard: previene segunda conversión)
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
-- fn_anular_venta — agregar guard de doble anulación
-- Previene devolver stock dos veces si se anula una venta
-- que ya estaba anulada.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_anular_venta(p_venta_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol      TEXT;
  v_anulada  BOOLEAN;
  v_item     detalle_venta%ROWTYPE;
BEGIN
  SELECT get_my_rol() INTO v_rol;

  IF v_rol <> 'Admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede anular ventas';
  END IF;

  -- Guard: verificar que la venta existe y no está ya anulada
  SELECT anulada INTO v_anulada FROM ventas WHERE id = p_venta_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;

  IF v_anulada THEN
    RAISE EXCEPTION 'La venta ya fue anulada anteriormente';
  END IF;

  -- Marcar como anulada
  UPDATE ventas SET anulada = TRUE WHERE id = p_venta_id;

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
