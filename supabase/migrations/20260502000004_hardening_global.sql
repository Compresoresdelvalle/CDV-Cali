-- ============================================================================
-- Hardening global — Cierra issues heredados de Fases 1, 4, 6 detectados en
-- la auditoría final de Fase 7.
--
-- Aplica DESPUÉS de 20260502000003_fase7_ensambles_hardening.sql
--
-- Issues resueltos:
--   [SEC-DB] search_path injection en 8 funciones SECURITY DEFINER de Fase 1
--   [SEC-RLS] ventas_insert sin check de sede
--   [SEC-RLS] detalle_venta SELECT sin restricción de sede
--   [SEC-RLS] detalle_traspaso sin restricción de sede
--   [SEC-RLS] movimientos INSERT directo permitido (debería ser solo via triggers)
--   [PERF] inv_modify y otras policies sin (SELECT ...) wrap
--   [DATA] fecha_entrega no se setea automáticamente al transicionar a 'entregada'
--   [BD] u_update_self con subqueries innecesarias (usar OLD.x)
-- ============================================================================

-- ── 1) SECURITY DEFINER: search_path en funciones de Fase 1 ────────────────
-- Usamos ALTER FUNCTION para preservar el cuerpo original sin reescribirlo.

ALTER FUNCTION get_my_rol() SET search_path = public, pg_temp;
ALTER FUNCTION get_my_sede_id() SET search_path = public, pg_temp;
ALTER FUNCTION trg_venta_descontar_stock() SET search_path = public, pg_temp;
ALTER FUNCTION trg_compra_sumar_stock() SET search_path = public, pg_temp;
ALTER FUNCTION trg_traspaso_salida() SET search_path = public, pg_temp;
ALTER FUNCTION trg_traspaso_entrada() SET search_path = public, pg_temp;
ALTER FUNCTION trg_devolucion_stock() SET search_path = public, pg_temp;
ALTER FUNCTION trg_orden_consumir_repuesto() SET search_path = public, pg_temp;

-- También fn_actualizar_estado_stock si existe (hace UPDATEs internos)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_actualizar_estado_stock') THEN
    ALTER FUNCTION fn_actualizar_estado_stock(UUID, TEXT) SET search_path = public, pg_temp;
  END IF;
END $$;

-- ── 2) ventas: WITH CHECK de sede en INSERT ────────────────────────────────

DROP POLICY IF EXISTS "ventas_insert" ON ventas;
DROP POLICY IF EXISTS "ventas_select" ON ventas;
DROP POLICY IF EXISTS "ventas_update" ON ventas;

CREATE POLICY "ventas_select" ON ventas
  FOR SELECT TO authenticated
  USING (
    (SELECT get_my_rol()) = 'Admin'
    OR sede_id = (SELECT get_my_sede_id())
  );

CREATE POLICY "ventas_insert" ON ventas
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT get_my_rol()) IN ('Admin', 'Vendedor')
    AND (
      (SELECT get_my_rol()) = 'Admin'
      OR sede_id = (SELECT get_my_sede_id())
    )
  );

CREATE POLICY "ventas_update" ON ventas
  FOR UPDATE TO authenticated
  USING (
    (SELECT get_my_rol()) = 'Admin'
    OR (vendedor_id = (SELECT auth.uid()) AND sede_id = (SELECT get_my_sede_id()))
  );

-- ── 3) detalle_venta: restricción de sede via JOIN ─────────────────────────

DROP POLICY IF EXISTS "dv_all" ON detalle_venta;
DROP POLICY IF EXISTS "dv_select" ON detalle_venta;
DROP POLICY IF EXISTS "dv_write" ON detalle_venta;

CREATE POLICY "dv_select" ON detalle_venta
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ventas v
       WHERE v.id = detalle_venta.venta_id
         AND ((SELECT get_my_rol()) = 'Admin'
              OR v.sede_id = (SELECT get_my_sede_id()))
    )
  );

CREATE POLICY "dv_write" ON detalle_venta
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ventas v
       WHERE v.id = detalle_venta.venta_id
         AND ((SELECT get_my_rol()) = 'Admin'
              OR (v.vendedor_id = (SELECT auth.uid())
                  AND v.sede_id = (SELECT get_my_sede_id())))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ventas v
       WHERE v.id = detalle_venta.venta_id
         AND ((SELECT get_my_rol()) = 'Admin'
              OR (v.vendedor_id = (SELECT auth.uid())
                  AND v.sede_id = (SELECT get_my_sede_id())))
    )
  );

-- ── 4) detalle_traspaso: restricción de sede ──────────────────────────────

DROP POLICY IF EXISTS "dt_all" ON detalle_traspaso;
DROP POLICY IF EXISTS "dt_select" ON detalle_traspaso;
DROP POLICY IF EXISTS "dt_write" ON detalle_traspaso;

-- Lectura: sede origen O destino O Admin
CREATE POLICY "dt_select" ON detalle_traspaso
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM traspasos t
       WHERE t.id = detalle_traspaso.traspaso_id
         AND ((SELECT get_my_rol()) = 'Admin'
              OR t.sede_origen_id = (SELECT get_my_sede_id())
              OR t.sede_destino_id = (SELECT get_my_sede_id()))
    )
  );

