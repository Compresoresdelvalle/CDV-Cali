-- Fase 5: Función para registrar devoluciones (cliente y proveedor)
-- Ajusta stock y registra movimiento de auditoría atómicamente.

CREATE OR REPLACE FUNCTION fn_registrar_devolucion(
  p_tipo        TEXT,          -- 'cliente' | 'proveedor'
  p_producto_id UUID,
  p_sede_id     TEXT,
  p_cantidad    INTEGER,
  p_motivo      TEXT DEFAULT NULL,
  p_venta_id    UUID DEFAULT NULL,
  p_compra_id   UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_usuario_id UUID;
  v_dev_id     UUID;
  v_numero     INT;
  v_stock_ant  INTEGER;
  v_delta      INTEGER;
BEGIN
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_tipo NOT IN ('cliente', 'proveedor') THEN
    RAISE EXCEPTION 'Tipo inválido: debe ser cliente o proveedor';
  END IF;

  IF p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Cantidad debe ser mayor a 0';
  END IF;

  -- Para devolución a proveedor: verificar stock suficiente antes de restar
  IF p_tipo = 'proveedor' THEN
    SELECT cantidad INTO v_stock_ant
    FROM inventario
    WHERE producto_id = p_producto_id AND sede_id = p_sede_id
    FOR UPDATE;

    IF NOT FOUND OR v_stock_ant < p_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente. Disponible: %', COALESCE(v_stock_ant, 0);
    END IF;
  END IF;

  -- Insertar devolución directamente en estado 'procesada'
  INSERT INTO devoluciones (
    tipo, producto_id, sede_id, cantidad, motivo,
    venta_id, compra_id, registrado_por, estado
  )
  VALUES (
    p_tipo, p_producto_id, p_sede_id, p_cantidad, p_motivo,
    p_venta_id, p_compra_id, v_usuario_id, 'procesada'
  )
  RETURNING id, numero INTO v_dev_id, v_numero;

  -- Ajustar stock: devolución de cliente suma, devolución a proveedor resta
  v_delta := CASE WHEN p_tipo = 'cliente' THEN p_cantidad ELSE -p_cantidad END;

  UPDATE inventario
  SET cantidad   = cantidad + v_delta,
      updated_at = NOW()
  WHERE producto_id = p_producto_id AND sede_id = p_sede_id;

  -- Registrar movimiento de auditoría (append-only)
  INSERT INTO movimientos (
    producto_id, sede_id, tipo, cantidad,
    referencia_id, referencia_tipo, usuario_id, notas
  )
  VALUES (
    p_producto_id, p_sede_id, 'devolucion', p_cantidad,
    v_dev_id, 'devolucion', v_usuario_id,
    CASE
      WHEN p_tipo = 'cliente'
        THEN 'Devolución de cliente #' || v_numero
      ELSE
        'Devolución a proveedor #' || v_numero
    END
  );

  -- Recalcular estado de stock del producto en la sede
  PERFORM fn_actualizar_estado_stock(p_producto_id, p_sede_id);

  RETURN jsonb_build_object(
    'devolucion_id', v_dev_id,
    'numero',        v_numero,
    'tipo',          p_tipo,
    'delta_stock',   v_delta
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_registrar_devolucion TO authenticated;
