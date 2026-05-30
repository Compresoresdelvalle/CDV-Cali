-- ============================================================================
-- Bloque 2 — A3b: ajuste de los triggers de consumo para que OT y los
-- COMPONENTES de ensamble consuman del POOL DE INSUMO (cantidad_insumo).
-- El producto RESULTANTE del ensamble sigue entrando a `cantidad` (venta).
--
-- ⚠️ ROMPEDOR EN VIVO — aplicar SOLO junto con el deploy del frontend del
-- Bloque 2 (y normalmente junto con A4 ...0008, la migración de los 31 insumos).
-- Mientras el frontend viejo siga en prod, esto haría fallar OT/ensambles con
-- repuestos normales (cantidad_insumo=0) hasta convertir su stock a insumo.
-- ============================================================================

-- ── Trigger: OT consume repuestos del POOL DE INSUMO ────────────────────────
CREATE OR REPLACE FUNCTION public.trg_orden_consumir_repuesto()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_orden RECORD; v_cant INTEGER;
BEGIN
  SELECT tecnico_id, sede_id INTO v_orden FROM ordenes_servicio WHERE id = NEW.orden_id;

  -- Bloque 2: las OT consumen del POOL DE INSUMO (cantidad_insumo), no de venta.
  SELECT cantidad_insumo INTO v_cant FROM inventario
  WHERE producto_id = NEW.producto_id AND sede_id = v_orden.sede_id FOR UPDATE;

  IF v_cant IS NULL OR v_cant < NEW.cantidad THEN
    RAISE EXCEPTION 'Stock de insumo insuficiente para la orden de servicio (disponible: %, requerido: %). Convierte stock de venta a insumo primero.',
      COALESCE(v_cant, 0), NEW.cantidad;
  END IF;

  UPDATE inventario SET cantidad_insumo = cantidad_insumo - NEW.cantidad,
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
END;
$function$;

-- ── Trigger: reversa de repuesto de OT devuelve al POOL DE INSUMO ───────────
CREATE OR REPLACE FUNCTION public.trg_orden_revertir_repuesto()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_orden RECORD;
  v_cant_actual INTEGER;
BEGIN
  SELECT tecnico_id, sede_id INTO v_orden FROM ordenes_servicio WHERE id = OLD.orden_id;

  SELECT cantidad_insumo INTO v_cant_actual FROM inventario
   WHERE producto_id = OLD.producto_id AND sede_id = v_orden.sede_id FOR UPDATE;

  IF v_cant_actual IS NULL THEN
    INSERT INTO inventario (producto_id, sede_id, cantidad_insumo)
    VALUES (OLD.producto_id, v_orden.sede_id, OLD.cantidad);
    v_cant_actual := 0;
  ELSE
    UPDATE inventario
       SET cantidad_insumo = cantidad_insumo + OLD.cantidad,
           ultimo_movimiento = now(), updated_at = now()
     WHERE producto_id = OLD.producto_id AND sede_id = v_orden.sede_id;
  END IF;

  INSERT INTO movimientos (
    tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id, observaciones
  )
  VALUES (
    'devolucion', OLD.producto_id, v_orden.sede_id, OLD.cantidad,
    v_cant_actual, v_cant_actual + OLD.cantidad,
    OLD.orden_id, 'orden_servicio',
    COALESCE(auth.uid(), v_orden.tecnico_id),
    'Reversa por eliminación de repuesto (insumo)'
  );

  PERFORM fn_actualizar_estado_stock(OLD.producto_id, v_orden.sede_id);
  RETURN OLD;
END;
$function$;

-- ── Trigger: ensamble consume COMPONENTES de insumo; produce TERMINADO a venta ──
CREATE OR REPLACE FUNCTION public.trg_ensamble_stock()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_det RECORD; v_cant INTEGER; v_stock_resultado INTEGER;
  v_costo NUMERIC := 0; v_nombre_falta TEXT;
BEGIN
  IF NEW.completado = true AND (OLD.completado = false OR OLD.completado IS NULL) THEN
    PERFORM pg_advisory_xact_lock(hashtext('ensamble:' || NEW.id::text));
    PERFORM 1 FROM ensambles WHERE id = NEW.id FOR UPDATE;

    -- Componentes = insumos: se consumen del POOL DE INSUMO (cantidad_insumo).
    FOR v_det IN SELECT * FROM detalle_ensamble WHERE ensamble_id = NEW.id LOOP
      SELECT cantidad_insumo INTO v_cant FROM inventario
       WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_id FOR UPDATE;
      IF v_cant IS NULL OR v_cant < v_det.cantidad THEN
        SELECT nombre INTO v_nombre_falta FROM productos WHERE id = v_det.producto_id;
        RAISE EXCEPTION 'Stock de insumo insuficiente del componente "%" (necesita %, hay %). Convierte stock de venta a insumo primero.',
          COALESCE(v_nombre_falta, v_det.producto_id::text),
          v_det.cantidad, COALESCE(v_cant, 0);
      END IF;
      UPDATE inventario SET cantidad_insumo = cantidad_insumo - v_det.cantidad,
        ultimo_movimiento = now(), updated_at = now()
       WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_id;
      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id)
      VALUES ('ensamble_consumo', v_det.producto_id, NEW.sede_id, -v_det.cantidad,
        v_cant, v_cant - v_det.cantidad, NEW.id, 'ensamble', NEW.realizado_por);
      v_costo := v_costo + (v_det.costo_unitario * v_det.cantidad);
      PERFORM fn_actualizar_estado_stock(v_det.producto_id, NEW.sede_id);
    END LOOP;

    -- Producto resultante = terminado VENDIBLE: entra al stock de VENTA (cantidad).
    SELECT cantidad INTO v_stock_resultado FROM inventario
     WHERE producto_id = NEW.producto_resultado_id AND sede_id = NEW.sede_id FOR UPDATE;
    IF v_stock_resultado IS NULL THEN
      INSERT INTO inventario (producto_id, sede_id, cantidad)
      VALUES (NEW.producto_resultado_id, NEW.sede_id, NEW.cantidad_producida);
      v_stock_resultado := 0;
    ELSE
      UPDATE inventario SET cantidad = cantidad + NEW.cantidad_producida,
        ultimo_movimiento = now(), updated_at = now()
       WHERE producto_id = NEW.producto_resultado_id AND sede_id = NEW.sede_id;
    END IF;
    INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id)
    VALUES ('ensamble_produccion', NEW.producto_resultado_id, NEW.sede_id,
      NEW.cantidad_producida, v_stock_resultado, v_stock_resultado + NEW.cantidad_producida,
      NEW.id, 'ensamble', NEW.realizado_por);
    UPDATE ensambles SET costo_total = v_costo WHERE id = NEW.id;
    PERFORM fn_actualizar_estado_stock(NEW.producto_resultado_id, NEW.sede_id);
  END IF;
  RETURN NEW;
END;
$function$;
