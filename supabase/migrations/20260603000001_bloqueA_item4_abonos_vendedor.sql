-- Bloque A · Ítem 4 — Vendedores autorizados a registrar abonos en OT.
--
-- Antes la policy `abonos_insert` solo permitía a Admin y Tecnico. El cliente
-- pidió que los Vendedores (que gestionan la OT como un técnico en su sede)
-- también puedan registrar abonos/anticipos. Se agrega 'Vendedor' al rol
-- permitido, conservando:
--   - registrado_por = auth.uid()  (no se puede registrar a nombre de otro)
--   - control de sede: no-Admin solo sobre OT de su propia sede.
-- Cambio aditivo y reversible (basta volver a la lista ['Admin','Tecnico']).

drop policy if exists abonos_insert on public.abonos;

create policy abonos_insert on public.abonos
  for insert
  with check (
    registrado_por = auth.uid()
    and get_my_rol() = any (array['Admin', 'Tecnico', 'Vendedor'])
    and exists (
      select 1
      from ordenes_servicio o
      where o.id = abonos.orden_id
        and (get_my_rol() = 'Admin' or o.sede_id = get_my_sede_id())
    )
  );
