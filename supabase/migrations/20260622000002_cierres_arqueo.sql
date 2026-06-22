-- ============================================================================
-- Cierres — Vista Avanzada (Task 2): arqueo de caja manual en fn_generar_cierre.
-- Nuevo parámetro opcional p_arqueo jsonb = [{sede_id, efectivo_contado}].
-- El "esperado" se recalcula server-side (de detalle.arqueo_esperado); el
-- cliente solo aporta lo contado. El arqueo final se guarda en detalle.arqueo.
-- Se dropea el overload viejo para evitar ambigüedad de firma.
-- ============================================================================

drop function if exists public.fn_generar_cierre(date, date, text, text, text);

create or replace function public.fn_generar_cierre(
  p_desde date, p_hasta date, p_tipo text,
  p_observaciones text default null::text,
  p_sede text default null::text,
  p_arqueo jsonb default null::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_rol     text;
  v_totales jsonb;
  v_arqueo  jsonb;
  v_detalle jsonb;
  v_row     cierres;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text into v_rol from usuarios where id = v_uid;
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo el Admin puede generar cierres';
  end if;
  if p_desde is null or p_hasta is null then
    raise exception 'Debe indicar fecha desde y hasta';
  end if;
  if p_hasta < p_desde then
    raise exception 'La fecha hasta no puede ser anterior a la fecha desde';
  end if;
  if p_tipo not in ('diario', 'periodo') then
    raise exception 'Tipo de cierre inválido: %', p_tipo;
  end if;
  if p_tipo = 'diario' and p_desde <> p_hasta then
    raise exception 'Un cierre diario debe cubrir un solo día';
  end if;
  if p_sede is not null and not exists (select 1 from sedes where id = p_sede and activa = true) then
    raise exception 'Sede inválida: %', p_sede;
  end if;

  perform pg_advisory_xact_lock(hashtext('cierres'));

  if exists (select 1 from cierres
             where fecha_desde <= p_hasta and fecha_hasta >= p_desde
               and (p_sede is null or sede_id is null or sede_id = p_sede)) then
    raise exception 'El rango % a % solapa un cierre ya existente para esta cobertura', p_desde, p_hasta;
  end if;

  v_totales := _fn_cierre_totales(p_desde, p_hasta, p_sede);

  -- Arqueo: esperado server-side + contado del cliente.
  if p_arqueo is not null then
    v_arqueo := (
      select coalesce(jsonb_agg(jsonb_build_object(
         'sede_id', e->>'sede_id', 'sede_nombre', e->>'sede_nombre',
         'efectivo_esperado', (e->>'efectivo_esperado')::numeric,
         'efectivo_contado', coalesce((
            select (a->>'efectivo_contado')::numeric from jsonb_array_elements(p_arqueo) a
            where a->>'sede_id' = e->>'sede_id'), 0),
         'diferencia', coalesce((
            select (a->>'efectivo_contado')::numeric from jsonb_array_elements(p_arqueo) a
            where a->>'sede_id' = e->>'sede_id'), 0) - (e->>'efectivo_esperado')::numeric
      ) order by e->>'sede_nombre'), '[]'::jsonb)
      from jsonb_array_elements(v_totales->'detalle'->'arqueo_esperado') e
    );
    v_detalle := (v_totales->'detalle') || jsonb_build_object('arqueo', v_arqueo);
  else
    v_detalle := v_totales->'detalle';
  end if;

  insert into cierres (
    tipo, fecha_desde, fecha_hasta, sede_id,
    ingresos_productos, ingresos_servicios, ingresos_total, egresos, margen,
    count_ventas, count_abonos, count_compras,
    detalle, observaciones, cerrado_por
  ) values (
    p_tipo, p_desde, p_hasta, p_sede,
    (v_totales->>'ingresos_productos')::numeric,
    (v_totales->>'ingresos_servicios')::numeric,
    (v_totales->>'ingresos_total')::numeric,
    (v_totales->>'egresos')::numeric,
    (v_totales->>'margen')::numeric,
    (v_totales->>'count_ventas')::integer,
    (v_totales->>'count_abonos')::integer,
    (v_totales->>'count_compras')::integer,
    v_detalle,
    nullif(trim(coalesce(p_observaciones, '')), ''),
    v_uid
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;

revoke execute on function public.fn_generar_cierre(date, date, text, text, text, jsonb) from public, anon;
grant execute on function public.fn_generar_cierre(date, date, text, text, text, jsonb) to authenticated;
