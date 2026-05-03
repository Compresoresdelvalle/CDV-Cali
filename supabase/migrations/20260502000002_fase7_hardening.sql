-- ============================================================================
-- Fase 7 — Hardening (CRITICAL/HIGH/MEDIUM/LOW)
--
-- Aplica DESPUÉS de 20260502000001_fase7_ordenes_fixes.sql
--
-- Problemas resueltos:
--   DB-1  search_path injection en funciones SECURITY DEFINER
--   DB-2  RLS llamando funciones por fila — wrap con (SELECT ...)
--   H-4   índices faltantes en sede_id y producto_id
--   H-5   SUM(subtotal) ejecutado dos veces por trigger
--   M-1   os_update sin restricción de columnas
--   M-2   RLS estricta en usuarios.rol (impedir auto-elevación)
--   L-2   os_insert sin WITH CHECK de sede_id
--   DB-9  movimiento de reversa atribuido al técnico, no al actor real
--   DB-10 trg_orden_recalcular_totales promovido a SECURITY DEFINER
--   RLS faltante en herramientas_prestamo (CRITICAL C-1)
-- ============================================================================

-- ── 0) Reescribir TRIGGERS con SET search_path = public, pg_temp ───────────

CREATE OR REPLACE FUNCTION trg_orden_revertir_repuesto()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  -- DB-9: usar el actor real (auth.uid()) en vez del técnico de la orden
  INSERT INTO movimientos (
    tipo, producto_id, sede_id, cantidad,
    stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id, observaciones
  )
  VALUES (
    'devolucion', OLD.producto_id, v_orden.sede_id, OLD.cantidad,
    v_cant_actual, v_cant_actual + OLD.cantidad,
    OLD.orden_id, 'orden_servicio',
    COALESCE(auth.uid(), v_orden.tecnico_id),
    'Reversa por eliminación de repuesto'
  );

  PERFORM fn_actualizar_estado_stock(OLD.producto_id, v_orden.sede_id);
  RETURN OLD;
END;
$$;

-- DB-10: promover a SECURITY DEFINER + H-5: una sola subquery
CREATE OR REPLACE FUNCTION trg_orden_recalcular_totales()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_orden_id UUID;
  v_sum NUMERIC(12,2);
BEGIN
  v_orden_id := COALESCE(NEW.orden_id, OLD.orden_id);

  SELECT COALESCE(SUM(subtotal), 0) INTO v_sum
    FROM detalle_orden WHERE orden_id = v_orden_id;

  UPDATE ordenes_servicio o
     SET costo_repuestos = v_sum,
         total = o.costo_mano_obra + v_sum,
         updated_at = now()
   WHERE id = v_orden_id;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_orden_recalcular_total_mo()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.estado = 'entregada' AND NEW.estado = 'entregada' THEN
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

CREATE OR REPLACE FUNCTION trg_orden_validar_transicion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
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
    RAISE EXCEPTION 'Transición inválida: % -> %', OLD.estado, NEW.estado;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 1) DB-2: RLS optimizada — wrap funciones en (SELECT …) ─────────────────
-- Esto fuerza a PostgreSQL a evaluarlas una sola vez por consulta (InitPlan)
-- en vez de por cada fila escaneada.

DROP POLICY IF EXISTS "do_select" ON detalle_orden;
DROP POLICY IF EXISTS "do_write" ON detalle_orden;

CREATE POLICY "do_select" ON detalle_orden
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ordenes_servicio o
       WHERE o.id = detalle_orden.orden_id
         AND ((SELECT get_my_rol()) = 'Admin'
              OR o.sede_id = (SELECT get_my_sede_id()))
    )
  );

CREATE POLICY "do_write" ON detalle_orden
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ordenes_servicio o
       WHERE o.id = detalle_orden.orden_id
         AND o.estado <> 'entregada'
         AND ((SELECT get_my_rol()) = 'Admin'
              OR o.tecnico_id = (SELECT auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ordenes_servicio o
       WHERE o.id = detalle_orden.orden_id
         AND o.estado <> 'entregada'
         AND ((SELECT get_my_rol()) = 'Admin'
              OR o.tecnico_id = (SELECT auth.uid()))
    )
  );

-- ── 2) ordenes_servicio: M-1 + L-2 — restricciones de columnas ─────────────

DROP POLICY IF EXISTS "os_select" ON ordenes_servicio;
DROP POLICY IF EXISTS "os_insert" ON ordenes_servicio;
DROP POLICY IF EXISTS "os_update" ON ordenes_servicio;

