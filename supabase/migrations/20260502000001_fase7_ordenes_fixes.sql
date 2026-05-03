-- ============================================================================
-- Fase 7 — Fixes de integridad para Órdenes de Servicio
-- ============================================================================

-- ── 1) Trigger BEFORE DELETE en detalle_orden ──────────────────────────────
-- Repone stock y registra movimiento de reversa.

CREATE OR REPLACE FUNCTION trg_orden_revertir_repuesto()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_orden RECORD;
  v_cant_actual INTEGER;
BEGIN
  SELECT tecnico_id, sede_id INTO v_orden
    FROM ordenes_servicio WHERE id = OLD.orden_id;

  SELECT cantidad INTO v_cant_actual
    FROM inventario
   WHERE producto_id = OLD.producto_id AND sede_id = v_orden.sede_id
   FOR UPDATE;

  IF v_cant_actual IS NULL THEN
    -- Crear fila de inventario si no existía
    INSERT INTO inventario (producto_id, sede_id, cantidad)
    VALUES (OLD.producto_id, v_orden.sede_id, OLD.cantidad);
    v_cant_actual := 0;
  ELSE
    UPDATE inventario
       SET cantidad = cantidad + OLD.cantidad,
           ultimo_movimiento = now(),
           updated_at = now()
     WHERE producto_id = OLD.producto_id AND sede_id = v_orden.sede_id;
  END IF;

  -- Movimiento inverso (cantidad positiva, tipo 'devolucion')
  INSERT INTO movimientos (
    tipo, producto_id, sede_id, cantidad,
    stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id, observaciones
  )
  VALUES (
    'devolucion', OLD.producto_id, v_orden.sede_id, OLD.cantidad,
    v_cant_actual, v_cant_actual + OLD.cantidad,
    OLD.orden_id, 'orden_servicio', v_orden.tecnico_id,
    'Reversa por eliminación de repuesto'
  );

  PERFORM fn_actualizar_estado_stock(OLD.producto_id, v_orden.sede_id);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_before_delete_detalle_orden ON detalle_orden;
CREATE TRIGGER trg_before_delete_detalle_orden
  BEFORE DELETE ON detalle_orden
  FOR EACH ROW EXECUTE FUNCTION trg_orden_revertir_repuesto();

-- ── 2) Trigger AFTER DELETE/UPDATE para recalcular totales ─────────────────

CREATE OR REPLACE FUNCTION trg_orden_recalcular_totales()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_orden_id UUID;
BEGIN
  v_orden_id := COALESCE(NEW.orden_id, OLD.orden_id);

  UPDATE ordenes_servicio o
     SET costo_repuestos = COALESCE(
           (SELECT SUM(subtotal) FROM detalle_orden WHERE orden_id = v_orden_id),
           0
         ),
         total = o.costo_mano_obra + COALESCE(
           (SELECT SUM(subtotal) FROM detalle_orden WHERE orden_id = v_orden_id),
           0
         ),
         updated_at = now()
   WHERE id = v_orden_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_after_delete_detalle_orden ON detalle_orden;
CREATE TRIGGER trg_after_delete_detalle_orden
  AFTER DELETE ON detalle_orden
  FOR EACH ROW EXECUTE FUNCTION trg_orden_recalcular_totales();

DROP TRIGGER IF EXISTS trg_after_update_detalle_orden ON detalle_orden;
CREATE TRIGGER trg_after_update_detalle_orden
  AFTER UPDATE ON detalle_orden
  FOR EACH ROW EXECUTE FUNCTION trg_orden_recalcular_totales();

-- ── 3) Recalcular total cuando cambie costo_mano_obra ──────────────────────

