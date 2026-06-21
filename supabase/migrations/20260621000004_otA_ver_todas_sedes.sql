-- ============================================================================
-- Rediseño OT — Opción A — FASE 1b: Visibilidad global, escritura por sede
-- Regla del negocio: TODOS pueden VER las OT de todas las sedes, pero solo
-- pueden MANIPULAR (crear/editar/descargar) las de su PROPIA sede.
-- (La escritura por sede ya quedó en la Fase 1: os_update / do_write.)
-- Aquí solo abrimos la LECTURA a todos los autenticados.
-- ============================================================================

-- Ver todas las OT (cualquier sede)
drop policy if exists os_select on ordenes_servicio;
create policy os_select on ordenes_servicio for select to authenticated
using (true);

-- Ver el detalle (repuestos) de cualquier OT
drop policy if exists do_select on detalle_orden;
create policy do_select on detalle_orden for select to authenticated
using (true);

-- Ver anticipos de cualquier OT
drop policy if exists abonos_read on abonos;
create policy abonos_read on abonos for select to authenticated
using (true);
