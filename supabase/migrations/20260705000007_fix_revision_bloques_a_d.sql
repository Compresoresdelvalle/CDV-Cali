-- ============================================================================
-- Fix — revisión de bugs de los Bloques A–D (2026-07-05)
-- ============================================================================
-- Hallazgos corregidos aquí (backend):
--
-- 1) [A/P2] Las funciones security definer nuevas se crearon con el grant
--    implícito de EXECUTE a PUBLIC. `revoke ... from anon` NO quita ese grant
--    heredado, así que `anon` (y en el caso de `_fn_recalcular_abc_core`,
--    cualquier usuario autenticado no-Admin) podía ejecutarlas. Las funciones
--    de usuario validan rol internamente (defensa en profundidad), pero
--    `_fn_recalcular_abc_core` NO valida nada: un Vendedor o incluso la anon
--    key podían reclasificar todo el catálogo ABC. Se revoca PUBLIC en las 9.
--
-- 2) [A/P3] `_fn_recalcular_abc_core`: el primer UPDATE reclasificaba también
--    productos inactivos (soft-deleted) con ventas en 90d; el segundo UPDATE
--    (fallback a 'C') sí filtraba activo = true. Se alinean ambos.
--
-- 3) [C/P2] `fn_progreso_plan` no forzaba la sede del Bodeguero: aceptaba
--    p_sede_id tal cual (a diferencia de fn_cola_conteo_hoy). Un Bodeguero
--    podía ver los KPIs del plan de otra sede llamando el RPC directo.
--
-- 4) [C/P2] Fechas del plan en UTC: `fecha_inicio default current_date` y el
--    cálculo de "semana actual" usaban la fecha del servidor (UTC). Entre las
--    7pm y medianoche hora Colombia el plan quedaba fechado al día siguiente
--    y el corte de semana/atrasados se corría. Mismo patrón ya corregido en
--    cierres/dashboard: usar (now() at time zone 'America/Bogota')::date.
--
-- 5) [C/P3] Conteo ciego cosmético: `fn_cola_conteo_hoy` devolvía
--    stock_sistema aunque el plan fuera ciego (el frontend solo lo ocultaba;
--    el valor viajaba en la respuesta de red). Ahora, con plan ciego, el RPC
--    devuelve NULL — el registro del conteo no lo necesita porque
--    fn_registrar_conteo lee el stock server-side con FOR UPDATE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) ACLs: quitar el grant implícito a PUBLIC. Las funciones que el frontend
--    llama por RPC conservan el grant explícito a authenticated.
-- ----------------------------------------------------------------------------
revoke execute on function public._fn_recalcular_abc_core() from public, anon, authenticated;
revoke execute on function public.trg_conteo_marca_plan_item() from public, anon, authenticated;

revoke execute on function public.fn_generar_plan_conteo(text, integer, boolean) from public, anon;
revoke execute on function public.fn_cola_conteo_hoy(text) from public, anon;
revoke execute on function public.fn_progreso_plan(text) from public, anon;
revoke execute on function public.fn_sugerir_minmax(integer) from public, anon;
revoke execute on function public.fn_aplicar_minmax(jsonb) from public, anon;
revoke execute on function public.fn_asignar_ubicacion(uuid, text, text) from public, anon;
revoke execute on function public.fn_slotting_sugerencias() from public, anon;

grant execute on function public.fn_generar_plan_conteo(text, integer, boolean) to authenticated;
grant execute on function public.fn_cola_conteo_hoy(text) to authenticated;
grant execute on function public.fn_progreso_plan(text) to authenticated;
grant execute on function public.fn_sugerir_minmax(integer) to authenticated;
grant execute on function public.fn_aplicar_minmax(jsonb) to authenticated;
grant execute on function public.fn_asignar_ubicacion(uuid, text, text) to authenticated;
grant execute on function public.fn_slotting_sugerencias() to authenticated;

