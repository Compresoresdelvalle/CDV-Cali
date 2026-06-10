-- CRÍTICO (auditoría 2026-06-09 #1): fn_registrar_devolucion leía
-- `ventas.estado`, columna que NO existe (la tabla ventas solo tiene la
-- booleana `anulada`). Postgres lanzaba "column estado does not exist" en
-- runtime para CADA devolución de cliente (p_tipo='cliente'), dejando ese
-- flujo 100% inoperativo. El camino 'proveedor' no tocaba esa línea, por eso
-- pasaba desapercibido.
--
-- Fix: usar la columna real `anulada` y detectar venta inexistente con
-- IF NOT FOUND (el chequeo previo `IF v_venta_estado IS NULL` ni siquiera
-- distinguía una fila ausente de un valor NULL). Resto de la función idéntico.

create or replace function public.fn_registrar_devolucion(p_tipo text, p_producto_id uuid, p_sede_id text, p_cantidad integer, p_motivo text default 'Sin motivo especificado'::text, p_venta_id uuid default null::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_usuario_id UUID;
  v_dev_id UUID;
  v_numero INT;
  v_stock_ant INTEGER;
  v_stock_post INTEGER;
  v_anulada BOOLEAN;
  v_cantidad_original INTEGER;
  v_devuelto_previo INTEGER;
  v_signo INTEGER;
  v_reingresa BOOLEAN;
BEGIN
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  IF p_tipo NOT IN ('cliente','proveedor') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  IF p_cantidad <= 0 THEN RAISE EXCEPTION 'Cantidad debe ser mayor a 0'; END IF;

  -- Semántica correcta: cliente SUMA stock, proveedor RESTA stock
  IF p_tipo = 'cliente' THEN
    v_signo := 1;
    v_reingresa := true;
    -- Cliente: requiere venta y validaciones
    IF p_venta_id IS NULL THEN
      RAISE EXCEPTION 'Devolución de cliente requiere venta_id';
    END IF;
    -- ventas usa la columna booleana `anulada` (no `estado`).
    SELECT anulada INTO v_anulada FROM ventas WHERE id = p_venta_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Venta no encontrada';
    END IF;
    IF v_anulada THEN
      RAISE EXCEPTION 'No se puede devolver de una venta anulada';
    END IF;
    -- Validar cantidad ≤ vendido - devuelto previo
    SELECT COALESCE(SUM(cantidad), 0) INTO v_cantidad_original
      FROM detalle_venta WHERE venta_id = p_venta_id AND producto_id = p_producto_id;
    IF v_cantidad_original = 0 THEN
      RAISE EXCEPTION 'Producto no estaba en la venta original';
    END IF;
    SELECT COALESCE(SUM(cantidad), 0) INTO v_devuelto_previo
      FROM devoluciones WHERE venta_id = p_venta_id AND producto_id = p_producto_id;
    IF v_devuelto_previo + p_cantidad > v_cantidad_original THEN
      RAISE EXCEPTION 'Cantidad excede lo vendido (vendido=%, ya devuelto=%, intentas=%)',
        v_cantidad_original, v_devuelto_previo, p_cantidad;
    END IF;
  ELSE
    -- proveedor: RESTA stock, no necesita venta
    v_signo := -1;
    v_reingresa := false;
  END IF;

  INSERT INTO inventario (producto_id, sede_id, cantidad, estado_stock)
  VALUES (p_producto_id, p_sede_id, 0, 'OK')
  ON CONFLICT (producto_id, sede_id) DO NOTHING;

  SELECT cantidad INTO v_stock_ant FROM inventario
   WHERE producto_id = p_producto_id AND sede_id = p_sede_id FOR UPDATE;

  -- Para proveedor, validar que haya stock suficiente para restar
  IF v_signo = -1 AND v_stock_ant < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente para devolver al proveedor (disponible=%, requerido=%)',
      v_stock_ant, p_cantidad;
  END IF;

  INSERT INTO devoluciones (venta_id, producto_id, sede_id, cantidad, motivo,
    registrado_por, reingresa_stock, estado)
  VALUES (p_venta_id, p_producto_id, p_sede_id, p_cantidad,
    COALESCE(p_motivo, 'Sin motivo'), v_usuario_id, v_reingresa, 'procesada')
  RETURNING id, numero INTO v_dev_id, v_numero;

  UPDATE inventario
     SET cantidad = cantidad + (v_signo * p_cantidad),
         ultimo_movimiento = now(), updated_at = now()
   WHERE producto_id = p_producto_id AND sede_id = p_sede_id
   RETURNING cantidad INTO v_stock_post;

  INSERT INTO movimientos (producto_id, sede_id, tipo, cantidad,
    stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
  VALUES (p_producto_id, p_sede_id, 'devolucion', v_signo * p_cantidad,
    v_stock_ant, v_stock_post, v_dev_id, 'devolucion', v_usuario_id,
    CASE WHEN p_tipo = 'cliente' THEN 'Devolución de cliente #' || v_numero
         ELSE 'Devolución a proveedor #' || v_numero END);

  PERFORM fn_actualizar_estado_stock(p_producto_id, p_sede_id);

  RETURN jsonb_build_object(
    'devolucion_id', v_dev_id, 'numero', v_numero, 'tipo', p_tipo,
    'delta_stock', v_signo * p_cantidad,
    'stock_anterior', v_stock_ant, 'stock_posterior', v_stock_post
  );
END;
$function$;
