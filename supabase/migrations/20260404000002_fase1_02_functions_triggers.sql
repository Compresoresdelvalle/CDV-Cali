-- ============================================================
-- FASE 1 - PASO 2: Funciones y Triggers
-- Compresores del Valle S.A.S.
-- ============================================================

-- Función auxiliar de estado de stock (debe ir ANTES de los triggers que la usan)
CREATE OR REPLACE FUNCTION fn_actualizar_estado_stock(p_producto_id UUID, p_sede_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_cantidad INTEGER; v_min INTEGER; v_max INTEGER; v_nuevo estado_stock;
BEGIN
  SELECT i.cantidad, p.stock_minimo, p.stock_maximo
  INTO v_cantidad, v_min, v_max
  FROM inventario i JOIN productos p ON p.id = i.producto_id
  WHERE i.producto_id = p_producto_id AND i.sede_id = p_sede_id;

  v_nuevo := CASE
    WHEN v_cantidad = 0 THEN 'Agotado'
    WHEN v_cantidad <= v_min THEN 'Bajo'
    WHEN v_cantidad > v_max THEN 'Sobrestock'
    ELSE 'OK'
  END;

  UPDATE inventario SET estado_stock = v_nuevo, updated_at = now()
  WHERE producto_id = p_producto_id AND sede_id = p_sede_id;
END; $$;

-- Trigger 1: Venta descuenta stock
CREATE OR REPLACE FUNCTION trg_venta_descontar_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inv RECORD;
  v_venta RECORD;
BEGIN
  SELECT sede_id, vendedor_id INTO v_venta FROM ventas WHERE id = NEW.venta_id;

  SELECT id, cantidad INTO v_inv
  FROM inventario
  WHERE producto_id = NEW.producto_id AND sede_id = v_venta.sede_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no existe en inventario de sede %', v_venta.sede_id;
  END IF;

  IF v_inv.cantidad < NEW.cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente. Disponible: %, Solicitado: %', v_inv.cantidad, NEW.cantidad;
  END IF;

  UPDATE inventario
  SET cantidad = cantidad - NEW.cantidad,
      ultimo_movimiento = now(),
      updated_at = now()
  WHERE id = v_inv.id;

  INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
                          referencia_id, referencia_tipo, usuario_id)
  VALUES ('venta', NEW.producto_id, v_venta.sede_id, -NEW.cantidad,
          v_inv.cantidad, v_inv.cantidad - NEW.cantidad,
          NEW.venta_id, 'venta', v_venta.vendedor_id);

  PERFORM fn_actualizar_estado_stock(NEW.producto_id, v_venta.sede_id);
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_after_insert_detalle_venta
  AFTER INSERT ON detalle_venta
  FOR EACH ROW EXECUTE FUNCTION trg_venta_descontar_stock();

-- Trigger 2: Compra suma stock al recibir
CREATE OR REPLACE FUNCTION trg_compra_sumar_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_compra RECORD;
  v_det RECORD;
  v_stock_ant INTEGER;