-- ----------------------------------------------------------------------------
-- 2) _fn_recalcular_abc_core: no reclasificar productos inactivos.
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
  from ranked r where productos.id = r.producto_id
    and productos.activo = true;

  update productos set clasificacion = 'C'::clasificacion_abc, updated_at = now()
  where id not in (
    select dv.producto_id from detalle_venta dv join ventas v on v.id = dv.venta_id
    where v.fecha >= now() - interval '90 days' and v.anulada = false
      and v.origen in ('directa', 'ot')
      and dv.producto_id is not null
  ) and activo = true;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 3) fecha_inicio del plan en fecha de Bogotá, no UTC.
-- ----------------------------------------------------------------------------
alter table public.plan_conteo
  alter column fecha_inicio set default ((now() at time zone 'America/Bogota')::date);

-- ----------------------------------------------------------------------------
-- 4) fn_progreso_plan: forzar sede del no-Admin + fecha Bogotá.
-- ----------------------------------------------------------------------------
create or replace function public.fn_progreso_plan(p_sede_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rol text;
  v_mi_sede text;
  v_sede text;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_plan record;
  v_semana_actual integer;
  v_total_items integer;
  v_items_contados integer;
  v_pendientes_hoy integer;
  v_atrasados integer;
  v_contados_ok integer;
  v_precision numeric;
begin
  select rol::text, sede_id into v_rol, v_mi_sede from usuarios where id = auth.uid();
  if v_rol not in ('Admin', 'Bodeguero') then
    raise exception 'Solo Admin o Bodeguero pueden ver el progreso del plan';
  end if;

  -- Un no-Admin siempre ve su propia sede (mismo criterio que fn_cola_conteo_hoy).
  if v_rol = 'Admin' then
    v_sede := p_sede_id;
  else
    v_sede := v_mi_sede;
  end if;
  if v_sede is null then
    return null;
  end if;

  select pc.id as plan_id, pc.horizonte_dias, pc.conteo_ciego, pc.fecha_inicio,
    case when pc.horizonte_dias = 30 then 4 else 13 end as semanas_totales
    into v_plan
  from public.plan_conteo pc
  where pc.sede_id = v_sede and pc.activo = true;

  if not found then
    return null;
  end if;

  v_semana_actual := least(
    floor((v_hoy - v_plan.fecha_inicio) / 7)::int + 1,
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

revoke execute on function public.fn_progreso_plan(text) from public, anon;
grant execute on function public.fn_progreso_plan(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) fn_cola_conteo_hoy: fecha Bogotá + stock_sistema NULL cuando el plan es
--    ciego (misma firma y mismo RETURNS TABLE — create or replace es válido).
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
  stock_sistema integer,
  ubicacion_id text
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
  v_hoy date := (now() at time zone 'America/Bogota')::date;
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

  select pc.id as plan_id, pc.fecha_inicio, pc.conteo_ciego,
    case when pc.horizonte_dias = 30 then 4 else 13 end as semanas_totales
    into v_plan
  from public.plan_conteo pc
  where pc.sede_id = v_sede and pc.activo = true;

  if not found then
    return; -- sin plan activo, cola vacía
  end if;

  v_semana_actual := least(
    floor((v_hoy - v_plan.fecha_inicio) / 7)::int + 1,
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
    -- Conteo ciego real: el stock del sistema no sale del servidor. El
    -- registro no lo necesita: fn_registrar_conteo lo lee con FOR UPDATE.
    case when v_plan.conteo_ciego then null
         else coalesce(
           (case when p.vendible then i.cantidad else i.cantidad_insumo end), 0
         )
    end as stock_sistema,
    i.ubicacion_id
  from public.plan_conteo_items pci
  join productos p on p.id = pci.producto_id
  left join inventario i on i.producto_id = p.id and i.sede_id = pci.sede_id
  left join public.ubicaciones u on u.id = i.ubicacion_id
  where pci.plan_id = v_plan.plan_id
    and pci.contado_en is null
    and pci.semana_objetivo <= v_semana_actual
  order by
    (pci.semana_objetivo < v_semana_actual) desc,
    u.prioridad_picking asc nulls last,
    p.referencia asc;
end;
$function$;

revoke execute on function public.fn_cola_conteo_hoy(text) from public, anon;
grant execute on function public.fn_cola_conteo_hoy(text) to authenticated;
