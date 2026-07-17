-- S8 fix: productos_costo_guard (trg_productos_costo_solo_admin, migración 20260611145300)
-- revertía EN SILENCIO el promedio ponderado que trg_compra_sumar_stock graba en
-- productos.costo_promedio cuando quien marca la compra como recibida no es Admin
-- (auth.uid() de Bodeguero/Vendedor). Confirmado en prueba BEGIN/ROLLBACK.
-- Mismo fix que ensambles (20260717034950): flag transaccional 'app.costo_sistema'
-- alrededor del UPDATE a productos. El guard sigue bloqueando UPDATEs manuales.

CREATE OR REPLACE FUNCTION public.trg_compra_sumar_stock()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_compra RECORD;
  v_det RECORD;
  v_stock_ant INTEGER;
  v_stock_insumo_ant INTEGER;
  v_stock_global_prev INTEGER;
BEGIN
  IF NEW.recibida = true AND (OLD.recibida = false OR OLD.recibida IS NULL) THEN
    PERFORM pg_advisory_xact_lock(hashtext('compra:' || NEW.id::text));
    SELECT sede_destino_id, registrado_por, recibida INTO v_compra
      FROM compras WHERE id = NEW.id FOR UPDATE;
    IF v_compra.recibida IS DISTINCT FROM NEW.recibida THEN
      RETURN NEW;
    END IF;
    FOR v_det IN SELECT * FROM detalle_compra WHERE compra_id = NEW.id LOOP
      INSERT INTO inventario (producto_id, sede_id, cantidad)
      VALUES (v_det.producto_id, v_compra.sede_destino_id, 0)
      ON CONFLICT (producto_id, sede_id) DO NOTHING;
      SELECT COALESCE(cantidad, 0), COALESCE(cantidad_insumo, 0)
        INTO v_stock_ant, v_stock_insumo_ant
        FROM inventario
       WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id
       FOR UPDATE;
      -- S4-19: serializar compras concurrentes del mismo producto antes de leer el stock global
      PERFORM 1 FROM productos WHERE id = v_det.producto_id FOR UPDATE;
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
$fn$;