BEGIN
  IF NEW.recibida = true AND (OLD.recibida = false OR OLD.recibida IS NULL) THEN
    SELECT sede_destino_id, registrado_por INTO v_compra FROM compras WHERE id = NEW.id;

    FOR v_det IN SELECT * FROM detalle_compra WHERE compra_id = NEW.id LOOP
      SELECT COALESCE(cantidad, 0) INTO v_stock_ant
      FROM inventario WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id;

      INSERT INTO inventario (producto_id, sede_id, cantidad)
      VALUES (v_det.producto_id, v_compra.sede_destino_id, v_det.cantidad)
      ON CONFLICT (producto_id, sede_id)
      DO UPDATE SET
        cantidad = inventario.cantidad + v_det.cantidad,
        ultimo_movimiento = now(), updated_at = now();

      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
                              referencia_id, referencia_tipo, usuario_id)
      VALUES ('compra', v_det.producto_id, v_compra.sede_destino_id, v_det.cantidad,
              COALESCE(v_stock_ant, 0), COALESCE(v_stock_ant, 0) + v_det.cantidad,
              NEW.id, 'compra', v_compra.registrado_por);

      UPDATE productos SET
        costo_promedio = CASE
          WHEN (SELECT SUM(i.cantidad) FROM inventario i WHERE i.producto_id = v_det.producto_id) = 0
          THEN v_det.costo_unitario
          ELSE (costo_promedio * GREATEST(COALESCE(v_stock_ant, 0), 0) + v_det.costo_unitario * v_det.cantidad)
               / NULLIF(COALESCE(v_stock_ant, 0) + v_det.cantidad, 0)
        END,
        updated_at = now()
      WHERE id = v_det.producto_id;

      PERFORM fn_actualizar_estado_stock(v_det.producto_id, v_compra.sede_destino_id);
    END LOOP;

    UPDATE compras SET fecha_recepcion = now() WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_after_update_compra_recibida
  AFTER UPDATE OF recibida ON compras
  FOR EACH ROW EXECUTE FUNCTION trg_compra_sumar_stock();

-- Trigger 3: Traspaso salida
CREATE OR REPLACE FUNCTION trg_traspaso_salida()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_det RECORD; v_cant INTEGER;
BEGIN
  IF NEW.estado = 'en_transito' AND OLD.estado = 'verificado' THEN
    FOR v_det IN SELECT * FROM detalle_traspaso WHERE traspaso_id = NEW.id LOOP
      SELECT cantidad INTO v_cant FROM inventario
      WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_origen_id FOR UPDATE;

      UPDATE inventario SET cantidad = cantidad - v_det.cantidad_enviada,
        ultimo_movimiento = now(), updated_at = now()
      WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_origen_id;

      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id)
      VALUES ('traspaso_salida', v_det.producto_id, NEW.sede_origen_id,
        -v_det.cantidad_enviada, v_cant, v_cant - v_det.cantidad_enviada,
        NEW.id, 'traspaso', NEW.solicitado_por);

      PERFORM fn_actualizar_estado_stock(v_det.producto_id, NEW.sede_origen_id);
    END LOOP;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_after_update_traspaso_salida
  AFTER UPDATE OF estado ON traspasos
  FOR EACH ROW EXECUTE FUNCTION trg_traspaso_salida();

-- Trigger 4: Traspaso entrada
CREATE OR REPLACE FUNCTION trg_traspaso_entrada()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_det RECORD; v_stock_ant INTEGER;
BEGIN
  IF NEW.estado IN ('recibido', 'con_diferencia') AND OLD.estado = 'en_transito' THEN
    FOR v_det IN SELECT * FROM detalle_traspaso WHERE traspaso_id = NEW.id LOOP
      SELECT COALESCE(cantidad, 0) INTO v_stock_ant FROM inventario
      WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_destino_id;

      INSERT INTO inventario (producto_id, sede_id, cantidad)
      VALUES (v_det.producto_id, NEW.sede_destino_id, v_det.cantidad_recibida)
      ON CONFLICT (producto_id, sede_id)
      DO UPDATE SET cantidad = inventario.cantidad + v_det.cantidad_recibida,
        ultimo_movimiento = now(), updated_at = now();

      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id)
      VALUES ('traspaso_entrada', v_det.producto_id, NEW.sede_destino_id,
        v_det.cantidad_recibida, COALESCE(v_stock_ant, 0), COALESCE(v_stock_ant, 0) + v_det.cantidad_recibida,
        NEW.id, 'traspaso', COALESCE(NEW.recibido_por, NEW.solicitado_por));

      PERFORM fn_actualizar_estado_stock(v_det.producto_id, NEW.sede_destino_id);
    END LOOP;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_after_update_traspaso_entrada
  AFTER UPDATE OF estado ON traspasos
  FOR EACH ROW EXECUTE FUNCTION trg_traspaso_entrada();

