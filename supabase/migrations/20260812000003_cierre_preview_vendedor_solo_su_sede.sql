-- Cierre read-only para vendedoras: se permite el rol Vendedor en el PREVIEW,
-- pero SIEMPRE acotado a SU sede (get_my_sede_id), ignorando el parámetro
-- p_sede aunque lo manden a mano — así una vendedora nunca ve otra sede.
-- Generar/sellar sigue siendo solo-Admin (fn_generar_cierre, sin cambios).
CREATE OR REPLACE FUNCTION public.fn_preview_cierre(p_desde date, p_hasta date, p_sede text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_rol     text;
  v_totales jsonb;
  v_solap   integer[];
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text into v_rol from usuarios where id = v_uid;
  if v_rol is null or v_rol not in ('Admin','Bodeguero','Vendedor') then
    raise exception 'No tienes permiso para consultar cierres';
  end if;
  -- Vendedor: solo su sede, sin importar lo que pida el parámetro.
  if v_rol = 'Vendedor' then
    p_sede := get_my_sede_id();
    if p_sede is null then
      raise exception 'Tu usuario no tiene una sede asignada. Contacta al administrador.';
    end if;
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
