-- ============================================================
-- Fix: fn_registrar_devolucion — tipo='proveedor' debe SUMAR stock
--
-- El tipo 'proveedor' representa mercancía que el proveedor
-- envió de más o en error y que queda en inventario.
-- Ambos tipos ('cliente' y 'proveedor') reingresan stock.
--
-- Cambios respecto a la versión anterior:
--   • v_delta siempre es +p_cantidad (ambos tipos suman)
--   • v_reingresa siempre true (ambos reingresan a inventario)
--   • Se elimina la validación de stock insuficiente para proveedor
--     (no aplica cuando se está agregando stock, no restando)
-- ============================================================

CREATE OR REPLACE FUNCTION fn_registrar_devolucion(
  p_tipo        TEXT,
  p_producto_id UUID,
  p_sede_id     TEXT,
  p_cantidad    INTEGER,
  p_motivo      TEXT DEFAULT 'Sin motivo especificado',
  p_venta_id    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_usuario_id    UUID;
  v_dev_id        UUID;
  v_numero        INT;
  v_stock_ant     INTEGER;
  v_stock_post    INTEGER;
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

  -- Garantizar que existe fila en inventario antes del lock
  INSERT INTO inventario (producto_id, sede_id, cantidad, estado_stock)
  VALUES (p_producto_id, p_sede_id, 0, 'OK')
  ON CONFLICT (producto_id, sede_id) DO NOTHING;

  -- Leer stock actual con lock
  SELECT cantidad INTO v_stock_ant
  FROM inventario
  WHERE producto_id = p_producto_id AND sede_id = p_sede_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe registro de inventario para este producto en esta sede';
  END IF;

  -- Insertar devolución — ambos tipos reingresan stock al inventario
  INSERT INTO devoluciones (
    venta_id, producto_id, sede_id, cantidad, motivo,
    registrado_por, reingresa_stock, estado
  )
  VALUES (
    p_venta_id, p_producto_id, p_sede_id, p_cantidad,
    COALESCE(p_motivo, 'Sin motivo especificado'),
    v_usuario_id, true, 'procesada'
  )
  RETURNING id, numero INTO v_dev_id, v_numero;

  -- Ajustar stock: ambos tipos SUMAN al inventario
  UPDATE inventario
  SET cantidad          = cantidad + p_cantidad,
      ultimo_movimiento = NOW(),
      updated_at        = NOW()
  WHERE producto_id = p_producto_id AND sede_id = p_sede_id
  RETURNING cantidad INTO v_stock_post;

  -- Registrar movimiento de auditoría
  INSERT INTO movimientos (
    producto_id, sede_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id, observaciones
  )
  VALUES (
    p_producto_id, p_sede_id, 'devolucion', p_cantidad,
    v_stock_ant, v_stock_post,
    v_dev_id, 'devolucion', v_usuario_id,
    CASE
      WHEN p_tipo = 'cliente' THEN 'Devolución de cliente #' || v_numero
      ELSE 'Devolución de proveedor #' || v_numero
    END
  );

  PERFORM fn_actualizar_estado_stock(p_producto_id, p_sede_id);

  RETURN jsonb_build_object(
    'devolucion_id',   v_dev_id,
    'numero',          v_numero,
    'tipo',            p_tipo,
    'delta_stock',     p_cantidad,
    'stock_anterior',  v_stock_ant,
    'stock_posterior', v_stock_post
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_registrar_devolucion(TEXT, UUID, TEXT, INTEGER, TEXT, UUID) TO authenticated;