-- Trigger 5: Ensamble consume componentes y produce
CREATE OR REPLACE FUNCTION trg_ensamble_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_det RECORD; v_cant INTEGER; v_costo NUMERIC := 0;
BEGIN
  IF NEW.completado = true AND (OLD.completado = false OR OLD.completado IS NULL) THEN
    FOR v_det IN SELECT * FROM detalle_ensamble WHERE ensamble_id = NEW.id LOOP
      SELECT cantidad INTO v_cant FROM inventario
      WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_id FOR UPDATE;

      IF v_cant < v_det.cantidad THEN
        RAISE EXCEPTION 'Stock insuficiente de componente para ensamble';
      END IF;

      UPDATE inventario SET cantidad = cantidad - v_det.cantidad,
        ultimo_movimiento = now(), updated_at = now()
      WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_id;

      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id)
      VALUES ('ensamble_consumo', v_det.producto_id, NEW.sede_id,
        -v_det.cantidad, v_cant, v_cant - v_det.cantidad, NEW.id, 'ensamble', NEW.realizado_por);

      v_costo := v_costo + (v_det.costo_unitario * v_det.cantidad);
      PERFORM fn_actualizar_estado_stock(v_det.producto_id, NEW.sede_id);
    END LOOP;

    INSERT INTO inventario (producto_id, sede_id, cantidad)
    VALUES (NEW.producto_resultado_id, NEW.sede_id, NEW.cantidad_producida)
    ON CONFLICT (producto_id, sede_id)
    DO UPDATE SET cantidad = inventario.cantidad + NEW.cantidad_producida,
      ultimo_movimiento = now(), updated_at = now();

    INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id)
    VALUES ('ensamble_produccion', NEW.producto_resultado_id, NEW.sede_id,
      NEW.cantidad_producida, 0, NEW.cantidad_producida, NEW.id, 'ensamble', NEW.realizado_por);

    UPDATE ensambles SET costo_total = v_costo WHERE id = NEW.id;
    PERFORM fn_actualizar_estado_stock(NEW.producto_resultado_id, NEW.sede_id);
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_after_update_ensamble
  AFTER UPDATE OF completado ON ensambles
  FOR EACH ROW EXECUTE FUNCTION trg_ensamble_stock();

-- Trigger 6: Devolución reingresar stock
CREATE OR REPLACE FUNCTION trg_devolucion_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_cant INTEGER;
BEGIN
  IF NEW.estado = 'procesada' AND OLD.estado = 'aprobada' AND NEW.reingresa_stock = true THEN
    SELECT cantidad INTO v_cant FROM inventario
    WHERE producto_id = NEW.producto_id AND sede_id = NEW.sede_id FOR UPDATE;

    UPDATE inventario SET cantidad = cantidad + NEW.cantidad,
      ultimo_movimiento = now(), updated_at = now()
    WHERE producto_id = NEW.producto_id AND sede_id = NEW.sede_id;

    INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id)
    VALUES ('devolucion', NEW.producto_id, NEW.sede_id, NEW.cantidad,
      v_cant, v_cant + NEW.cantidad, NEW.id, 'devolucion', NEW.registrado_por);

    PERFORM fn_actualizar_estado_stock(NEW.producto_id, NEW.sede_id);
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_after_update_devolucion
  AFTER UPDATE OF estado ON devoluciones
  FOR EACH ROW EXECUTE FUNCTION trg_devolucion_stock();

