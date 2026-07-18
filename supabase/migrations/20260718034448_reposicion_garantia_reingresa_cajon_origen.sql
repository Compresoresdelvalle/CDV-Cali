-- TAREA E (P2): fn_marcar_reposicion_recibida reingresa al MISMO cajón de origen.
-- Antes SIEMPRE reingresaba al cajón vendible (inventario.cantidad), aunque el ítem
-- original hubiera salido del cajón insumo. El modelo SÍ guarda el cajón de origen en
-- detalle_garantia_compra.destino ('insumo' vs 'venta'), simétrico a como
-- fn_abrir_garantia_compra descuenta (cantidad_insumo si 'insumo', cantidad si no).
-- Se corrige para reingresar a cantidad_insumo cuando destino='insumo'.
-- Nota: esta función no toca costo_promedio, así que el guard app.costo_sistema no aplica.
CREATE OR REPLACE FUNCTION public.fn_marcar_reposicion_recibida(p_garantia_id uuid, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

    -- TAREA E: reingresar al MISMO cajón de origen (destino: 'insumo' vs vendible).
    IF v_det.destino = 'insumo' THEN
      SELECT COALESCE(cantidad_insumo,0) INTO v_stock_ant
        FROM inventario WHERE producto_id=v_det.producto_id AND sede_id=v_det.sede_id
        FOR UPDATE;
      v_stock_ant := COALESCE(v_stock_ant, 0);
      INSERT INTO inventario (producto_id, sede_id, cantidad, cantidad_insumo)
      VALUES (v_det.producto_id, v_det.sede_id, 0, v_det.cantidad)
      ON CONFLICT (producto_id, sede_id) DO UPDATE
        SET cantidad_insumo = COALESCE(inventario.cantidad_insumo,0) + v_det.cantidad,
            ultimo_movimiento = now(), updated_at = now();

      INSERT INTO movimientos (
        tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, observaciones
      ) VALUES (
        'garantia_entrada', v_det.producto_id, v_det.sede_id, v_det.cantidad,
        v_stock_ant, v_stock_ant + v_det.cantidad,
        p_garantia_id, 'garantia_compra', v_uid,
        'Reposición de garantía recibida del proveedor (insumo)'
      );
    ELSE
      SELECT COALESCE(cantidad,0) INTO v_stock_ant
        FROM inventario WHERE producto_id=v_det.producto_id AND sede_id=v_det.sede_id
        FOR UPDATE;
      v_stock_ant := COALESCE(v_stock_ant, 0);
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
    END IF;
  END LOOP;

  SELECT count(*) INTO v_total FROM detalle_garantia_compra WHERE garantia_id = p_garantia_id;
  SELECT count(*) INTO v_recibidos FROM detalle_garantia_compra
    WHERE garantia_id = p_garantia_id AND reposicion_recibida_at IS NOT NULL;
  IF v_total = v_recibidos AND v_total > 0 THEN
    UPDATE garantias_compra
       SET estado = 'cerrada', cerrado_por = v_uid, fecha_cierre = now()
     WHERE id = p_garantia_id;

    -- S6: al cerrar, la compra vuelve a 'completada' si no le quedan devoluciones en curso.
    IF NOT EXISTS (
         SELECT 1 FROM garantias_compra
          WHERE compra_id = v_garantia.compra_id
            AND id <> p_garantia_id
            AND estado NOT IN ('anulada','cerrada','nota_credito_emitida')
       )
       AND EXISTS (SELECT 1 FROM compras WHERE id = v_garantia.compra_id AND estado = 'devolucion_garantia') THEN
      PERFORM set_config('cdv.compra_admin','on',true);
      UPDATE compras SET estado = 'completada' WHERE id = v_garantia.compra_id;
      PERFORM set_config('cdv.compra_admin','',true);
    END IF;
  ELSIF v_recibidos > 0 AND v_garantia.estado <> 'reposicion_recibida' THEN
    UPDATE garantias_compra
       SET estado = 'reposicion_recibida'
     WHERE id = p_garantia_id;
  END IF;
END $function$;