CREATE POLICY "os_select" ON ordenes_servicio
  FOR SELECT TO authenticated
  USING (
    (SELECT get_my_rol()) = 'Admin'
    OR sede_id = (SELECT get_my_sede_id())
  );

-- L-2: WITH CHECK incluye sede_id consistente con la sede del usuario (excepto Admin)
CREATE POLICY "os_insert" ON ordenes_servicio
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT get_my_rol()) IN ('Admin', 'Tecnico')
    AND (
      (SELECT get_my_rol()) = 'Admin'
      OR sede_id = (SELECT get_my_sede_id())
    )
  );

-- M-1: técnico solo puede actualizar SU sede; nunca cambiar tecnico_id ni sede_id
CREATE POLICY "os_update" ON ordenes_servicio
  FOR UPDATE TO authenticated
  USING (
    estado <> 'entregada'
    AND ((SELECT get_my_rol()) = 'Admin'
         OR tecnico_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    estado <> 'entregada'
    AND ((SELECT get_my_rol()) = 'Admin'
         OR (tecnico_id = (SELECT auth.uid())
             AND sede_id = (SELECT get_my_sede_id())))
  );

-- ── 3) C-1: RLS en herramientas_prestamo ───────────────────────────────────

ALTER TABLE herramientas_prestamo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hp_all" ON herramientas_prestamo;
DROP POLICY IF EXISTS "hp_select" ON herramientas_prestamo;
DROP POLICY IF EXISTS "hp_insert" ON herramientas_prestamo;
DROP POLICY IF EXISTS "hp_update" ON herramientas_prestamo;

CREATE POLICY "hp_select" ON herramientas_prestamo
  FOR SELECT TO authenticated
  USING (
    (SELECT get_my_rol()) = 'Admin'
    OR sede_id = (SELECT get_my_sede_id())
  );

-- Solo Admin crea herramientas (matches comportamiento del modal)
CREATE POLICY "hp_insert" ON herramientas_prestamo
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT get_my_rol()) = 'Admin');

-- Cualquier usuario de la sede puede prestar/devolver, pero la sede no cambia
CREATE POLICY "hp_update" ON herramientas_prestamo
  FOR UPDATE TO authenticated
  USING (
    (SELECT get_my_rol()) = 'Admin'
    OR sede_id = (SELECT get_my_sede_id())
  )
  WITH CHECK (
    (SELECT get_my_rol()) = 'Admin'
    OR sede_id = (SELECT get_my_sede_id())
  );

-- ── 4) M-2: RLS estricta en usuarios — impedir auto-elevación de rol ───────

DROP POLICY IF EXISTS "u_select" ON usuarios;
DROP POLICY IF EXISTS "u_update" ON usuarios;
DROP POLICY IF EXISTS "u_insert" ON usuarios;

CREATE POLICY "u_select" ON usuarios
  FOR SELECT TO authenticated
  USING (true);  -- todos pueden ver lista de usuarios para selectores

CREATE POLICY "u_insert" ON usuarios
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT get_my_rol()) = 'Admin');

-- Un usuario puede actualizar su propio nombre, pero NO su rol/sede/activo.
-- Solo Admin puede cambiar rol/sede/activo de cualquier usuario.
CREATE POLICY "u_update_self" ON usuarios
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (
    id = (SELECT auth.uid())
    AND rol = (SELECT u2.rol FROM usuarios u2 WHERE u2.id = (SELECT auth.uid()))
    AND sede_id = (SELECT u2.sede_id FROM usuarios u2 WHERE u2.id = (SELECT auth.uid()))
    AND activo = (SELECT u2.activo FROM usuarios u2 WHERE u2.id = (SELECT auth.uid()))
  );

CREATE POLICY "u_update_admin" ON usuarios
  FOR UPDATE TO authenticated
  USING ((SELECT get_my_rol()) = 'Admin')
  WITH CHECK ((SELECT get_my_rol()) = 'Admin');

-- ── 5) H-4: Índices faltantes ──────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ordenes_sede
  ON ordenes_servicio(sede_id);

CREATE INDEX IF NOT EXISTS idx_ordenes_sede_estado
  ON ordenes_servicio(sede_id, estado);

CREATE INDEX IF NOT EXISTS idx_detalle_orden_producto
  ON detalle_orden(producto_id);

CREATE INDEX IF NOT EXISTS idx_herramientas_sede
  ON herramientas_prestamo(sede_id);

CREATE INDEX IF NOT EXISTS idx_herramientas_prestada_a
  ON herramientas_prestamo(prestada_a) WHERE prestada_a IS NOT NULL;
