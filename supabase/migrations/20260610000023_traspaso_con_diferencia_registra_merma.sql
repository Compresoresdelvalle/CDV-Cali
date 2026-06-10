-- ALTO (auditoría 2026-06-09): cuando un traspaso termina `con_diferencia`
-- (recibido < enviado), el faltante (enviado − recibido) desaparecía del total de
-- la empresa SIN dejar una línea explícita de pérdida. El ledger por-sede cuadraba
-- (origen −enviado, destino +recibido), pero no había traza auditable de la merma.
--
-- DECISIÓN CLIENTE: registrar el faltante como MERMA/pérdida con movimiento de
-- auditoría.
--
-- Implementación (en trg_traspaso_entrada): la sede destino asienta el TOTAL
-- despachado (cantidad_enviada) como `traspaso_entrada`, y si hubo faltante, da de
-- baja ese faltante con un movimiento `ajuste` etiquetado "Merma:". El neto en el
-- inventario destino queda en lo realmente recibido (igual que antes), de modo que
-- se preserva la invariante inventario = SUM(movimientos) por (producto, sede) y se
-- deja una línea explícita y filtrable del faltante. Se usa tipo 'ajuste' con
-- observación (igual que fn_cancelar_compra / fn_anular_venta) para no introducir
-- un valor de enum nuevo ni alterar la UI; el faltante queda como pérdida visible.
--
-- Traspasos SIN diferencia (estado 'recibido') no cambian de comportamiento:
-- enviado == recibido => entrada = +enviado y faltante = 0 (sin merma).

create or replace function public.trg_traspaso_entrada()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_det        RECORD;
  v_stock_ant  INTEGER;
  v_enviada    INTEGER;
  v_recibida   INTEGER;
  v_faltante   INTEGER;
  v_stock_post INTEGER;
BEGIN
  IF NEW.estado IN ('recibido', 'con_diferencia') AND OLD.estado = 'en_transito' THEN
    PERFORM pg_advisory_xact_lock(hashtext('traspaso:' || NEW.id::text));
    FOR v_det IN SELECT * FROM detalle_traspaso WHERE traspaso_id = NEW.id LOOP
      v_enviada  := COALESCE(v_det.cantidad_enviada, v_det.cantidad_solicitada);
      v_recibida := COALESCE(v_det.cantidad_recibida, v_enviada);
      v_faltante := v_enviada - v_recibida;  -- >= 0: fn_procesar_traspaso valida recibida <= enviada

      SELECT cantidad INTO v_stock_ant
        FROM inventario WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_destino_id
        FOR UPDATE;
      v_stock_ant := COALESCE(v_stock_ant, 0);

      -- ENTRADA: se asienta el total despachado en la sede destino.
      INSERT INTO inventario (producto_id, sede_id, cantidad)
      VALUES (v_det.producto_id, NEW.sede_destino_id, v_enviada)
      ON CONFLICT (producto_id, sede_id) DO UPDATE SET
        cantidad = inventario.cantidad + v_enviada,
        ultimo_movimiento = now(), updated_at = now();
      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id)
      VALUES ('traspaso_entrada', v_det.producto_id, NEW.sede_destino_id, v_enviada,
        v_stock_ant, v_stock_ant + v_enviada, NEW.id, 'traspaso', NEW.solicitado_por);

      -- MERMA: el faltante se da de baja como pérdida, dejando el stock destino en
      -- el neto realmente recibido. Mantiene inventario = SUM(movimientos) por sede.
      IF v_faltante > 0 THEN
        v_stock_post := v_stock_ant + v_enviada;  -- stock tras la entrada
        UPDATE inventario SET cantidad = cantidad - v_faltante,
          ultimo_movimiento = now(), updated_at = now()
         WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_destino_id;
        INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
          referencia_id, referencia_tipo, usuario_id, observaciones)
        VALUES ('ajuste', v_det.producto_id, NEW.sede_destino_id, -v_faltante,
          v_stock_post, v_stock_post - v_faltante, NEW.id, 'traspaso',
          COALESCE(NEW.recibido_por, NEW.solicitado_por),
          'Merma: faltante en traspaso #' || NEW.numero ||
          ' (enviado ' || v_enviada || ', recibido ' || v_recibida || ')');
      END IF;

      PERFORM fn_actualizar_estado_stock(v_det.producto_id, NEW.sede_destino_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;
