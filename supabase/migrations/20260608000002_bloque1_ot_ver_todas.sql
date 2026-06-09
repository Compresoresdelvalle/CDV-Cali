-- Bloque 1 — Permisos OT: los Vendedores VEN todas las órdenes de trabajo de
-- todas las sedes (lo pidió el cliente), pero la EDICIÓN sigue restringida por
-- sede vía os_update (que NO cambia). Técnico y Bodeguero conservan su alcance
-- por sede; Admin ve todo. Cambio acotado: solo amplía lectura para Vendedor.
--
-- Reversible: volver a `(get_my_rol()='Admin' OR sede_id=get_my_sede_id())`.

drop policy if exists os_select on public.ordenes_servicio;

create policy os_select on public.ordenes_servicio
  for select
  using (
    (select get_my_rol()) = any (array['Admin', 'Vendedor'])
    or sede_id = (select get_my_sede_id())
  );
