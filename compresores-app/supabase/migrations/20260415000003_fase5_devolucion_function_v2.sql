-- Fase 5 v2: Función para registrar devoluciones
-- Corregida para coincidir con el schema real de devoluciones y movimientos.
--
-- devoluciones: usa reingresa_stock BOOLEAN (true=cliente suma, false=proveedor resta)
--               motivo NOT NULL, sin columna tipo ni compra_id
-- movimientos:  requiere stock_anterior y stock_posterior NOT NULL, columna observaciones

CREATE OR REPLACE FUNCTION fn_registrar_devolucion(
  p_tipo        TEXT,          -- 'cliente' | 'proveedor'  (convertido a reingresa_stock)
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
  v_delta         INTEGER;
  v_reingresa     BOOLEAN;
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

  -- reingresa_stock: true cuando el producto vuelve al inventario (cliente devuelve)
  v_reingresa := (p_tipo = 'cliente');
  v_delta     := CASE WHEN v_reingresa THEN p_cantidad ELSE -p_cantidad END;

  -- Leer stock actual (lock para evitar race condition)
  SELECT cantidad INTO v_stock_ant
  FROM inventario
  WHERE producto_id = p_producto_id AND sede_id = p_sede_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe registro de inventario para este producto en esta sede';
  END IF;

  -- Para devolución a proveedor: verificar stock suficiente
  IF p_tipo = 'proveedor' AND v_stock_ant < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente. Disponible: %', v_stock_ant;
  END IF;

  -- Insertar devolución
  INSERT INTO devoluciones (
    venta_id, producto_id, sede_id, cantidad, motivo,
    registrado_por, reingresa_stock, estado
  )
  VALUES (
    p_venta_id, p_producto_id, p_sede_id, p_cantidad,
    COALESCE(p_motivo, 'Sin motivo especificado'),
    v_usuario_id, v_reingresa, 'procesada'
  )
  RETURNING id, numero INTO v_dev_id, v_numero;

  -- Ajustar stock
  UPDATE inventario
  SET cantidad   = cantidad + v_delta,
      updated_at = NOW()
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
      ELSE 'Devolución a proveedor #' || v_numero
    END
  );

  -- Recalcular estado de stock
  PERFORM fn_actualizar_estado_stock(p_producto_id, p_sede_id);

  RETURN jsonb_build_object(
    'devolucion_id', v_dev_id,
    'numero',        v_numero,
    'tipo',          p_tipo,
    'delta_stock',   v_delta,
    'stock_anterior', v_stock_ant,
    'stock_posterior', v_stock_post
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_registrar_devolucion TO authenticated;
