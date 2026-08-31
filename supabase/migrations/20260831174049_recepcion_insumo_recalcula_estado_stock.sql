-- Recibir una compra con destino INSUMO no recalculaba el estado de stock.
--
-- `trg_compra_sumar_stock` tiene dos ramas. La de 'venta' termina con
-- `PERFORM fn_actualizar_estado_stock(...)`; la de 'insumo' no lo hacia.
--
-- Antes daba igual: el estado se calculaba solo con `cantidad`, y recibir
-- insumo toca `cantidad_insumo`, asi que no habia nada que recalcular. Pero
-- desde la migracion 20260829213651 el estado de un producto NO vendible se
-- calcula con `cantidad + cantidad_insumo`, o sea que recibir insumo SI cambia
-- el estado que le corresponde, y nadie lo actualizaba.
--
-- Escenario: un insumo con minimo 5 esta en 'Agotado'. Llega una compra de 40
-- unidades con destino insumo. El stock sube a 40, pero `estado_stock` se queda
-- en 'Agotado' hasta que otro movimiento cualquiera lo toque. Mientras tanto
-- sigue saliendo en Alertas, en la campana de reposicion y en Reorden, pidiendo
-- que se compre algo que acaba de entrar.
--
-- Se anade el recalculo a la rama de insumo, identico al de la otra rama. El
-- resto del cuerpo queda tal cual estaba.
CREATE OR REPLACE FUNCTION public.trg_compra_sumar_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_compra RECORD; v_det RECORD;
  v_stock_ant INTEGER; v_stock_insumo_ant INTEGER; v_stock_global_prev INTEGER;
  v_costo_prev NUMERIC;
BEGIN
  IF NEW.recibida = true AND (OLD.recibida = false OR OLD.recibida IS NULL) THEN
    PERFORM pg_advisory_xact_lock(hashtext('compra:' || NEW.id::text));
    SELECT sede_destino_id, registrado_por, recibida INTO v_compra
      FROM compras WHERE id = NEW.id FOR UPDATE;
    IF v_compra.recibida IS DISTINCT FROM NEW.recibida THEN RETURN NEW; END IF;
    FOR v_det IN SELECT * FROM detalle_compra WHERE compra_id = NEW.id LOOP
      INSERT INTO inventario (producto_id, sede_id, cantidad)
      VALUES (v_det.producto_id, v_compra.sede_destino_id, 0)
      ON CONFLICT (producto_id, sede_id) DO NOTHING;
      SELECT COALESCE(cantidad, 0), COALESCE(cantidad_insumo, 0)
        INTO v_stock_ant, v_stock_insumo_ant
        FROM inventario
       WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id
       FOR UPDATE;
      -- S4-19: serializar compras concurrentes del mismo producto antes de leer el stock global.
      -- S6-SNAP: el mismo FOR UPDATE captura el costo_promedio previo a esta recepcion.
      SELECT costo_promedio INTO v_costo_prev
        FROM productos WHERE id = v_det.producto_id FOR UPDATE;

      -- S6-SNAP: guardar el costo ANTERIOR a esta recepcion para poder revertirlo
      -- al cancelar. Se escribe una sola vez por producto y compra: si el mismo
      -- producto aparece en varias lineas, todas conservan el costo pre-compra real
      -- (no el intermedio que deja la primera linea).
      IF NOT EXISTS (
        SELECT 1 FROM detalle_compra
         WHERE compra_id = NEW.id AND producto_id = v_det.producto_id
           AND costo_promedio_anterior IS NOT NULL
      ) THEN
        UPDATE detalle_compra SET costo_promedio_anterior = v_costo_prev
         WHERE compra_id = NEW.id AND producto_id = v_det.producto_id;
      END IF;

      SELECT COALESCE(SUM(cantidad + COALESCE(cantidad_insumo, 0)), 0)
        INTO v_stock_global_prev
        FROM inventario WHERE producto_id = v_det.producto_id;
      IF v_det.destino = 'insumo' THEN
        UPDATE inventario SET
          cantidad_insumo = COALESCE(inventario.cantidad_insumo, 0) + v_det.cantidad,
          ultimo_movimiento = now(), updated_at = now()
        WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id;
        INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
                                referencia_id, referencia_tipo, usuario_id)
        VALUES ('compra', v_det.producto_id, v_compra.sede_destino_id, v_det.cantidad,
                COALESCE(v_stock_insumo_ant, 0), COALESCE(v_stock_insumo_ant, 0) + v_det.cantidad,
                NEW.id, 'compra', v_compra.registrado_por);
        -- Faltaba: para un producto NO vendible el estado se calcula con
        -- cantidad + cantidad_insumo, asi que recibir insumo lo cambia.
        PERFORM fn_actualizar_estado_stock(v_det.producto_id, v_compra.sede_destino_id);
      ELSE
        UPDATE inventario SET
          cantidad = inventario.cantidad + v_det.cantidad,
          ultimo_movimiento = now(), updated_at = now()
        WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id;
        INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
                                referencia_id, referencia_tipo, usuario_id)
        VALUES ('compra', v_det.producto_id, v_compra.sede_destino_id, v_det.cantidad,
                COALESCE(v_stock_ant, 0), COALESCE(v_stock_ant, 0) + v_det.cantidad,
                NEW.id, 'compra', v_compra.registrado_por);
        PERFORM fn_actualizar_estado_stock(v_det.producto_id, v_compra.sede_destino_id);
      END IF;
      -- S8: flag de sistema para que el guard no revierta el ponderado cuando
      -- quien recibe no es Admin
      PERFORM set_config('app.costo_sistema','on', true);
      UPDATE productos SET
        costo_promedio = CASE
          WHEN v_stock_global_prev = 0 THEN v_det.costo_unitario
          ELSE (costo_promedio * v_stock_global_prev + v_det.costo_unitario * v_det.cantidad)
               / NULLIF(v_stock_global_prev + v_det.cantidad, 0)
        END,
        updated_at = now()
      WHERE id = v_det.producto_id;
      PERFORM set_config('app.costo_sistema','', true);
    END LOOP;
    UPDATE compras SET fecha_recepcion = COALESCE(fecha_recepcion, now()) WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;
