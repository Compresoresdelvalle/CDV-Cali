-- ============================================================================
-- Audit Fases 7-8 — Cierra hallazgos POST-FIX detectados por 4 agentes
-- Aplicado via MCP el 2026-05-03 (este archivo es para reproducibilidad)
-- ============================================================================

-- ── 1) v_sugerencias_reorden con security_invoker (HIGH F8) ────────────────
-- Sin esto, la vista corre con permisos del owner (postgres) y bypassa RLS
-- de inventario/productos → Vendedor ve sugerencias cross-sede.
ALTER VIEW v_sugerencias_reorden SET (security_invoker = true);

-- ── 2) REVOKE EXECUTE FROM anon en RPCs Fase 8 (MED F8) ────────────────────
REVOKE EXECUTE ON FUNCTION fn_dashboard_kpis() FROM anon, public;
GRANT EXECUTE ON FUNCTION fn_dashboard_kpis() TO authenticated;
REVOKE EXECUTE ON FUNCTION fn_top_productos(INTEGER, INTEGER) FROM anon, public;
GRANT EXECUTE ON FUNCTION fn_top_productos(INTEGER, INTEGER) TO authenticated;
REVOKE EXECUTE ON FUNCTION fn_aplicar_ajuste_conteo(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION fn_aplicar_ajuste_conteo(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION fn_registrar_conteo(UUID, INTEGER, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION fn_registrar_conteo(UUID, INTEGER, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION fn_recalcular_abc() FROM anon, public;
GRANT EXECUTE ON FUNCTION fn_recalcular_abc() TO authenticated;

-- ── 3) trg_ensamble_stock con pg_advisory_xact_lock + FOR UPDATE (HIGH F7) ─
CREATE OR REPLACE FUNCTION trg_ensamble_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_det RECORD; v_cant INTEGER; v_stock_resultado INTEGER;
  v_costo NUMERIC := 0; v_nombre_falta TEXT;
BEGIN
  IF NEW.completado = true AND (OLD.completado = false OR OLD.completado IS NULL) THEN
    PERFORM pg_advisory_xact_lock(hashtext('ensamble:' || NEW.id::text));
    PERFORM 1 FROM ensambles WHERE id = NEW.id FOR UPDATE;
    FOR v_det IN SELECT * FROM detalle_ensamble WHERE ensamble_id = NEW.id LOOP
      SELECT cantidad INTO v_cant FROM inventario
       WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_id FOR UPDATE;
      IF v_cant IS NULL OR v_cant < v_det.cantidad THEN
        SELECT nombre INTO v_nombre_falta FROM productos WHERE id = v_det.producto_id;
        RAISE EXCEPTION 'Stock insuficiente del componente "%" (necesita %, hay %)',
          COALESCE(v_nombre_falta, v_det.producto_id::text), v_det.cantidad, COALESCE(v_cant, 0);
      END IF;
      UPDATE inventario SET cantidad = cantidad - v_det.cantidad,
        ultimo_movimiento = now(), updated_at = now()
       WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_id;
      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id)
      VALUES ('ensamble_consumo', v_det.producto_id, NEW.sede_id, -v_det.cantidad,
        v_cant, v_cant - v_det.cantidad, NEW.id, 'ensamble', NEW.realizado_por);
      v_costo := v_costo + (v_det.costo_unitario * v_det.cantidad);
      PERFORM fn_actualizar_estado_stock(v_det.producto_id, NEW.sede_id);
    END LOOP;
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
END; $$;

-- ── 4) fn_aplicar_ajuste_conteo: validar stock_fisico IS NOT NULL ──────────
CREATE OR REPLACE FUNCTION fn_aplicar_ajuste_conteo(p_conteo_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_conteo conteos%ROWTYPE; v_rol TEXT; v_uid UUID := auth.uid(); v_stock_actual INTEGER;
BEGIN
  SELECT rol::TEXT INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol <> 'Admin' THEN RAISE EXCEPTION 'Solo Admin puede aplicar ajustes de conteo'; END IF;
  SELECT * INTO v_conteo FROM conteos WHERE id = p_conteo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conteo no encontrado'; END IF;
  IF v_conteo.ajuste_aplicado THEN RAISE EXCEPTION 'Este conteo ya fue ajustado'; END IF;
  IF v_conteo.stock_fisico IS NULL THEN RAISE EXCEPTION 'stock_fisico es NULL — conteo corrupto'; END IF;
  SELECT cantidad INTO v_stock_actual FROM inventario
   WHERE producto_id = v_conteo.producto_id AND sede_id = v_conteo.sede_id FOR UPDATE;
  UPDATE inventario SET cantidad = v_conteo.stock_fisico,
    ultimo_movimiento = now(), updated_at = now()
   WHERE producto_id = v_conteo.producto_id AND sede_id = v_conteo.sede_id;
  INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id, observaciones)
  VALUES ('conteo_ajuste', v_conteo.producto_id, v_conteo.sede_id, v_conteo.diferencia,
    v_stock_actual, v_conteo.stock_fisico, v_conteo.id, 'conteo', v_uid, 'Ajuste de conteo cíclico');
  UPDATE conteos SET ajuste_aplicado = true, aprobado_por = v_uid WHERE id = p_conteo_id;
  PERFORM fn_actualizar_estado_stock(v_conteo.producto_id, v_conteo.sede_id);
  RETURN jsonb_build_object('ok', true, 'diferencia', v_conteo.diferencia,
    'stock_anterior', v_stock_actual, 'stock_posterior', v_conteo.stock_fisico);
END; $$;

-- ── 5) fn_dashboard_kpis con LEFT JOIN en actividad_reciente (MED F8) ──────
-- Para no perder movimientos cuyo usuario_id sea NULL o de usuario eliminado
-- (ya está aplicado vía MCP, ver migración source para detalles del cuerpo).
