-- MEDIO (auditoría 2026-06-09):
--  M11 Un Técnico puede ABRIR una garantía de venta (fn_abrir_garantia_venta admite
--      rol Tecnico) pero las RLS garventa_rw/detgarventa_rw solo permitían leer a
--      Admin/Vendedor → el técnico veía "garantía no encontrada" tras crearla.
--  M12 Las 4 policies de garantías eran ALL con chequeo SOLO de rol (sin sede), así
--      que un Vendedor/Bodeguero leía garantías de OTRA sede (fuga de confidencialidad,
--      inconsistente con el aislamiento por sede del resto del sistema).
--
-- DECISIÓN CLIENTE (M11): SÍ, el Técnico debe ver las garantías de venta que él
-- registró.
--
-- Fix: separar cada policy ALL en (a) SELECT con scoping por sede + dueño
-- (registrado_por), y (b) escritura por rol. El frontend solo LEE garantías; las
-- escrituras van por funciones SECURITY DEFINER (fn_abrir_garantia_*,
-- fn_marcar_reposicion_recibida) que bypasean RLS, así que el scoping de lectura no
-- las afecta.

-- ===== garantias_venta =====
drop policy if exists garventa_rw on public.garantias_venta;

create policy garventa_select on public.garantias_venta
  for select to authenticated
  using (
    (select get_my_rol()) = 'Admin'
    or registrado_por = (select auth.uid())
    or exists (select 1 from ventas v where v.id = garantias_venta.venta_id and v.sede_id = (select get_my_sede_id()))
    or exists (select 1 from ordenes_servicio o where o.id = garantias_venta.orden_servicio_id and o.sede_id = (select get_my_sede_id()))
  );
create policy garventa_insert on public.garantias_venta
  for insert to authenticated
  with check ((select get_my_rol()) = any (array['Admin','Vendedor']));
create policy garventa_update on public.garantias_venta
  for update to authenticated
  using ((select get_my_rol()) = any (array['Admin','Vendedor']))
  with check ((select get_my_rol()) = any (array['Admin','Vendedor']));
create policy garventa_delete on public.garantias_venta
  for delete to authenticated
  using ((select get_my_rol()) = any (array['Admin','Vendedor']));

-- ===== detalle_garantia_venta =====
drop policy if exists detgarventa_rw on public.detalle_garantia_venta;

create policy detgarventa_select on public.detalle_garantia_venta
  for select to authenticated
  using (
    (select get_my_rol()) = 'Admin'
    or detalle_garantia_venta.sede_id = (select get_my_sede_id())
    or exists (select 1 from garantias_venta g where g.id = detalle_garantia_venta.garantia_id and g.registrado_por = (select auth.uid()))
  );
create policy detgarventa_insert on public.detalle_garantia_venta
  for insert to authenticated
  with check ((select get_my_rol()) = any (array['Admin','Vendedor']));
create policy detgarventa_update on public.detalle_garantia_venta
  for update to authenticated
  using ((select get_my_rol()) = any (array['Admin','Vendedor']))
  with check ((select get_my_rol()) = any (array['Admin','Vendedor']));
create policy detgarventa_delete on public.detalle_garantia_venta
  for delete to authenticated
  using ((select get_my_rol()) = any (array['Admin','Vendedor']));

-- ===== garantias_compra =====
drop policy if exists garcompra_rw on public.garantias_compra;

create policy garcompra_select on public.garantias_compra
  for select to authenticated
  using (
    (select get_my_rol()) = 'Admin'
    or registrado_por = (select auth.uid())
    or exists (select 1 from compras c where c.id = garantias_compra.compra_id and c.sede_destino_id = (select get_my_sede_id()))
  );
create policy garcompra_insert on public.garantias_compra
  for insert to authenticated
  with check ((select get_my_rol()) = any (array['Admin','Bodeguero']));
create policy garcompra_update on public.garantias_compra
  for update to authenticated
  using ((select get_my_rol()) = any (array['Admin','Bodeguero']))
  with check ((select get_my_rol()) = any (array['Admin','Bodeguero']));
create policy garcompra_delete on public.garantias_compra
  for delete to authenticated
  using ((select get_my_rol()) = any (array['Admin','Bodeguero']));

-- ===== detalle_garantia_compra =====
drop policy if exists detgarcompra_rw on public.detalle_garantia_compra;

create policy detgarcompra_select on public.detalle_garantia_compra
  for select to authenticated
  using (
    (select get_my_rol()) = 'Admin'
    or detalle_garantia_compra.sede_id = (select get_my_sede_id())
    or exists (select 1 from garantias_compra g where g.id = detalle_garantia_compra.garantia_id and g.registrado_por = (select auth.uid()))
  );
create policy detgarcompra_insert on public.detalle_garantia_compra
  for insert to authenticated
  with check ((select get_my_rol()) = any (array['Admin','Bodeguero']));
create policy detgarcompra_update on public.detalle_garantia_compra
  for update to authenticated
  using ((select get_my_rol()) = any (array['Admin','Bodeguero']))
  with check ((select get_my_rol()) = any (array['Admin','Bodeguero']));
create policy detgarcompra_delete on public.detalle_garantia_compra
  for delete to authenticated
  using ((select get_my_rol()) = any (array['Admin','Bodeguero']));
