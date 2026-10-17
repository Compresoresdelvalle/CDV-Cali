-- Decisión de David (2026-10-17): las vendedoras leen los cierres de SU sede
-- (para ver el aviso "ese día ya tiene cierre" al registrar un cobro con fecha).
-- Los cierres globales (sede_id null) traen la plata de todas las sedes y no se abren.
drop policy if exists cierres_select_vendedor_su_sede on public.cierres;
create policy cierres_select_vendedor_su_sede on public.cierres
  for select to authenticated
  using ((select get_my_rol()) = 'Vendedor' and sede_id = (select get_my_sede_id()));
