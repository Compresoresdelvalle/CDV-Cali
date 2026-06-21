-- ============================================================================
-- Rediseño OT — Opción A — FASE 5b: Analítica de productos sin las ventas-OT.
-- Las ventas generadas por OT (origen='ot') NO deben contar en el ABC, el top
-- de productos ni la rotación (eso es analítica de venta DIRECTA de mostrador).
-- Se añade `v.origen='directa'` a las tres funciones.
-- ============================================================================

create or replace function public.fn_top_productos(p_dias integer default 30, p_limit integer default 10)
returns table(producto_id uuid, referencia text, nombre text, unidades_vendidas bigint, total_vendido numeric, num_ventas bigint)
language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_rol text; v_sede text;
begin
  if auth.uid() is null then raise exception 'no_session'; end if;
  select rol::text, sede_id into v_rol, v_sede from usuarios where id = auth.uid();
  return query
  select p.id, p.referencia, p.nombre, sum(dv.cantidad)::bigint, sum(dv.subtotal)::numeric, count(distinct v.id)::bigint
  from detalle_venta dv join ventas v on v.id = dv.venta_id join productos p on p.id = dv.producto_id
  where v.fecha >= current_date - p_dias and v.anulada = false and v.origen = 'directa'
    and (v_rol = 'Admin' or v.sede_id = v_sede)
  group by p.id, p.referencia, p.nombre order by sum(dv.cantidad) desc limit p_limit;
end; $function$;

create or replace function public.fn_recalcular_abc()
returns void language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_rol text;
begin
  select rol::text into v_rol from usuarios where id = auth.uid();
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo Admin puede recalcular clasificación ABC';
  end if;

  with ventas_90d as (
    select dv.producto_id, sum(dv.subtotal) as total_vendido
    from detalle_venta dv join ventas v on v.id = dv.venta_id
    where v.fecha >= now() - interval '90 days' and v.anulada = false and v.origen = 'directa'
      and dv.producto_id is not null
    group by dv.producto_id
  ),
  ranked as (
    select producto_id, total_vendido,
      sum(total_vendido) over (order by total_vendido desc) /
      nullif(sum(total_vendido) over (), 0) * 100 as pct_acum
    from ventas_90d
  )
  update productos set
    clasificacion = (case when r.pct_acum <= 80 then 'A' when r.pct_acum <= 95 then 'B' else 'C' end)::clasificacion_abc,
    updated_at = now()
  from ranked r where productos.id = r.producto_id;

  update productos set clasificacion = 'C'::clasificacion_abc, updated_at = now()
  where id not in (
    select dv.producto_id from detalle_venta dv join ventas v on v.id = dv.venta_id
    where v.fecha >= now() - interval '90 days' and v.anulada = false and v.origen = 'directa'
      and dv.producto_id is not null
  ) and activo = true;
end; $function$;

create or replace function public.fn_alertas_rotacion(p_dias integer default 30, p_sede text default null)
returns table(categoria text, producto_id uuid, nombre text, codigo_interno text, ventas_periodo integer, stock_actual integer, sede_id text)
language plpgsql stable security definer set search_path to 'public','pg_temp'
as $function$
declare v_desde timestamptz := now() - (p_dias || ' days')::interval;
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  if get_my_rol() <> 'Admin' then raise exception 'Solo Admin puede consultar alertas de rotación'; end if;

  return query
  with ventas_periodo as (
    select dv.producto_id, sum(dv.cantidad)::int as unidades, v.sede_id
      from detalle_venta dv join ventas v on v.id = dv.venta_id
     where v.fecha >= v_desde and v.anulada = false and v.origen = 'directa'
       and (p_sede is null or v.sede_id = p_sede)
     group by dv.producto_id, v.sede_id
  ),
  stock_actual as (
    select i.producto_id, i.sede_id, i.cantidad::int as stock
      from inventario i where (p_sede is null or i.sede_id = p_sede)
  ),
  consolidado as (
    select s.producto_id, p.nombre, p.codigo_interno, s.sede_id, s.stock,
           coalesce(vp.unidades, 0) as ventas
      from stock_actual s
      join productos p on p.id = s.producto_id and p.activo = true
      left join ventas_periodo vp on vp.producto_id = s.producto_id and vp.sede_id = s.sede_id
  ),
  ranked as (
    select *,
      row_number() over (order by ventas desc, stock desc) as rk_alta,
      row_number() over (order by ventas asc, stock desc)  as rk_baja
      from consolidado
  )
  select 'sobre_stock'::text, r.producto_id, r.nombre, r.codigo_interno, r.ventas, r.stock, r.sede_id
    from ranked r where r.ventas = 0 and r.stock > 0
   union all
  select 'mayor_rotacion'::text, r.producto_id, r.nombre, r.codigo_interno, r.ventas, r.stock, r.sede_id
    from ranked r where r.rk_alta <= 10 and r.ventas > 0
   union all
  select 'menor_rotacion'::text, r.producto_id, r.nombre, r.codigo_interno, r.ventas, r.stock, r.sede_id
    from ranked r where r.rk_baja <= 10 and r.stock > 0 and r.ventas > 0
  order by 1, 5 desc;
end; $function$;
