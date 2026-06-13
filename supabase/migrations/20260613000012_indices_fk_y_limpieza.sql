-- Paso 11 — TRAZA-06 + TRAZA-07 (MEDIA, rendimiento)
--
-- TRAZA-06: ~58 claves foráneas sin índice de respaldo. Sin índice, los JOIN por esas
--   columnas y las verificaciones de FK en DELETE/UPDATE del padre hacen seq scan. La más
--   citada: movimientos.usuario_id (pantalla de Auditoría). A esta escala el costo de
--   mantenimiento del índice es trivial. Fix: crear idx_<tabla>_<col> para cada FK sin índice
--   de cobertura (idempotente; solo crea los que faltan).
--
-- TRAZA-07: clientes tenía dos índices únicos IDÉNTICOS sobre identificacion
--   (ux_clientes_ident_activa == ux_clientes_identificacion). Fix: eliminar el duplicado.
--
-- (TRAZA-05 — envolver get_my_rol()/auth.uid() en (select ...) en políticas RLS — se difiere:
--  es micro-optimización de impacto nulo a esta escala y reescribir ~12 policies tiene más
--  riesgo que beneficio ahora. Los unused_index del advisor NO se tocan: en producción
--  temprana las stats de uso son ralas y la mayoría se usarán al crecer el volumen.)

-- ── TRAZA-06: índice por cada FK sin cobertura ───────────────────────────────────
do $$
declare
  r   record;
  v_idx text;
begin
  for r in
    select cl.relname as tbl,
           (select a.attname from pg_attribute a
             where a.attrelid = con.conrelid and a.attnum = con.conkey[1]) as col
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    where con.contype = 'f'
      and con.connamespace = 'public'::regnamespace
      and not exists (
        select 1 from pg_index i
        where i.indrelid = con.conrelid and i.indkey[0] = con.conkey[1]
      )
  loop
    v_idx := left('idx_' || r.tbl || '_' || r.col, 63);
    execute format('create index if not exists %I on public.%I (%I);', v_idx, r.tbl, r.col);
  end loop;
end $$;

-- ── TRAZA-07: eliminar el índice único duplicado en clientes ──────────────────────
drop index if exists public.ux_clientes_identificacion;
