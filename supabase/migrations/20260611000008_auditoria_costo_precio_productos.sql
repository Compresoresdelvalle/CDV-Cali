-- BAJO (auditoría 2026-06-09):
--  I2  — editar costo/precio de producto no dejaba rastro persistente (ni en las RPC
--        fn_editar_costo_producto/fn_editar_precio_producto ni en el PATCH directo de
--        ProductoEditar.jsx). Solo quedaba el último valor + un updated_at genérico.
--  low14 — trg_productos_costo_solo_admin solo cubría INSERT, no UPDATE; y anon tenía
--        privilegio de columna INSERT/UPDATE sobre costo_promedio/precio_venta (ocioso).
--
-- Fix:
--  (1) Tabla append-only productos_precio_costo_log + trigger AFTER UPDATE OF
--      costo_promedio/precio_venta sobre productos: registra TODO cambio (quién/cuándo/
--      de-cuánto-a-cuánto), cubriendo a la vez las RPC y el PATCH directo del Admin.
--  (2) Extender el guard a BEFORE INSERT OR UPDATE OF costo_promedio/precio_venta,
--      preservando OLD para no-Admin en UPDATE (defensa en profundidad; la RLS Admin-only
--      sigue siendo la barrera primaria).
--  (3) REVOKE de columnas a anon (anon nunca escribe productos). NO se revoca a
--      authenticated: ProductoEditar.jsx (Admin) hace UPDATE directo de esas columnas.

-- (1) Tabla de auditoría append-only --------------------------------------------------
create table if not exists public.productos_precio_costo_log (
  id            bigint generated always as identity primary key,
  producto_id   uuid not null references public.productos(id),
  campo         text not null check (campo in ('costo_promedio','precio_venta')),
  valor_anterior numeric,
  valor_nuevo   numeric,
  usuario_id    uuid,            -- nullable: no romper un UPDATE si auth.uid() es nulo (servicio)
  created_at    timestamptz not null default now()
);

create index if not exists idx_ppcl_producto on public.productos_precio_costo_log (producto_id, created_at desc);

alter table public.productos_precio_costo_log enable row level security;

drop policy if exists ppcl_select on public.productos_precio_costo_log;
create policy ppcl_select on public.productos_precio_costo_log
  for select using (get_my_rol() = 'Admin');

grant select on public.productos_precio_costo_log to authenticated;

-- append-only: ni UPDATE ni DELETE físicos
create or replace function public.trg_ppcl_append_only()
 returns trigger language plpgsql as $function$
begin
  raise exception 'productos_precio_costo_log es append-only: % no permitido', tg_op;
end $function$;

drop trigger if exists trg_ppcl_no_update on public.productos_precio_costo_log;
create trigger trg_ppcl_no_update before update on public.productos_precio_costo_log
  for each row execute function public.trg_ppcl_append_only();
drop trigger if exists trg_ppcl_no_delete on public.productos_precio_costo_log;
create trigger trg_ppcl_no_delete before delete on public.productos_precio_costo_log
  for each row execute function public.trg_ppcl_append_only();

-- (1b) Trigger que registra cada cambio de costo/precio (cualquier camino) -------------
create or replace function public.trg_productos_log_precio_costo()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if NEW.costo_promedio is distinct from OLD.costo_promedio then
    insert into productos_precio_costo_log (producto_id, campo, valor_anterior, valor_nuevo, usuario_id)
    values (NEW.id, 'costo_promedio', OLD.costo_promedio, NEW.costo_promedio, auth.uid());
  end if;
  if NEW.precio_venta is distinct from OLD.precio_venta then
    insert into productos_precio_costo_log (producto_id, campo, valor_anterior, valor_nuevo, usuario_id)
    values (NEW.id, 'precio_venta', OLD.precio_venta, NEW.precio_venta, auth.uid());
  end if;
  return null;
end $function$;

drop trigger if exists trg_productos_log_precio_costo on public.productos;
create trigger trg_productos_log_precio_costo
  after update of costo_promedio, precio_venta on public.productos
  for each row execute function public.trg_productos_log_precio_costo();

-- (2) Endurecer el guard: INSERT y UPDATE; preservar OLD para no-Admin en UPDATE -------
create or replace function public.trg_productos_costo_solo_admin()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is not null and coalesce(get_my_rol(),'') <> 'Admin' then
    if tg_op = 'INSERT' then
      new.costo_promedio := 0;
    elsif tg_op = 'UPDATE' then
      new.costo_promedio := old.costo_promedio;
      new.precio_venta   := old.precio_venta;
    end if;
  end if;
  return new;
end $function$;

drop trigger if exists productos_costo_guard on public.productos;
create trigger productos_costo_guard
  before insert or update of costo_promedio, precio_venta on public.productos
  for each row execute function public.trg_productos_costo_solo_admin();

-- (3) Quitar el privilegio de columna ocioso a anon (mínimo privilegio) ----------------
revoke insert (costo_promedio, precio_venta), update (costo_promedio, precio_venta)
  on public.productos from anon;
