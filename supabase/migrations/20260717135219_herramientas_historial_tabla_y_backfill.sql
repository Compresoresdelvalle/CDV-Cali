-- Sección 9 — Herramientas. Tarea 1: historial append-only del ciclo de vida.
create type evento_herramienta as enum (
  'prestamo','devolucion','consumo','extravio','recuperacion',
  'mantenimiento_entrada','mantenimiento_salida'
);

create table herramientas_historial (
  id uuid primary key default gen_random_uuid(),
  herramienta_id uuid not null references herramientas_prestamo(id),
  evento evento_herramienta not null,
  usuario_id uuid references usuarios(id),        -- a quién se prestó / quién responde
  registrado_por uuid references usuarios(id),    -- auth.uid() puesto por la RPC en el servidor
  sede_id text not null,
  herramienta_nombre text not null,               -- snapshot: la ficha puede cambiar de nombre
  fecha timestamptz not null default now(),
  observaciones text,
  origen text not null default 'rpc' check (origen in ('rpc','reconstruido')),
  created_at timestamptz not null default now()
);
comment on table herramientas_historial is 'Bitácora append-only del ciclo de vida de cada unidad de herramienta. origen=reconstruido marca filas sembradas del backfill (historia parcial: lo pisado antes de 2026-07-17 se perdió).';

create index idx_hh_herramienta on herramientas_historial (herramienta_id, fecha desc);
create index idx_hh_usuario on herramientas_historial (usuario_id, fecha desc);
create index idx_hh_fecha on herramientas_historial (fecha desc);

-- Candado append-only (mismo espíritu que `movimientos`, sin tocar `movimientos`).
create or replace function trg_hh_append_only() returns trigger
language plpgsql set search_path to 'public','pg_temp' as $fn$
begin
  raise exception 'herramientas_historial es de solo inserción: no se permite %', tg_op;
end;
$fn$;
create trigger trg_hh_append_only before update or delete on herramientas_historial
for each row execute function trg_hh_append_only();

-- RLS coherente con hp_select: Admin ve todo, los demás su sede.
alter table herramientas_historial enable row level security;
create policy hh_select on herramientas_historial for select to authenticated
using ((select get_my_rol()) = 'Admin' or sede_id = (select get_my_sede_id()));

-- GRANTs mínimos: authenticated solo lee; la escritura la hacen las RPC (SECURITY DEFINER).
revoke all on herramientas_historial from anon, authenticated;
grant select on herramientas_historial to authenticated;

-- ===== BACKFILL honesto: solo lo reconstruible de la ficha actual =====
insert into herramientas_historial (herramienta_id, evento, usuario_id, registrado_por, sede_id, herramienta_nombre, fecha, observaciones, origen)
select id, 'prestamo', prestada_a, null, sede_id, herramienta_nombre, fecha_prestamo,
       'Reconstruido de la ficha: último préstamo registrado.' ||
       case when prestada_a is null then ' No se pudo recuperar a quién se prestó.' else '' end,
       'reconstruido'
from herramientas_prestamo where fecha_prestamo is not null;

insert into herramientas_historial (herramienta_id, evento, usuario_id, registrado_por, sede_id, herramienta_nombre, fecha, observaciones, origen)
select id, 'devolucion', prestada_a, null, sede_id, herramienta_nombre, fecha_devolucion_real,
       'Reconstruido de la ficha: última devolución registrada.', 'reconstruido'
from herramientas_prestamo where fecha_devolucion_real is not null and estado <> 'consumido';

insert into herramientas_historial (herramienta_id, evento, usuario_id, registrado_por, sede_id, herramienta_nombre, fecha, observaciones, origen)
select id, 'consumo', prestada_a, null, sede_id, herramienta_nombre, fecha_devolucion_real,
       'Reconstruido de la ficha: baja/consumo registrado.', 'reconstruido'
from herramientas_prestamo where fecha_devolucion_real is not null and estado = 'consumido';