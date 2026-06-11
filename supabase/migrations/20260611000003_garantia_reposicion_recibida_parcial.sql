-- BAJO (auditoría 2026-06-09, B9-4): el enum estado_garantia_compra incluye
-- 'reposicion_recibida' y el frontend lo modela como paso intermedio del stepper, pero
-- fn_marcar_reposicion_recibida nunca lo asigna: solo pasa a 'cerrada' cuando TODOS los
-- detalles llegan. En recepción PARCIAL la garantía se queda en 'reposicion_pendiente'
-- (el valor de enum es código muerto y el stepper no refleja el avance).
--
-- Fix: tras procesar los items, si hay recibidos pero no todos → estado
-- 'reposicion_recibida'; si están todos → 'cerrada' (como ya hacía). Además se amplía el
-- guard de entrada para aceptar también 'reposicion_recibida', de modo que recepciones
-- parciales sucesivas sigan funcionando hasta completar.

create or replace function public.fn_marcar_reposicion_recibida(p_garantia_id uuid, p_items jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT;
  v_garantia RECORD; v_det RECORD; v_item JSONB;
  v_total INT; v_recibidos INT;
  v_stock_ant INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol NOT IN ('Admin','Bodeguero') THEN
    RAISE EXCEPTION 'No tienes permiso';
  END IF;

  SELECT * INTO v_garantia FROM garantias_compra WHERE id = p_garantia_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Garantía no encontrada'; END IF;
  IF v_garantia.estado NOT IN ('reposicion_pendiente','reposicion_recibida') THEN
    RAISE EXCEPTION 'Solo se puede recibir reposición en estado reposicion_pendiente';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_det FROM detalle_garantia_compra
      WHERE id = (v_item->>'detalle_id')::BIGINT AND garantia_id = p_garantia_id;
    IF NOT FOUND OR v_det.reposicion_recibida_at IS NOT NULL THEN CONTINUE; END IF;

    UPDATE detalle_garantia_compra
       SET reposicion_recibida_at = now(), reposicion_recibida_por = v_uid
     WHERE id = v_det.id;

    SELECT COALESCE(cantidad,0) INTO v_stock_ant
      FROM inventario WHERE producto_id=v_det.producto_id AND sede_id=v_det.sede_id
      FOR UPDATE;
    INSERT INTO inventario (producto_id, sede_id, cantidad)
    VALUES (v_det.producto_id, v_det.sede_id, v_det.cantidad)
    ON CONFLICT (producto_id, sede_id) DO UPDATE
      SET cantidad = inventario.cantidad + v_det.cantidad,
          ultimo_movimiento = now(), updated_at = now();

    INSERT INTO movimientos (
      tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, observaciones
    ) VALUES (
      'garantia_entrada', v_det.producto_id, v_det.sede_id, v_det.cantidad,
      v_stock_ant, v_stock_ant + v_det.cantidad,
      p_garantia_id, 'garantia_compra', v_uid,
      'Reposición de garantía recibida del proveedor'
    );

    PERFORM fn_actualizar_estado_stock(v_det.producto_id, v_det.sede_id);
  END LOOP;

  SELECT count(*) INTO v_total FROM detalle_garantia_compra WHERE garantia_id = p_garantia_id;
  SELECT count(*) INTO v_recibidos FROM detalle_garantia_compra
    WHERE garantia_id = p_garantia_id AND reposicion_recibida_at IS NOT NULL;
  IF v_total = v_recibidos AND v_total > 0 THEN
    UPDATE garantias_compra
       SET estado = 'cerrada', cerrado_por = v_uid, fecha_cierre = now()
     WHERE id = p_garantia_id;
  ELSIF v_recibidos > 0 AND v_garantia.estado <> 'reposicion_recibida' THEN
    UPDATE garantias_compra
       SET estado = 'reposicion_recibida'
     WHERE id = p_garantia_id;
  END IF;
END $function$;
