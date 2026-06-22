-- ============================================================================
-- Rediseño OT — Opción A — FASE 1: Permisos "toderos"
-- La empresa es de toderos: cualquier rol de la SEDE de la OT puede operarla.
--   - detalle_orden: Admin o misma sede pueden descargar/editar repuestos
--     (antes solo Admin o el técnico asignado → el Vendedor no podía: FALLA 2).
--   - ordenes_servicio (update): Admin o misma sede, mientras no esté entregada.
-- Anular/cancelar siguen siendo SOLO Admin (vía sus funciones, fases posteriores).
-- ============================================================================

-- detalle_orden: escritura para Admin o cualquier usuario de la sede de la OT
drop policy if exists do_write on detalle_orden;
create policy do_write on detalle_orden for all to authenticated
using (exists (
  select 1 from ordenes_servicio o
  where o.id = detalle_orden.orden_id
    and o.estado <> all (array['entregada','cancelada']::estado_orden[])
    and ( (select get_my_rol()) = 'Admin'
          or o.sede_id = (select get_my_sede_id()) )
))
with check (exists (
  select 1 from ordenes_servicio o
  where o.id = detalle_orden.orden_id
    and o.estado <> all (array['entregada','cancelada']::estado_orden[])
    and ( (select get_my_rol()) = 'Admin'
          or o.sede_id = (select get_my_sede_id()) )
));

-- ordenes_servicio: update para Admin o cualquier usuario de la sede (no entregada)
drop policy if exists os_update on ordenes_servicio;
create policy os_update on ordenes_servicio for update to authenticated
using (
  estado <> 'entregada'
  and ( (select get_my_rol()) = 'Admin' or sede_id = (select get_my_sede_id()) )
)
with check (
  (select get_my_rol()) = 'Admin' or sede_id = (select get_my_sede_id())
);