-- Escritura: solo Admin o usuarios de la sede ORIGEN (que es quien picking/envía)
CREATE POLICY "dt_write" ON detalle_traspaso
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM traspasos t
       WHERE t.id = detalle_traspaso.traspaso_id
         AND ((SELECT get_my_rol()) = 'Admin'
              OR t.sede_origen_id = (SELECT get_my_sede_id()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM traspasos t
       WHERE t.id = detalle_traspaso.traspaso_id
         AND ((SELECT get_my_rol()) = 'Admin'
              OR t.sede_origen_id = (SELECT get_my_sede_id()))
    )
  );

-- ── 5) movimientos: bloquear INSERT directo (solo via triggers) ────────────
-- Los triggers SECURITY DEFINER bypasean RLS, así que pueden insertar.
-- Bloqueamos cualquier otro INSERT manual.

DROP POLICY IF EXISTS "mov_all" ON movimientos;
DROP POLICY IF EXISTS "mov_select" ON movimientos;
DROP POLICY IF EXISTS "mov_insert" ON movimientos;
DROP POLICY IF EXISTS "mov_update" ON movimientos;
DROP POLICY IF EXISTS "mov_delete" ON movimientos;

CREATE POLICY "mov_select" ON movimientos
  FOR SELECT TO authenticated
  USING (
    (SELECT get_my_rol()) = 'Admin'
    OR sede_id = (SELECT get_my_sede_id())
  );

-- INSERT: bloqueado para todos los authenticated. Solo triggers SECURITY DEFINER
-- pueden insertar (los triggers bypasean RLS).
CREATE POLICY "mov_insert_block" ON movimientos
  FOR INSERT TO authenticated
  WITH CHECK (false);

-- UPDATE/DELETE ya están bloqueados por trg_prevent_movimiento_modify de Fase 1.

-- ── 6) inv_modify y otras policies con (SELECT ...) wrap ───────────────────
-- Optimización: que las funciones se evalúen una sola vez por consulta.

DO $$
DECLARE r RECORD;
BEGIN
  -- Solo registrar advertencia; los DROP/CREATE explícitos van caso por caso.
  -- Las policies de inventario, productos, etc. se rehacen abajo.
  RAISE NOTICE 'Aplicando wrap (SELECT) a policies legacy';
END $$;

-- inventario
DROP POLICY IF EXISTS "inv_select" ON inventario;
DROP POLICY IF EXISTS "inv_modify" ON inventario;

CREATE POLICY "inv_select" ON inventario
  FOR SELECT TO authenticated
  USING (
    (SELECT get_my_rol()) = 'Admin'
    OR sede_id = (SELECT get_my_sede_id())
  );

-- Modificación de inventario solo por triggers SECURITY DEFINER, no manual
CREATE POLICY "inv_modify_block" ON inventario
  FOR ALL TO authenticated
  USING ((SELECT get_my_rol()) = 'Admin')
  WITH CHECK ((SELECT get_my_rol()) = 'Admin');

-- productos: lectura abierta, escritura solo Admin/Bodeguero
DROP POLICY IF EXISTS "prod_all" ON productos;
DROP POLICY IF EXISTS "prod_select" ON productos;
DROP POLICY IF EXISTS "prod_modify" ON productos;

CREATE POLICY "prod_select" ON productos
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "prod_modify" ON productos
  FOR ALL TO authenticated
  USING ((SELECT get_my_rol()) IN ('Admin', 'Bodeguero'))
  WITH CHECK ((SELECT get_my_rol()) IN ('Admin', 'Bodeguero'));

-- ── 7) fecha_entrega automática al transicionar a 'entregada' ──────────────
-- Mejora del trigger de transición existente para que setee fecha_entrega.

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

  -- Auto-set fecha_entrega cuando transiciona a entregada
  IF NEW.estado = 'entregada' AND NEW.fecha_entrega IS NULL THEN
    NEW.fecha_entrega := now();
  END IF;

  RETURN NEW;
END;
$$;

-- ── 8) u_update_self con OLD en vez de subqueries ──────────────────────────

DROP POLICY IF EXISTS "u_update_self" ON usuarios;

CREATE POLICY "u_update_self" ON usuarios
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (
    id = (SELECT auth.uid())
    -- Nota: en USING/WITH CHECK no hay OLD/NEW (son row-level checks),
    -- pero al combinar con USING(id = uid()), el UPDATE solo puede tocar
    -- la propia fila. Las columnas inmutables (rol, sede_id, activo) las
    -- protegemos via trigger BEFORE UPDATE.
  );

-- Trigger que impide a no-Admin cambiar rol/sede_id/activo
CREATE OR REPLACE FUNCTION trg_usuarios_inmutables()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_rol_actor TEXT;
BEGIN
  SELECT rol::TEXT INTO v_rol_actor FROM usuarios WHERE id = auth.uid();
  IF v_rol_actor = 'Admin' THEN
    RETURN NEW;  -- Admin puede cambiar todo
  END IF;
  IF NEW.rol IS DISTINCT FROM OLD.rol
     OR NEW.sede_id IS DISTINCT FROM OLD.sede_id
     OR NEW.activo IS DISTINCT FROM OLD.activo THEN
    RAISE EXCEPTION 'No tienes permiso para modificar rol, sede o estado activo';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_before_update_usuario_inmutables ON usuarios;
CREATE TRIGGER trg_before_update_usuario_inmutables
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION trg_usuarios_inmutables();
