-- TAREA B (P1): guard de rol/sede en fn_registrar_devolucion.
-- Antes solo validaba auth.uid() no nulo (sin rol ni sede), a diferencia de sus
-- hermanas. El RoleGuard (Admin/Bodeguero) era solo client-side. Se agrega guard
-- server-side: rol IN (Admin,Bodeguero) y p_sede_id = get_my_sede_id() salvo Admin.
-- Resto del cuerpo intacto (cantidad vendida, venta anulada, stock, movimientos).
CREATE OR REPLACE FUNCTION public.fn_registrar_devolucion(p_tipo text, p_producto_id uuid, p_sede_id text, p_cantidad integer, p_motivo text DEFAULT 'Sin motivo especificado'::text, p_venta_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_usuario_id UUID;
  v_rol TEXT;
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

  -- TAREA B: guard de rol/sede (antes solo validaba auth.uid()).
  -- El RoleGuard (Admin/Bodeguero) era solo client-side.
  SELECT rol::text INTO v_rol FROM usuarios WHERE id = v_usuario_id;
  IF v_rol IS NULL OR v_rol NOT IN ('Admin','Bodeguero') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar devoluciones';
  END IF;
  IF v_rol <> 'Admin' AND p_sede_id IS DISTINCT FROM get_my_sede_id() THEN
    RAISE EXCEPTION 'Solo puedes registrar devoluciones en tu sede';
  END IF;

  IF p_tipo NOT IN ('cliente','proveedor') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  IF p_cantidad <= 0 THEN RAISE EXCEPTION 'Cantidad debe ser mayor a 0'; END IF;

  IF p_tipo = 'cliente' THEN
    v_signo := 1;
    v_reingresa := true;
    IF p_venta_id IS NULL THEN
      RAISE EXCEPTION 'Devolución de cliente requiere venta_id';
    END IF;
    SELECT anulada INTO v_anulada FROM ventas WHERE id = p_venta_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Venta no encontrada';
    END IF;
    IF v_anulada THEN
      RAISE EXCEPTION 'No se puede devolver de una venta anulada';
    END IF;
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
    v_signo := -1;
    v_reingresa := false;
  END IF;

  INSERT INTO inventario (producto_id, sede_id, cantidad, estado_stock)
  VALUES (p_producto_id, p_sede_id, 0, 'OK')
  ON CONFLICT (producto_id, sede_id) DO NOTHING;

  SELECT cantidad INTO v_stock_ant FROM inventario
   WHERE producto_id = p_producto_id AND sede_id = p_sede_id FOR UPDATE;

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
