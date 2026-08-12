-- Devolución de cliente con reembolso, en una sola transacción.
-- Roles: Admin, Bodeguero, Vendedor (este solo sobre ventas de SU sede).
-- destino_stock: vendible → reingresa al producto original; chatarra → producto
-- 'CHAT-<ref>' no vendible; no_reingresa → no toca inventario.
-- El reembolso (si monto>0) queda con la fecha de hoy y lo cuenta el cierre como
-- egreso del día. Tope: reembolsos de devoluciones + garantías de la misma venta
-- no pueden superar el total de la venta.
CREATE OR REPLACE FUNCTION public.fn_registrar_devolucion_cliente(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rol text; v_my_sede text;
  v_venta record;
  v_producto_id uuid := nullif(p_payload->>'producto_id','')::uuid;
  v_cantidad int := (p_payload->>'cantidad')::int;
  v_destino text := coalesce(nullif(p_payload->>'destino_stock',''), 'vendible');
  v_monto numeric := coalesce(nullif(p_payload->>'monto_reembolso','')::numeric, 0);
  v_metodo text := nullif(trim(p_payload->>'metodo_reembolso'),'');
  v_cuenta text := nullif(trim(p_payload->>'cuenta_reembolso'),'');
  v_motivo text := coalesce(nullif(trim(p_payload->>'motivo'),''), 'Devolución de cliente');
  v_obs text := nullif(trim(p_payload->>'observaciones'),'');
  v_sede text;
  v_cant_orig int; v_dev_previo int;
  v_ya_reemb numeric;
  v_dev_id uuid; v_numero int;
  v_stock_ant int; v_stock_post int; v_reingresa boolean;
  v_ref text; v_nom text; v_cat text; v_ref_chat text; v_prod_chat uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::text, sede_id INTO v_rol, v_my_sede FROM usuarios WHERE id = v_uid;
  IF v_rol IS NULL OR v_rol NOT IN ('Admin','Bodeguero','Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar devoluciones';
  END IF;

  IF v_producto_id IS NULL THEN RAISE EXCEPTION 'Falta el producto'; END IF;
  IF v_cantidad IS NULL OR v_cantidad <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser mayor a 0'; END IF;
  IF v_destino NOT IN ('vendible','chatarra','no_reingresa') THEN
    RAISE EXCEPTION 'Destino inválido';
  END IF;

  SELECT id, numero, sede_id, total, anulada INTO v_venta
  FROM ventas WHERE id = nullif(p_payload->>'venta_id','')::uuid FOR UPDATE;
  IF v_venta.id IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;
  IF v_venta.anulada THEN
    RAISE EXCEPTION 'No se puede devolver sobre una venta anulada';
  END IF;
  v_sede := v_venta.sede_id;

  -- Vendedor: solo sobre su sede.
  IF v_rol <> 'Admin' AND v_rol <> 'Bodeguero' AND v_sede IS DISTINCT FROM v_my_sede THEN
    RAISE EXCEPTION 'Solo puedes registrar devoluciones de ventas de tu sede';
  END IF;

  -- El producto debía estar en la venta.
  SELECT coalesce(sum(cantidad),0) INTO v_cant_orig
  FROM detalle_venta WHERE venta_id = v_venta.id AND producto_id = v_producto_id;
  IF v_cant_orig = 0 THEN RAISE EXCEPTION 'El producto no estaba en la venta original'; END IF;

  -- No exceder lo vendido (contando devoluciones previas no anuladas).
  SELECT coalesce(sum(cantidad),0) INTO v_dev_previo
  FROM devoluciones WHERE venta_id = v_venta.id AND producto_id = v_producto_id
    AND estado <> 'anulada';
  IF v_dev_previo + v_cantidad > v_cant_orig THEN
    RAISE EXCEPTION 'La cantidad excede lo vendido (vendido %, ya devuelto %, intentas %)',
      v_cant_orig, v_dev_previo, v_cantidad;
  END IF;

  -- Reembolso: validaciones de dinero.
  IF v_monto > 0 THEN
    IF v_metodo IS NULL THEN RAISE EXCEPTION 'Elige el método del reembolso'; END IF;
    -- Tope acumulado: reembolsos de devoluciones (no anuladas) + garantías devolver_dinero
    -- (no anuladas) de esta venta + el nuevo no pueden superar el total de la venta.
    SELECT coalesce(sum(monto_reembolso),0) INTO v_ya_reemb
      FROM devoluciones WHERE venta_id = v_venta.id AND estado <> 'anulada';
    v_ya_reemb := v_ya_reemb + coalesce((
      SELECT sum(monto_devuelto) FROM garantias_venta
       WHERE venta_id = v_venta.id AND resolucion='devolver_dinero' AND estado <> 'anulada'), 0);
    IF v_ya_reemb + v_monto > coalesce(v_venta.total,0) + 0.01 THEN
      RAISE EXCEPTION 'El reembolso acumulado ($% ya + $% nuevo) supera el total de la venta ($%). Ajusta el monto.',
        v_ya_reemb, v_monto, coalesce(v_venta.total,0);
    END IF;
  ELSE
    v_metodo := NULL; v_cuenta := NULL;
  END IF;

  v_reingresa := (v_destino = 'vendible');

  INSERT INTO devoluciones (venta_id, producto_id, sede_id, cantidad, motivo, observaciones,
    registrado_por, reingresa_stock, estado, destino_stock, monto_reembolso, metodo_reembolso, cuenta_reembolso)
  VALUES (v_venta.id, v_producto_id, v_sede, v_cantidad, v_motivo, v_obs,
    v_uid, v_reingresa, 'procesada', v_destino, v_monto, v_metodo, v_cuenta)
  RETURNING id, numero INTO v_dev_id, v_numero;

  -- Inventario según destino.
  IF v_destino = 'vendible' THEN
    INSERT INTO inventario (producto_id, sede_id, cantidad, estado_stock)
    VALUES (v_producto_id, v_sede, 0, 'OK')
    ON CONFLICT (producto_id, sede_id) DO NOTHING;
    SELECT cantidad INTO v_stock_ant FROM inventario
      WHERE producto_id=v_producto_id AND sede_id=v_sede FOR UPDATE;
    UPDATE inventario SET cantidad = cantidad + v_cantidad, ultimo_movimiento=now(), updated_at=now()
      WHERE producto_id=v_producto_id AND sede_id=v_sede RETURNING cantidad INTO v_stock_post;
    INSERT INTO movimientos (producto_id, sede_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, observaciones)
    VALUES (v_producto_id, v_sede, 'devolucion', v_cantidad, v_stock_ant, v_stock_post,
      v_dev_id, 'devolucion', v_uid, 'Devolución de cliente #' || v_numero || ' (vuelve a stock)');
    PERFORM fn_actualizar_estado_stock(v_producto_id, v_sede);

  ELSIF v_destino = 'chatarra' THEN
    SELECT referencia, nombre, categoria INTO v_ref, v_nom, v_cat FROM productos WHERE id=v_producto_id;
    v_ref_chat := 'CHAT-' || v_ref;
    INSERT INTO productos (referencia, nombre, categoria, precio_venta, costo_promedio, tipo, vendible, activo, descripcion)
    VALUES (v_ref_chat, v_nom || ' (chatarra)', v_cat, 0, 0, 'chatarra', false, true,
            'Retorno por devolución de cliente — no vendible (chatarra)')
    ON CONFLICT (referencia) DO NOTHING RETURNING id INTO v_prod_chat;
    IF v_prod_chat IS NULL THEN SELECT id INTO v_prod_chat FROM productos WHERE referencia=v_ref_chat; END IF;

    INSERT INTO inventario (producto_id, sede_id, cantidad)
    VALUES (v_prod_chat, v_sede, v_cantidad)
    ON CONFLICT (producto_id, sede_id) DO UPDATE
      SET cantidad = inventario.cantidad + excluded.cantidad, ultimo_movimiento=now(), updated_at=now()
    RETURNING cantidad INTO v_stock_post;
    v_stock_ant := v_stock_post - v_cantidad;
    UPDATE devoluciones SET chatarra_producto_id = v_prod_chat WHERE id = v_dev_id;

    INSERT INTO movimientos (producto_id, sede_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, observaciones)
    VALUES (v_prod_chat, v_sede, 'devolucion', v_cantidad, v_stock_ant, v_stock_post,
      v_dev_id, 'devolucion', v_uid, 'Devolución de cliente #' || v_numero || ' → chatarra');
    PERFORM fn_actualizar_estado_stock(v_prod_chat, v_sede);
  END IF;
  -- no_reingresa: no toca inventario.

  RETURN jsonb_build_object(
    'devolucion_id', v_dev_id, 'numero', v_numero, 'sede_id', v_sede,
    'destino_stock', v_destino, 'monto_reembolso', v_monto, 'metodo_reembolso', v_metodo
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_registrar_devolucion_cliente(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_registrar_devolucion_cliente(jsonb) TO authenticated;
