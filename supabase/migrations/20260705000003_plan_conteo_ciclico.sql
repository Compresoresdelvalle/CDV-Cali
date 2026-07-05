-- ============================================================================
-- Bloque C — Plan de conteo cíclico programado
-- ============================================================================
-- Contexto:
-- - El conteo cíclico hoy es 100% manual y libre: alguien busca un producto y
--   registra un físico cuando se le ocurre. No hay garantía de que TODO el
--   catálogo con stock se cuente en un periodo razonable, ni prioridad para
--   los productos de alto valor (clase A) o con historial de divergencias.
-- - Este bloque agrega un "plan" por sede que reparte el universo de
--   productos con stock en semanas, priorizando clase A (más frecuencia) y
--   divergencias históricas (más pronto), y expone una "cola de hoy" para que
--   el operario simplemente vaya contando lo que le toca sin tener que
--   pensar qué falta.
-- - CUALQUIER conteo registrado (venga o no de la cola del plan) marca el
--   ítem correspondiente vía trigger — así el plan avanza solo, sin depender
--   de que el frontend use un flujo específico. fn_registrar_conteo NO se
--   modifica.
--
-- Este bloque crea:
--   1) Tabla plan_conteo (un plan activo por sede).
--   2) Tabla plan_conteo_items (reparto de productos en semanas).
--   3) RLS de solo lectura para Admin/Bodeguero (toda escritura es vía RPC).
--   4) fn_generar_plan_conteo — genera/regenera el plan de una sede.
--   5) fn_cola_conteo_hoy — ítems pendientes que ya tocan contar.
--   6) Trigger AFTER INSERT en conteos que marca el ítem del plan como hecho.
--   7) fn_progreso_plan — KPIs de avance del plan activo de una sede.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) plan_conteo — un plan activo por sede (histórico se conserva, activo=false)
-- ----------------------------------------------------------------------------
create table if not exists public.plan_conteo (
  id             uuid primary key default gen_random_uuid(),
  sede_id        text not null references sedes(id),
  horizonte_dias integer not null check (horizonte_dias in (30, 90)),
  fecha_inicio   date not null default current_date,
  conteo_ciego   boolean not null default false,
  creado_por     uuid references usuarios(id),
  activo         boolean not null default true,
  created_at     timestamptz default now()
);

-- Solo un plan activo por sede — al generar uno nuevo, el anterior se
-- desactiva (nunca se borra: queda como historial de planes pasados).
create unique index if not exists uq_plan_conteo_sede_activo
  on public.plan_conteo (sede_id) where activo;

-- ----------------------------------------------------------------------------
-- 2) plan_conteo_items — reparto de productos por semana dentro del plan
-- ----------------------------------------------------------------------------
create table if not exists public.plan_conteo_items (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references plan_conteo(id) on delete cascade,
  producto_id     uuid not null references productos(id),
  sede_id         text not null,
  semana_objetivo integer not null,
  contado_en      timestamptz,
  conteo_id       uuid references conteos(id)
);

create index if not exists idx_plan_conteo_items_plan_semana
  on public.plan_conteo_items (plan_id, semana_objetivo);
create index if not exists idx_plan_conteo_items_plan_producto
  on public.plan_conteo_items (plan_id, producto_id);
-- Índice parcial para la búsqueda frecuente "ítems pendientes de este plan".
create index if not exists idx_plan_conteo_items_pendientes
  on public.plan_conteo_items (plan_id, semana_objetivo) where contado_en is null;

-- ----------------------------------------------------------------------------
-- 3) RLS — solo lectura para Admin/Bodeguero. Toda escritura pasa por RPC
--    security definer (fn_generar_plan_conteo y el trigger de conteos).
-- ----------------------------------------------------------------------------
alter table public.plan_conteo enable row level security;
alter table public.plan_conteo_items enable row level security;

drop policy if exists plan_conteo_select on public.plan_conteo;
create policy plan_conteo_select on public.plan_conteo
  for select to authenticated
  using (get_my_rol() in ('Admin', 'Bodeguero'));

