-- Bloque 2 — Catálogo de SERVICIOS (mano de obra / servicios vendibles).
--
-- Lista predefinida que SOLO el Admin administra. En ventas y cotizaciones se
-- podrá agregar un servicio además de productos; su precio e IVA por defecto
-- viven aquí pero serán editables en el punto de venta (como los productos).
-- Tabla nueva, separada del catálogo de productos (no contamina el inventario).

create table if not exists public.servicios (
  id          bigint generated always as identity primary key,
  nombre      text    not null,
  descripcion text,
  precio      numeric not null default 0 check (precio >= 0),
  iva_pct     numeric not null default 19 check (iva_pct >= 0 and iva_pct <= 100),
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.servicios enable row level security;

-- Lectura: cualquier usuario autenticado (para los selectores de venta/cotización).
drop policy if exists servicios_select on public.servicios;
create policy servicios_select on public.servicios
  for select to authenticated
  using (true);

-- Escritura: solo Admin.
drop policy if exists servicios_insert on public.servicios;
create policy servicios_insert on public.servicios
  for insert to authenticated
  with check ((select get_my_rol()) = 'Admin');

drop policy if exists servicios_update on public.servicios;
create policy servicios_update on public.servicios
  for update to authenticated
  using ((select get_my_rol()) = 'Admin')
  with check ((select get_my_rol()) = 'Admin');

drop policy if exists servicios_delete on public.servicios;
create policy servicios_delete on public.servicios
  for delete to authenticated
  using ((select get_my_rol()) = 'Admin');
