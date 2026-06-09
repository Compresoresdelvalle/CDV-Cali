-- OT · checklist de recepción: permitir que los VENDEDORES la diligencien para
-- cualquier OT, sin importar la sede.
--
-- Contexto: las OTs son "ver todas" desde Bloque 1, y los técnicos están
-- centralizados en BODEGA mientras las OTs viven en las tiendas (CV/CHV/L3). La
-- política anterior sólo permitía escribir el checklist si eras Admin o si la
-- sede de la OT == tu sede, así que un vendedor que recibe un equipo de una OT
-- de otra sede chocaba con "new row violates row-level security policy".
--
-- Nuevo criterio (lectura y escritura del checklist): Admin, Vendedor (cualquier
-- sede), o personal de la misma sede de la OT.

drop policy if exists ot_checklist_rw on public.ot_checklist;

create policy ot_checklist_rw on public.ot_checklist
  for all
  using (
    exists (
      select 1
        from public.ordenes_servicio o
       where o.id = ot_checklist.orden_id
         and (
           (select get_my_rol()) in ('Admin', 'Vendedor')
           or o.sede_id = (select get_my_sede_id())
         )
    )
  )
  with check (
    exists (
      select 1
        from public.ordenes_servicio o
       where o.id = ot_checklist.orden_id
         and (
           (select get_my_rol()) in ('Admin', 'Vendedor')
           or o.sede_id = (select get_my_sede_id())
         )
    )
  );
