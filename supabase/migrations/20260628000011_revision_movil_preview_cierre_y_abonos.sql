-- ============================================================================
-- Revisión móvil — correcciones de permisos detectadas en la auditoría:
--
--  A) fn_preview_cierre: el módulo "Cierre (solo lectura)" de Bodega (#16) quedó
--     a medias — la política SELECT de `cierres` ya dejaba ver el histórico, pero
--     la PREVISUALIZACIÓN seguía rechazando a todo no-Admin ("Solo el Admin puede
--     consultar cierres"). Se permite Admin + Bodeguero en el preview (es solo
--     lectura, sin efectos). GENERAR el cierre sigue siendo solo de Admin
--     (fn_generar_cierre, sin cambios).
--
--  H) abonos_insert: la política aún permitía a 'Tecnico' registrar abonos de OT.
--     Tras dejar al técnico SOLO-LECTURA en OT (#15), los abonos los registra
--     Ventas. Se quita 'Tecnico' (la UI ya lo bloqueaba; esto cierra la brecha
--     por API directa).
-- ============================================================================

-- ─────────────────────────────── A ─────────────────────────────────────────
create or replace function public.fn_preview_cierre(p_desde date, p_hasta date, p_sede text default null)
 returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_rol     text;
  v_totales jsonb;
  v_solap   integer[];
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text into v_rol from usuarios where id = v_uid;
  -- Lectura: Administración o Bodega. Generar el cierre sigue siendo solo Admin.
  if v_rol is null or v_rol not in ('Admin','Bodeguero') then
    raise exception 'Solo Administración o Bodega pueden consultar cierres';
  end if;
  if p_desde is null or p_hasta is null then
    raise exception 'Debe indicar fecha desde y hasta';
  end if;
  if p_hasta < p_desde then
    raise exception 'La fecha hasta no puede ser anterior a la fecha desde';
  end if;
  if p_sede is not null and not exists (select 1 from sedes where id = p_sede and activa = true) then
    raise exception 'Sede inválida: %', p_sede;
  end if;

  v_totales := _fn_cierre_totales(p_desde, p_hasta, p_sede);

  select coalesce(array_agg(numero order by numero), array[]::integer[])
    into v_solap
  from cierres
  where fecha_desde <= p_hasta and fecha_hasta >= p_desde
    and (p_sede is null or sede_id is null or sede_id = p_sede);

  return v_totales || jsonb_build_object(
    'fecha_desde',  p_desde,
    'fecha_hasta',  p_hasta,
    'sede_id',      p_sede,
    'ya_cubierto',  (coalesce(array_length(v_solap, 1), 0) > 0),
    'solapamiento', to_jsonb(v_solap)
  );
end;
$function$;

-- ─────────────────────────────── H ─────────────────────────────────────────
drop policy if exists abonos_insert on public.abonos;
create policy abonos_insert on public.abonos for insert to public
with check (
  registrado_por = auth.uid()
  and get_my_rol() = any (array['Admin','Vendedor'])
  and exists (
    select 1 from ordenes_servicio o
    where o.id = abonos.orden_id
      and (get_my_rol() = 'Admin' or o.sede_id = get_my_sede_id())
      and o.estado <> all (array['entregada'::estado_orden, 'cancelada'::estado_orden])
  )
);
