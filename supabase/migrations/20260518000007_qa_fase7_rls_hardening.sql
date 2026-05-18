-- QA Campaña — Fase 7 (Órdenes + Ensambles + Herramientas)
--
-- Hallazgo F7-01/02: `ordenes_servicio` y `herramientas_prestamo` tenían cada
-- una DOS conjuntos de políticas RLS: las granulares correctas (`os_*`/`hp_*`,
-- con restricción de sede, rol y estado) y una política legacy permisiva
-- (`ord_all` con rol Admin/Tecnico sin sede; `herr_all` con `USING (true)`).
-- PostgreSQL combina políticas PERMISSIVE con OR, así que la legacy ANULABA
-- por completo a la granular: un Técnico podía editar OTs de otra sede o ya
-- entregadas, y CUALQUIER autenticado podía manipular `herramientas_prestamo`.
--
-- Fix: eliminar las políticas legacy. Las granulares cubren todos los flujos
-- reales (verificado: crear herramienta = INSERT solo-Admin; prestar/devolver
-- = UPDATE por sede; OT INSERT/UPDATE por sede+técnico).
--
-- Hallazgo F7-03: `abonos_write` (cmd=ALL) permitía a un Vendedor registrar y
-- a un Técnico ELIMINAR abonos (pagos) — la UI solo muestra borrar a Admin.
-- Se separa: INSERT para Admin/Técnico (sede de la OT), DELETE solo Admin.
--
-- Hallazgo F7-04: `ordenes_servicio.costo_mano_obra` sin CHECK de no-negativo.

DROP POLICY IF EXISTS ord_all  ON public.ordenes_servicio;
DROP POLICY IF EXISTS herr_all ON public.herramientas_prestamo;

DROP POLICY IF EXISTS abonos_write ON public.abonos;

CREATE POLICY abonos_insert ON public.abonos
  FOR INSERT TO authenticated
  WITH CHECK (
    registrado_por = auth.uid()
    AND get_my_rol() IN ('Admin', 'Tecnico')
    AND EXISTS (
      SELECT 1 FROM ordenes_servicio o
      WHERE o.id = orden_id
        AND (get_my_rol() = 'Admin' OR o.sede_id = get_my_sede_id())
    )
  );

CREATE POLICY abonos_delete ON public.abonos
  FOR DELETE TO authenticated
  USING (get_my_rol() = 'Admin');

ALTER TABLE public.ordenes_servicio
  ADD CONSTRAINT chk_ot_costo_mo_no_neg
  CHECK (costo_mano_obra IS NULL OR costo_mano_obra >= 0);