-- Trigger 7: Orden consumir repuesto
CREATE OR REPLACE FUNCTION trg_orden_consumir_repuesto()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_orden RECORD; v_cant INTEGER;
BEGIN
  SELECT tecnico_id, sede_id INTO v_orden FROM ordenes_servicio WHERE id = NEW.orden_id;

  SELECT cantidad INTO v_cant FROM inventario
  WHERE producto_id = NEW.producto_id AND sede_id = v_orden.sede_id FOR UPDATE;

  IF v_cant < NEW.cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente de repuesto para orden de servicio';
  END IF;

  UPDATE inventario SET cantidad = cantidad - NEW.cantidad,
    ultimo_movimiento = now(), updated_at = now()
  WHERE producto_id = NEW.producto_id AND sede_id = v_orden.sede_id;

  INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id)
  VALUES ('orden_consumo', NEW.producto_id, v_orden.sede_id, -NEW.cantidad,
    v_cant, v_cant - NEW.cantidad, NEW.orden_id, 'orden_servicio', v_orden.tecnico_id);

  UPDATE ordenes_servicio SET
    costo_repuestos = (SELECT COALESCE(SUM(subtotal), 0) FROM detalle_orden WHERE orden_id = NEW.orden_id),
    total = costo_mano_obra + (SELECT COALESCE(SUM(subtotal), 0) FROM detalle_orden WHERE orden_id = NEW.orden_id)
  WHERE id = NEW.orden_id;

  PERFORM fn_actualizar_estado_stock(NEW.producto_id, v_orden.sede_id);
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_after_insert_detalle_orden
  AFTER INSERT ON detalle_orden
  FOR EACH ROW EXECUTE FUNCTION trg_orden_consumir_repuesto();

-- Trigger 8: Recalcular totales de venta
CREATE OR REPLACE FUNCTION trg_recalcular_total_venta()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_subtotal NUMERIC(12,2); v_venta RECORD;
BEGIN
  SELECT COALESCE(SUM(subtotal), 0) INTO v_subtotal
  FROM detalle_venta WHERE venta_id = COALESCE(NEW.venta_id, OLD.venta_id);

  SELECT descuento_pct, iva_pct INTO v_venta
  FROM ventas WHERE id = COALESCE(NEW.venta_id, OLD.venta_id);

  UPDATE ventas SET subtotal = v_subtotal,
    total = v_subtotal * (1 - v_venta.descuento_pct / 100) * (1 + v_venta.iva_pct / 100)
  WHERE id = COALESCE(NEW.venta_id, OLD.venta_id);

  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE TRIGGER trg_recalcular_venta
  AFTER INSERT OR DELETE ON detalle_venta
  FOR EACH ROW EXECUTE FUNCTION trg_recalcular_total_venta();

-- Función ABC (cron semanal)
CREATE OR REPLACE FUNCTION fn_recalcular_abc()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  WITH ventas_90d AS (
    SELECT dv.producto_id, SUM(dv.subtotal) AS total_vendido
    FROM detalle_venta dv JOIN ventas v ON v.id = dv.venta_id
    WHERE v.fecha >= now() - INTERVAL '90 days' AND v.anulada = false
    GROUP BY dv.producto_id
  ),
  ranked AS (
    SELECT producto_id, total_vendido,
      SUM(total_vendido) OVER (ORDER BY total_vendido DESC) /
      NULLIF(SUM(total_vendido) OVER (), 0) * 100 AS pct_acum
    FROM ventas_90d
  )
  UPDATE productos SET
    clasificacion = CASE
      WHEN r.pct_acum <= 80 THEN 'A'
      WHEN r.pct_acum <= 95 THEN 'B'
      ELSE 'C'
    END, updated_at = now()
  FROM ranked r WHERE productos.id = r.producto_id;

  UPDATE productos SET clasificacion = 'C', updated_at = now()
  WHERE id NOT IN (
    SELECT DISTINCT dv.producto_id FROM detalle_venta dv
    JOIN ventas v ON v.id = dv.venta_id
    WHERE v.fecha >= now() - INTERVAL '90 days'
  ) AND activo = true;
END; $$;

-- Protección soft-delete
CREATE OR REPLACE FUNCTION trg_prevent_delete()
RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'DELETE no permitido. Use soft delete.'; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_no_delete_inventario BEFORE DELETE ON inventario
  FOR EACH ROW EXECUTE FUNCTION trg_prevent_delete();
CREATE TRIGGER trg_no_delete_movimientos BEFORE DELETE ON movimientos
  FOR EACH ROW EXECUTE FUNCTION trg_prevent_delete();