drop policy if exists plan_conteo_items_select on public.plan_conteo_items;
create policy plan_conteo_items_select on public.plan_conteo_items
  for select to authenticated
  using (get_my_rol() in ('Admin', 'Bodeguero'));

-- ----------------------------------------------------------------------------
-- 4) fn_generar_plan_conteo — crea el plan de una sede (solo Admin)
-- ----------------------------------------------------------------------------
create or replace function public.fn_generar_plan_conteo(
  p_sede_id text,
  p_horizonte_dias integer,
  p_conteo_ciego boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rol text;
  v_plan_id uuid;
  v_semanas integer;
  v_total_items integer;
  v_total_productos integer;
begin
  select rol::text into v_rol from usuarios where id = auth.uid();
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo Admin puede generar el plan de conteo';
  end if;

  if not exists (select 1 from sedes where id = p_sede_id) then
    raise exception 'La sede % no existe', p_sede_id;
  end if;
  if p_horizonte_dias not in (30, 90) then
    raise exception 'Horizonte inválido: debe ser 30 o 90 días';
  end if;

  v_semanas := case when p_horizonte_dias = 30 then 4 else 13 end;

  -- Conservamos el historial: el plan anterior de la sede se desactiva, no se borra.
  update public.plan_conteo set activo = false
   where sede_id = p_sede_id and activo = true;

  insert into public.plan_conteo (sede_id, horizonte_dias, conteo_ciego, creado_por, activo)
  values (p_sede_id, p_horizonte_dias, coalesce(p_conteo_ciego, false), auth.uid(), true)
  returning id into v_plan_id;

  -- Universo: productos activos con stock > 0 en la sede, usando el pool
  -- correcto según productos.vendible (mismo criterio que v_sugerencias_reorden).
  create temporary table tmp_universo_conteo on commit drop as
  select
    p.id as producto_id,
    p.clasificacion,
    -- Divergencia histórica: existe algún conteo previo de este producto+sede
    -- con diferencia distinta de cero. Estos productos se priorizan primero.
    exists (
      select 1 from conteos c
      where c.producto_id = p.id and c.sede_id = p_sede_id and c.diferencia <> 0
    ) as con_divergencia
  from productos p
  join inventario i on i.producto_id = p.id and i.sede_id = p_sede_id
  where p.activo = true
    and (case when p.vendible then i.cantidad else i.cantidad_insumo end) > 0;

  select count(*) into v_total_productos from tmp_universo_conteo;

  -- Reparto de ítems:
  --   Clase A en horizonte 90d → 2 ítems (uno en semanas 1..mitad, otro en
  --     mitad+1..fin) para que se cuente ~cada 4-6 semanas.
  --   Clase A en horizonte 30d, y clase B/C siempre → 1 ítem.
  --   Dentro de cada grupo (rango de semanas × prioridad), round-robin por
  --   row_number() % semanas_del_rango para balancear la carga.
  create temporary table tmp_items_conteo on commit drop as
  with expandido as (
    -- Clase A con horizonte 90 días: dos sub-ítems, uno por mitad del ciclo.
    select producto_id, con_divergencia, 1 as rango_ini, ceil(v_semanas / 2.0)::int as rango_fin
    from tmp_universo_conteo
    where clasificacion = 'A' and v_semanas > 4
    union all
    select producto_id, con_divergencia, ceil(v_semanas / 2.0)::int + 1 as rango_ini, v_semanas as rango_fin
    from tmp_universo_conteo
    where clasificacion = 'A' and v_semanas > 4
    union all
    -- Resto (A en horizonte 30d, o clase B/C en cualquier horizonte): un ítem
    -- sobre el ciclo completo.
    select producto_id, con_divergencia, 1 as rango_ini, v_semanas as rango_fin
    from tmp_universo_conteo
    where not (clasificacion = 'A' and v_semanas > 4)
  ),
  numerado as (
    select
      producto_id,
      con_divergencia,
      rango_ini,
      rango_fin,
      row_number() over (
        partition by rango_ini, rango_fin, con_divergencia
        order by producto_id
      ) - 1 as orden
    from expandido
  )
  select
    producto_id,
    p_sede_id as sede_id,
    -- Round-robin dentro del rango asignado. Los productos con divergencia
    -- histórica se reparten solo en la PRIMERA MITAD de su rango: se cuentan
    -- temprano en el ciclo sin volcarlos todos a la semana 1.
    rango_ini + (orden % (case
      when con_divergencia
        then greatest(ceil((rango_fin - rango_ini + 1) / 2.0)::int, 1)
      else greatest(rango_fin - rango_ini + 1, 1)
    end)) as semana_objetivo
  from numerado;

  insert into public.plan_conteo_items (plan_id, producto_id, sede_id, semana_objetivo)
  select v_plan_id, producto_id, sede_id, semana_objetivo from tmp_items_conteo;

  select count(*) into v_total_items from public.plan_conteo_items where plan_id = v_plan_id;

  return jsonb_build_object(
    'plan_id', v_plan_id,
    'total_items', v_total_items,
    'total_productos', v_total_productos,
    'semanas', v_semanas,
    'promedio_semana', round(v_total_items::numeric / greatest(v_semanas, 1), 1)
  );
end;
$function$;

revoke execute on function public.fn_generar_plan_conteo(text, integer, boolean) from anon;

-- ----------------------------------------------------------------------------
-- 5) fn_cola_conteo_hoy — ítems pendientes que ya tocan contar
-- ----------------------------------------------------------------------------
create or replace function public.fn_cola_conteo_hoy(p_sede_id text default null)
returns table(
  item_id uuid,
  producto_id uuid,
  referencia text,
  nombre text,
  clasificacion text,
  vendible boolean,
  semana_objetivo integer,
  atrasado boolean,
  stock_sistema integer
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_mi_sede text;
  v_sede text;
  v_plan record;
  v_semana_actual integer;
begin
  if v_uid is null then raise exception 'no_session'; end if;
  select rol::text, sede_id into v_rol, v_mi_sede from usuarios where id = v_uid;
  if v_rol not in ('Admin', 'Bodeguero') then
    raise exception 'Solo Admin o Bodeguero pueden ver la cola de conteo';
  end if;

  -- Un no-Admin siempre ve su propia sede, sin importar lo que pida.
  if v_rol = 'Admin' then
    v_sede := coalesce(nullif(trim(p_sede_id), ''), v_mi_sede);
  else
    v_sede := v_mi_sede;
  end if;
  if v_sede is null then
    return; -- sin sede no hay cola posible
  end if;

  select pc.id as plan_id, pc.fecha_inicio,
    case when pc.horizonte_dias = 30 then 4 else 13 end as semanas_totales
    into v_plan
  from public.plan_conteo pc
  where pc.sede_id = v_sede and pc.activo = true;

  if not found then
    return; -- sin plan activo, cola vacía
  end if;

  v_semana_actual := least(
    floor((current_date - v_plan.fecha_inicio) / 7)::int + 1,
    v_plan.semanas_totales
  );
  v_semana_actual := greatest(v_semana_actual, 1);

  return query
  select
    pci.id as item_id,
    p.id as producto_id,
    p.referencia,
    p.nombre,
    p.clasificacion::text,
    p.vendible,
    pci.semana_objetivo,
    (pci.semana_objetivo < v_semana_actual) as atrasado,
    coalesce(
      (case when p.vendible then i.cantidad else i.cantidad_insumo end), 0
    ) as stock_sistema
  from public.plan_conteo_items pci
  join productos p on p.id = pci.producto_id
  left join inventario i on i.producto_id = p.id and i.sede_id = pci.sede_id
  where pci.plan_id = v_plan.plan_id
    and pci.contado_en is null
    and pci.semana_objetivo <= v_semana_actual
  order by (pci.semana_objetivo < v_semana_actual) desc, p.referencia asc;
end;
$function$;

revoke execute on function public.fn_cola_conteo_hoy(text) from anon;

-- ----------------------------------------------------------------------------
-- 6) Trigger — cualquier conteo insertado avanza el plan activo automático
-- ----------------------------------------------------------------------------
create or replace function public.trg_conteo_marca_plan_item()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_plan_id uuid;
  v_item_id uuid;
