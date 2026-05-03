-- ============================================================================
-- Recovery idempotente para migration 04
--
-- La migration 20260502000004 se quedó a medias por chocar con políticas que
-- ya había creado (mov_insert_block). Este script DROP-IF-EXISTS todo y
-- vuelve a aplicar las secciones después del punto de falla. Es seguro
-- correrlo múltiples veces.
-- ============================================================================

-- ── Limpiar TODAS las policies que la migration 04 toca ────────────────────

-- movimientos
DROP POLICY IF EXISTS "mov_select" ON movimientos;
DROP POLICY IF EXISTS "mov_insert_block" ON movimientos;

-- inventario
DROP POLICY IF EXISTS "inv_select" ON inventario;
DROP POLICY IF EXISTS "inv_modify_block" ON inventario;
DROP POLICY IF EXISTS "inv_modify" ON inventario;

-- productos
DROP POLICY IF EXISTS "prod_all" ON productos;
DROP POLICY IF EXISTS "prod_select" ON productos;
DROP POLICY IF EXISTS "prod_modify" ON productos;

-- usuarios
DROP POLICY IF EXISTS "u_update_self" ON usuarios;

-- ventas
DROP POLICY IF EXISTS "ventas_select" ON ventas;
DROP POLICY IF EXISTS "ventas_insert" ON ventas;
DROP POLICY IF EXISTS "ventas_update" ON ventas;

-- detalle_venta
DROP POLICY IF EXISTS "dv_all" ON detalle_venta;
DROP POLICY IF EXISTS "dv_select" ON detalle_venta;
DROP POLICY IF EXISTS "dv_write" ON detalle_venta;

-- detalle_traspaso
DROP POLICY IF EXISTS "dt_all" ON detalle_traspaso;
DROP POLICY IF EXISTS "dt_select" ON detalle_traspaso;
DROP POLICY IF EXISTS "dt_write" ON detalle_traspaso;

-- ── Recrear todas las policies (igual que en migration 04) ─────────────────

-- ventas
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

-- detalle_venta
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

-- detalle_traspaso
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

-- movimientos
CREATE POLICY "mov_select" ON movimientos
  FOR SELECT TO authenticated
  USING (
    (SELECT get_my_rol()) = 'Admin'
    OR sede_id = (SELECT get_my_sede_id())
  );

CREATE POLICY "mov_insert_block" ON movimientos
  FOR INSERT TO authenticated
  WITH CHECK (false);

-- inventario
CREATE POLICY "inv_select" ON inventario
  FOR SELECT TO authenticated
  USING (
    (SELECT get_my_rol()) = 'Admin'
    OR sede_id = (SELECT get_my_sede_id())
  );

CREATE POLICY "inv_modify_block" ON inventario
  FOR ALL TO authenticated
  USING ((SELECT get_my_rol()) = 'Admin')
  WITH CHECK ((SELECT get_my_rol()) = 'Admin');

-- productos
CREATE POLICY "prod_select" ON productos
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "prod_modify" ON productos
  FOR ALL TO authenticated
  USING ((SELECT get_my_rol()) IN ('Admin', 'Bodeguero'))
  WITH CHECK ((SELECT get_my_rol()) IN ('Admin', 'Bodeguero'));

-- usuarios.u_update_self
CREATE POLICY "u_update_self" ON usuarios
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- ── Verificar que el trigger trg_orden_validar_transicion incluye fecha_entrega ─

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

  IF NEW.estado = 'entregada' AND NEW.fecha_entrega IS NULL THEN
    NEW.fecha_entrega := now();
  END IF;

  RETURN NEW;
END;
$$;

-- ── Trigger trg_usuarios_inmutables ────────────────────────────────────────

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
    RETURN NEW;
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
