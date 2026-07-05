-- ============================================================================
-- Bloque B — Min/Max asistidos
-- ============================================================================
-- Contexto:
-- - Hoy stock_minimo/stock_maximo en `productos` son globales y se cargan a
--   mano, sin relación con la demanda real. Muchos productos quedan en 0
--   (invisibles para v_sugerencias_reorden) o con valores viejos que no
--   reflejan el consumo actual.
-- - Este bloque agrega un asistente: a partir del consumo real (ventas +
--   consumo de OT + consumo de ensambles) de los últimos N días, sugiere un
--   mínimo y un máximo por producto usando una fórmula simple de lead time +
--   colchón de seguridad, configurable por 3 parámetros globales editables
--   por Admin. El Admin revisa la lista y aplica solo lo que quiera.
--
-- Este bloque crea:
--   1) Tabla `parametros` — parámetros globales editables (clave/valor).
--   2) fn_sugerir_minmax — calcula sugerencias de min/max por producto.
--   3) fn_aplicar_minmax — aplica en lote las sugerencias elegidas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) parametros — tabla genérica de parámetros globales (clave/valor)
-- ----------------------------------------------------------------------------
create table if not exists public.parametros (
  clave       text primary key,
  valor       numeric not null,
  descripcion text,
  updated_at  timestamptz default now()
);

insert into public.parametros (clave, valor, descripcion) values
  ('minmax_lead_time_dias', 7, 'Días que tarda reponer stock con el proveedor'),
  ('minmax_factor_seguridad', 1.5, 'Colchón sobre la demanda del lead time'),
  ('minmax_factor_max', 3, 'Stock máximo = mínimo × este factor')
on conflict (clave) do nothing;

alter table public.parametros enable row level security;

-- Cualquier usuario autenticado puede leer los parámetros (se muestran en el
-- asistente de min/max), pero solo Admin puede modificarlos.
drop policy if exists parametros_select on public.parametros;
create policy parametros_select on public.parametros
  for select to authenticated
  using (true);

drop policy if exists parametros_update on public.parametros;
create policy parametros_update on public.parametros
  for update to authenticated
  using (get_my_rol() = 'Admin')
  with check (get_my_rol() = 'Admin');

-- ----------------------------------------------------------------------------
-- 2) fn_sugerir_minmax — sugerencias de min/max por producto (solo Admin)
-- ----------------------------------------------------------------------------
create or replace function public.fn_sugerir_minmax(p_dias integer default 90)
returns table(
  producto_id uuid,
  referencia text,
  nombre text,
  clasificacion text,
  demanda_periodo bigint,
  demanda_diaria numeric,
  stock_minimo_actual integer,
  stock_maximo_actual integer,
  min_sugerido integer,
  max_sugerido integer,
  ya_configurado boolean
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rol text;
  v_lead_time numeric;
  v_factor_seguridad numeric;
  v_factor_max numeric;
begin
  select rol::text into v_rol from usuarios where id = auth.uid();
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo Admin puede ver las sugerencias de min/max';
  end if;

  if p_dias is null or p_dias < 30 or p_dias > 365 then
    raise exception 'El periodo debe estar entre 30 y 365 días';
  end if;

  -- Parámetros globales, con defaults robustos si la tabla estuviera vacía
  -- o el valor fuera inválido (nunca debe romper el cálculo).
  select coalesce(
    (select valor from public.parametros where clave = 'minmax_lead_time_dias'), 7
  ) into v_lead_time;
  select coalesce(
    (select valor from public.parametros where clave = 'minmax_factor_seguridad'), 1.5
  ) into v_factor_seguridad;
  select coalesce(
    (select valor from public.parametros where clave = 'minmax_factor_max'), 3
  ) into v_factor_max;

  return query
  with demanda as (
    select
      m.producto_id as p_id,
      -- Las salidas se registran con cantidad NEGATIVA en movimientos;
      -- la demanda es el valor absoluto de lo consumido.
      sum(abs(m.cantidad)) as total
    from movimientos m
    where m.tipo in ('venta', 'orden_consumo', 'ensamble_consumo')
      and m.fecha >= now() - (p_dias || ' days')::interval
    group by m.producto_id
  )
  select
    p.id as producto_id,
    p.referencia,
    p.nombre,
    p.clasificacion::text,
    d.total as demanda_periodo,
    round(d.total::numeric / p_dias, 2) as demanda_diaria,
    p.stock_minimo as stock_minimo_actual,
    p.stock_maximo as stock_maximo_actual,
    greatest(
      ceil((d.total::numeric / p_dias) * v_lead_time * v_factor_seguridad)::int,
      1
    ) as min_sugerido,
    greatest(
      ceil(
        greatest(
          ceil((d.total::numeric / p_dias) * v_lead_time * v_factor_seguridad)::int,
          1
        ) * v_factor_max
      )::int,
      greatest(
        ceil((d.total::numeric / p_dias) * v_lead_time * v_factor_seguridad)::int,
        1
      ) + 1
    ) as max_sugerido,
    (p.stock_minimo > 0) as ya_configurado
  from demanda d
  join productos p on p.id = d.p_id
  where p.activo = true
    and d.total > 0
  order by d.total desc;
end;
$function$;

revoke execute on function public.fn_sugerir_minmax(integer) from anon;

-- ----------------------------------------------------------------------------
-- 3) fn_aplicar_minmax — aplica en lote las sugerencias elegidas (solo Admin)
-- ----------------------------------------------------------------------------
create or replace function public.fn_aplicar_minmax(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rol text;
  v_item record;
  v_referencia text;
  v_aplicados integer := 0;
begin
  select rol::text into v_rol from usuarios where id = auth.uid();
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo Admin puede aplicar sugerencias de min/max';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Debes enviar al menos un producto';
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(producto_id uuid, min integer, max integer)
  loop
    if v_item.producto_id is null or v_item.min is null or v_item.max is null then
      raise exception 'Cada ítem debe traer producto_id, min y max';
    end if;

    select referencia into v_referencia from productos where id = v_item.producto_id;
    if v_referencia is null then
      raise exception 'El producto % no existe', v_item.producto_id;
    end if;

    if v_item.min < 1 then
      raise exception 'El mínimo de % debe ser al menos 1', v_referencia;
    end if;
    if v_item.max <= v_item.min then
      raise exception 'El máximo de % debe ser mayor que el mínimo', v_referencia;
    end if;

    update productos
       set stock_minimo = v_item.min,
           stock_maximo = v_item.max,
           updated_at = now()
     where id = v_item.producto_id;

    v_aplicados := v_aplicados + 1;
  end loop;

  return jsonb_build_object('aplicados', v_aplicados);
end;
$function$;

revoke execute on function public.fn_aplicar_minmax(jsonb) from anon;
