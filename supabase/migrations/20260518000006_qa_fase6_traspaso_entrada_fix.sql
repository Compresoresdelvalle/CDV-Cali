-- QA Campaña — Fase 6 (Traspasos + Picking)
--
-- Hallazgo F6 (bug, detectado por stress test): `trg_traspaso_entrada` hacía
--   SELECT COALESCE(cantidad,0) INTO v_stock_ant FROM inventario WHERE ...
-- Cuando la sede destino AÚN NO stockea el producto, el SELECT no devuelve
-- filas y `v_stock_ant` queda en NULL (el COALESCE solo aplica por-fila, no
-- al caso 0-filas). Luego el INSERT en `movimientos` con `stock_anterior =
-- NULL` viola el NOT NULL -> la recepción del traspaso falla por completo.
--
-- Es un caso COMÚN: los traspasos sirven precisamente para llevar mercancía
-- a sedes que no la tienen. Fix: COALESCE explícito tras el SELECT.

CREATE OR REPLACE FUNCTION public.trg_traspaso_entrada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_det RECORD; v_stock_ant INTEGER; v_recibir INTEGER;
BEGIN
  IF NEW.estado IN ('recibido', 'con_diferencia') AND OLD.estado = 'en_transito' THEN
    PERFORM pg_advisory_xact_lock(hashtext('traspaso:' || NEW.id::text));
    FOR v_det IN SELECT * FROM detalle_traspaso WHERE traspaso_id = NEW.id LOOP
      v_recibir := COALESCE(v_det.cantidad_recibida, v_det.cantidad_enviada, v_det.cantidad_solicitada);
      SELECT cantidad INTO v_stock_ant
        FROM inventario WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_destino_id
        FOR UPDATE;
      -- Si la sede destino aún no stockea el producto no hay fila -> v_stock_ant
      -- queda NULL; el COALESCE evita violar el NOT NULL de movimientos.
      v_stock_ant := COALESCE(v_stock_ant, 0);
      INSERT INTO inventario (producto_id, sede_id, cantidad)
      VALUES (v_det.producto_id, NEW.sede_destino_id, v_recibir)
      ON CONFLICT (producto_id, sede_id) DO UPDATE SET
        cantidad = inventario.cantidad + v_recibir,
        ultimo_movimiento = now(), updated_at = now();
      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id)
      VALUES ('traspaso_entrada', v_det.producto_id, NEW.sede_destino_id, v_recibir,
        v_stock_ant, v_stock_ant + v_recibir, NEW.id, 'traspaso', NEW.solicitado_por);
      PERFORM fn_actualizar_estado_stock(v_det.producto_id, NEW.sede_destino_id);
    END LOOP;
  END IF;
  RETURN NEW;
END; $function$;