CREATE OR REPLACE FUNCTION trg_orden_recalcular_total_mo()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Inmutabilidad: una orden entregada NO se puede modificar (excepto el propio
  -- cambio a entregada hecho por trg_orden_validar_transicion).
  IF OLD.estado = 'entregada' AND NEW.estado = 'entregada' THEN
    -- Permitir actualizaciones de campos puramente derivados (recalculados por
    -- otros triggers) pero impedir cambios manuales.
    IF NEW.costo_mano_obra IS DISTINCT FROM OLD.costo_mano_obra
       OR NEW.cliente_nombre IS DISTINCT FROM OLD.cliente_nombre
       OR NEW.cliente_telefono IS DISTINCT FROM OLD.cliente_telefono
       OR NEW.equipo_descripcion IS DISTINCT FROM OLD.equipo_descripcion
       OR NEW.diagnostico IS DISTINCT FROM OLD.diagnostico
       OR NEW.trabajo_realizado IS DISTINCT FROM OLD.trabajo_realizado THEN
      RAISE EXCEPTION 'No se puede modificar una orden entregada';
    END IF;
  END IF;

  IF NEW.costo_mano_obra IS DISTINCT FROM OLD.costo_mano_obra THEN
    NEW.total := NEW.costo_mano_obra + COALESCE(NEW.costo_repuestos, 0);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_before_update_orden_mo ON ordenes_servicio;
CREATE TRIGGER trg_before_update_orden_mo
  BEFORE UPDATE ON ordenes_servicio
  FOR EACH ROW EXECUTE FUNCTION trg_orden_recalcular_total_mo();

-- ── 4) Validación de transiciones de estado ────────────────────────────────

CREATE OR REPLACE FUNCTION trg_orden_validar_transicion()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = NEW.estado THEN
    RETURN NEW;
  END IF;

  IF OLD.estado = 'entregada' THEN
    RAISE EXCEPTION 'No se puede modificar una orden entregada';
  END IF;

  IF NOT (
    (OLD.estado = 'abierta' AND NEW.estado IN ('en_proceso', 'esperando_repuesto')) OR
    (OLD.estado = 'en_proceso' AND NEW.estado IN ('esperando_repuesto', 'completada')) OR
    (OLD.estado = 'esperando_repuesto' AND NEW.estado IN ('en_proceso', 'completada')) OR
    (OLD.estado = 'completada' AND NEW.estado = 'entregada')
  ) THEN
    RAISE EXCEPTION 'Transición de estado inválida: % -> %', OLD.estado, NEW.estado;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_before_update_orden_estado ON ordenes_servicio;
CREATE TRIGGER trg_before_update_orden_estado
  BEFORE UPDATE OF estado ON ordenes_servicio
  FOR EACH ROW EXECUTE FUNCTION trg_orden_validar_transicion();

-- ── 5) RLS estricta en detalle_orden ───────────────────────────────────────

DROP POLICY IF EXISTS "do_all" ON detalle_orden;
DROP POLICY IF EXISTS "do_select" ON detalle_orden;
DROP POLICY IF EXISTS "do_write" ON detalle_orden;

CREATE POLICY "do_select" ON detalle_orden
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ordenes_servicio o
       WHERE o.id = detalle_orden.orden_id
         AND (get_my_rol() = 'Admin' OR o.sede_id = get_my_sede_id())
    )
  );

CREATE POLICY "do_write" ON detalle_orden
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ordenes_servicio o
       WHERE o.id = detalle_orden.orden_id
         AND o.estado <> 'entregada'
         AND (get_my_rol() = 'Admin' OR o.tecnico_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ordenes_servicio o
       WHERE o.id = detalle_orden.orden_id
         AND o.estado <> 'entregada'
         AND (get_my_rol() = 'Admin' OR o.tecnico_id = auth.uid())
    )
  );

-- ── 6) RLS en ordenes_servicio (UPDATE limitado) ───────────────────────────

DROP POLICY IF EXISTS "os_all" ON ordenes_servicio;
DROP POLICY IF EXISTS "os_select" ON ordenes_servicio;
DROP POLICY IF EXISTS "os_insert" ON ordenes_servicio;
DROP POLICY IF EXISTS "os_update" ON ordenes_servicio;

CREATE POLICY "os_select" ON ordenes_servicio
  FOR SELECT TO authenticated
  USING (get_my_rol() = 'Admin' OR sede_id = get_my_sede_id());

CREATE POLICY "os_insert" ON ordenes_servicio
  FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() IN ('Admin', 'Tecnico'));

CREATE POLICY "os_update" ON ordenes_servicio
  FOR UPDATE TO authenticated
  USING (
    estado <> 'entregada'
    AND (get_my_rol() = 'Admin' OR tecnico_id = auth.uid())
  );
