-- ============================================================================
-- Bloque A — ABC incluye OT + cron mensual + reorden confiable
-- ============================================================================
-- Contexto:
-- - ABC nunca se había ejecutado en producción: todo el catálogo quedaba en
--   clasificación 'C' por defecto.
-- - fn_top_productos() y fn_recalcular_abc() excluían las ventas con
--   origen = 'ot', es decir, los repuestos vendidos dentro de órdenes de
--   trabajo eran invisibles para el cálculo de rotación/clasificación.
-- - v_sugerencias_reorden usaba el pool "vendible" (inventario.cantidad) para
--   TODOS los productos, incluyendo insumos (que se controlan con
--   inventario.cantidad_insumo). Esto generaba ~450 filas con
--   cantidad_sugerida = 0 (falsos positivos) y ocultaba agotados reales de
--   insumos sin stock mínimo configurado.
--
-- Este bloque:
--   1) Crea _fn_recalcular_abc_core() (sin chequeo de rol) reutilizable desde
--      cron y desde fn_recalcular_abc() (que sí exige rol Admin).
--   2) Incluye ventas origen 'directa' y 'ot' en el cálculo de ABC y en
--      fn_top_productos().
--   3) Corrige v_sugerencias_reorden para usar el pool correcto según
--      productos.vendible (cantidad vendible vs cantidad_insumo).
--   4) Programa un cron mensual (pg_cron) que recalcula el ABC
--      automáticamente el día 1 de cada mes a las 05:00.
--   5) Ejecuta el primer cálculo real para dejar el catálogo clasificado.
-- ============================================================================

create extension if not exists pg_cron;

-- ----------------------------------------------------------------------------
-- 1) Núcleo del recálculo ABC (sin chequeo de rol) — ventas 'directa' + 'ot'
-- ----------------------------------------------------------------------------
create or replace function public._fn_recalcular_abc_core()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  with ventas_90d as (
    select dv.producto_id, sum(dv.subtotal) as total_vendido
    from detalle_venta dv join ventas v on v.id = dv.venta_id
    where v.fecha >= now() - interval '90 days' and v.anulada = false
      and v.origen in ('directa', 'ot')
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
    where v.fecha >= now() - interval '90 days' and v.anulada = false
      and v.origen in ('directa', 'ot')
      and dv.producto_id is not null
  ) and activo = true;
end;
$function$;

revoke execute on function public._fn_recalcular_abc_core() from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2) fn_recalcular_abc — conserva el chequeo de rol Admin, delega al núcleo
-- ----------------------------------------------------------------------------
create or replace function public.fn_recalcular_abc()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_rol text;
begin
  select rol::text into v_rol from usuarios where id = auth.uid();
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo Admin puede recalcular clasificación ABC';
  end if;
  perform public._fn_recalcular_abc_core();
end;
$function$;

-- ----------------------------------------------------------------------------
-- 3) fn_top_productos — incluye ventas 'directa' + 'ot'
-- ----------------------------------------------------------------------------
create or replace function public.fn_top_productos(p_dias integer default 30, p_limit integer default 10)
returns table(producto_id uuid, referencia text, nombre text, unidades_vendidas bigint, total_vendido numeric, num_ventas bigint)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_rol text; v_sede text;
begin
  if auth.uid() is null then raise exception 'no_session'; end if;
  select rol::text, sede_id into v_rol, v_sede from usuarios where id = auth.uid();
  return query
  select p.id, p.referencia, p.nombre, sum(dv.cantidad)::bigint, sum(dv.subtotal)::numeric, count(distinct v.id)::bigint
  from detalle_venta dv join ventas v on v.id = dv.venta_id join productos p on p.id = dv.producto_id
  where v.fecha >= current_date - p_dias and v.anulada = false and v.origen in ('directa', 'ot')
    and (v_rol = 'Admin' or v.sede_id = v_sede)
  group by p.id, p.referencia, p.nombre order by sum(dv.cantidad) desc limit p_limit;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 4) v_sugerencias_reorden — pool correcto (vendible vs insumo)
-- ----------------------------------------------------------------------------
create or replace view public.v_sugerencias_reorden
with (security_invoker = true) as
select
  p.id as producto_id,
  p.referencia,
  p.nombre,
  p.categoria,
  p.clasificacion,
  i.sede_id,
  s.nombre as sede_nombre,
  (case when p.vendible then i.cantidad else i.cantidad_insumo end) as stock_actual,
  p.stock_minimo,
  p.stock_maximo,
  greatest(p.stock_maximo - (case when p.vendible then i.cantidad else i.cantidad_insumo end), 0) as cantidad_sugerida,
  p.costo_promedio,
  (greatest(p.stock_maximo - (case when p.vendible then i.cantidad else i.cantidad_insumo end), 0))::numeric * p.costo_promedio as costo_estimado_compra,
  i.estado_stock
from productos p
join inventario i on i.producto_id = p.id
join sedes s on s.id = i.sede_id
where p.activo = true
  and s.activa = true
  and p.stock_minimo > 0
  and (case when p.vendible then i.cantidad else i.cantidad_insumo end) <= p.stock_minimo
  and greatest(p.stock_maximo - (case when p.vendible then i.cantidad else i.cantidad_insumo end), 0) > 0
order by 8;

-- ----------------------------------------------------------------------------
-- 5) Cron mensual (idempotente) — día 1 de cada mes a las 05:00
-- ----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'abc-mensual') then
    perform cron.schedule('abc-mensual', '0 5 1 * *', 'select public._fn_recalcular_abc_core()');
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 6) Primer cálculo real — deja el catálogo clasificado de inmediato
-- ----------------------------------------------------------------------------
select public._fn_recalcular_abc_core();
