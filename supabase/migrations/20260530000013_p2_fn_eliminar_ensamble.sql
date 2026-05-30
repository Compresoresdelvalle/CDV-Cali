-- ============================================================================
-- Parte 2 — A8: fn_eliminar_ensamble (solo Admin).
-- Revierte el stock de un ensamble completado y lo elimina:
--   - devuelve los componentes al POOL DE INSUMO de la sede,
--   - quita la cantidad producida del stock de venta del producto resultante
--     (falla si ya no hay stock suficiente: se vendió/trasladó),
--   - registra movimientos de reversa (tipo 'ajuste') y borra ensamble+detalle.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_eliminar_ensamble(p_ensamble_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_rol text;
  v_ens RECORD; v_det RECORD;
  v_cant int; v_result_stock int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::text INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol <> 'Admin' THEN
    RAISE EXCEPTION 'Solo el Admin puede eliminar ensambles';
  END IF;

  SELECT * INTO v_ens FROM ensambles WHERE id = p_ensamble_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ensamble no encontrado'; END IF;

  IF v_ens.completado THEN
    -- 1) Quitar el resultado del stock de venta.
    SELECT cantidad INTO v_result_stock FROM inventario
     WHERE producto_id = v_ens.producto_resultado_id AND sede_id = v_ens.sede_id FOR UPDATE;
    IF COALESCE(v_result_stock, 0) < v_ens.cantidad_producida THEN
      RAISE EXCEPTION 'No se puede deshacer: el producto resultante ya no tiene stock suficiente (hay %, se produjeron %). Quizá ya se vendió o trasladó.',
        COALESCE(v_result_stock, 0), v_ens.cantidad_producida;
    END IF;
    UPDATE inventario SET cantidad = cantidad - v_ens.cantidad_producida,
      ultimo_movimiento = now(), updated_at = now()
     WHERE producto_id = v_ens.producto_resultado_id AND sede_id = v_ens.sede_id;
    INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, observaciones)
    VALUES ('ajuste', v_ens.producto_resultado_id, v_ens.sede_id, -v_ens.cantidad_producida,
      v_result_stock, v_result_stock - v_ens.cantidad_producida, p_ensamble_id, 'ensamble', v_uid,
      'Reversa por eliminación de ensamble');
    PERFORM fn_actualizar_estado_stock(v_ens.producto_resultado_id, v_ens.sede_id);

    -- 2) Devolver los componentes al pool de insumo.
    FOR v_det IN SELECT * FROM detalle_ensamble WHERE ensamble_id = p_ensamble_id LOOP
      SELECT cantidad_insumo INTO v_cant FROM inventario
       WHERE producto_id = v_det.producto_id AND sede_id = v_ens.sede_id FOR UPDATE;
      IF v_cant IS NULL THEN
        INSERT INTO inventario (producto_id, sede_id, cantidad_insumo)
        VALUES (v_det.producto_id, v_ens.sede_id, v_det.cantidad);
        v_cant := 0;
      ELSE
        UPDATE inventario SET cantidad_insumo = cantidad_insumo + v_det.cantidad,
          ultimo_movimiento = now(), updated_at = now()
         WHERE producto_id = v_det.producto_id AND sede_id = v_ens.sede_id;
      END IF;
      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, observaciones)
      VALUES ('ajuste', v_det.producto_id, v_ens.sede_id, v_det.cantidad,
        v_cant, v_cant + v_det.cantidad, p_ensamble_id, 'ensamble', v_uid,
        'Reversa de insumo por eliminación de ensamble');
      PERFORM fn_actualizar_estado_stock(v_det.producto_id, v_ens.sede_id);
    END LOOP;
  END IF;

  DELETE FROM detalle_ensamble WHERE ensamble_id = p_ensamble_id;
  DELETE FROM ensambles WHERE id = p_ensamble_id;

  RETURN jsonb_build_object('eliminado', p_ensamble_id, 'revertido', v_ens.completado);
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_eliminar_ensamble(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_eliminar_ensamble(uuid) TO authenticated;