begin
  select id into v_plan_id from public.plan_conteo
   where sede_id = new.sede_id and activo = true;

  if v_plan_id is null then
    return new; -- no hay plan activo en esa sede, nada que marcar
  end if;

  -- El ítem pendiente más antiguo (menor semana_objetivo) de ese producto en
  -- el plan activo. Si no hay ítem pendiente (ya contado o no forma parte del
  -- plan), no pasa nada: los conteos "sueltos" siguen funcionando igual.
  select id into v_item_id
    from public.plan_conteo_items
   where plan_id = v_plan_id
     and producto_id = new.producto_id
     and contado_en is null
   order by semana_objetivo asc
   limit 1;

  if v_item_id is not null then
    update public.plan_conteo_items
       set contado_en = new.fecha, conteo_id = new.id
     where id = v_item_id;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_conteo_avanza_plan on public.conteos;
create trigger trg_conteo_avanza_plan
  after insert on public.conteos
  for each row execute function public.trg_conteo_marca_plan_item();

-- ----------------------------------------------------------------------------
-- 7) fn_progreso_plan — KPIs de avance del plan activo de una sede
-- ----------------------------------------------------------------------------
create or replace function public.fn_progreso_plan(p_sede_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rol text;
  v_plan record;
  v_semana_actual integer;
  v_total_items integer;
  v_items_contados integer;
  v_pendientes_hoy integer;
  v_atrasados integer;
  v_contados_ok integer;
  v_precision numeric;
begin
  select rol::text into v_rol from usuarios where id = auth.uid();
  if v_rol not in ('Admin', 'Bodeguero') then
    raise exception 'Solo Admin o Bodeguero pueden ver el progreso del plan';
  end if;

  select pc.id as plan_id, pc.horizonte_dias, pc.conteo_ciego, pc.fecha_inicio,
    case when pc.horizonte_dias = 30 then 4 else 13 end as semanas_totales
    into v_plan
  from public.plan_conteo pc
  where pc.sede_id = p_sede_id and pc.activo = true;

  if not found then
    return null;
  end if;

  v_semana_actual := least(
    floor((current_date - v_plan.fecha_inicio) / 7)::int + 1,
    v_plan.semanas_totales
  );
  v_semana_actual := greatest(v_semana_actual, 1);

  select count(*) into v_total_items
    from public.plan_conteo_items where plan_id = v_plan.plan_id;

  select count(*) into v_pendientes_hoy
    from public.plan_conteo_items
   where plan_id = v_plan.plan_id and contado_en is null and semana_objetivo <= v_semana_actual;

  select count(*) into v_atrasados
    from public.plan_conteo_items
   where plan_id = v_plan.plan_id and contado_en is null and semana_objetivo < v_semana_actual;

  -- Precisión del ciclo: % de ítems contados cuyo conteo dio diferencia = 0.
  select count(*) filter (where c.diferencia = 0), count(*)
    into v_contados_ok, v_items_contados
  from public.plan_conteo_items pci
  join conteos c on c.id = pci.conteo_id
  where pci.plan_id = v_plan.plan_id and pci.contado_en is not null;

  v_precision := case when v_items_contados > 0
    then round(v_contados_ok::numeric / v_items_contados * 100, 1)
    else null end;

  return jsonb_build_object(
    'plan_id', v_plan.plan_id,
    'horizonte_dias', v_plan.horizonte_dias,
    'conteo_ciego', v_plan.conteo_ciego,
    'fecha_inicio', v_plan.fecha_inicio,
    'semana_actual', v_semana_actual,
    'semanas_totales', v_plan.semanas_totales,
    'total_items', v_total_items,
    'items_contados', v_items_contados,
    'pendientes_hoy', v_pendientes_hoy,
    'atrasados', v_atrasados,
    'precision_ciclo', v_precision
  );
end;
$function$;

revoke execute on function public.fn_progreso_plan(text) from anon;
