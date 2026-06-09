-- Bloque 6 — Traspasos: SIMPLIFICAR el picking (no requiere un tercero para
-- verificar). El picker puede enviar directo (picking → en_transito). Se
-- conserva el camino 'verificado' por retrocompatibilidad, pero sin exigir que
-- el verificador sea distinto al picker.

-- 1) Permitir la transición directa picking → en_transito.
create or replace function public.trg_traspaso_validar_transicion()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $function$
begin
  if OLD.estado = NEW.estado then return NEW; end if;

  if not (
    (OLD.estado = 'borrador'    and NEW.estado = 'picking') or
    (OLD.estado = 'picking'     and NEW.estado in ('verificado', 'en_transito')) or
    (OLD.estado = 'verificado'  and NEW.estado = 'en_transito') or
    (OLD.estado = 'en_transito' and NEW.estado in ('recibido', 'con_diferencia')) or
    (OLD.estado in ('borrador', 'picking', 'verificado', 'en_transito')
       and NEW.estado = 'cancelado')
  ) then
    raise exception 'Transición de estado de traspaso inválida: % -> %', OLD.estado, NEW.estado;
  end if;

  return NEW;
end;
$function$;

-- 2) Procesador: 'enviar' acepta picking; 'verificar' sin requisito de tercero.
create or replace function public.fn_procesar_traspaso(
  p_traspaso_id uuid, p_accion text, p_items jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid      uuid;
  v_estado   text;
  v_picker   uuid;
  v_origen   text;
  v_destino  text;
  v_mi_sede  text;
  v_mi_rol   text;
  v_item     jsonb;
  v_hay_diff boolean;
  v_count    int;
  v_env      integer;
  v_rec      integer;
  v_envia    integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Usuario no autenticado';
  end if;

  select estado::text, picker_id, sede_origen_id, sede_destino_id
    into v_estado, v_picker, v_origen, v_destino
    from traspasos where id = p_traspaso_id for update;
  if not found then
    raise exception 'Traspaso no encontrado';
  end if;

  select sede_id, rol::text into v_mi_sede, v_mi_rol
    from usuarios where id = v_uid;

  if v_mi_rol not in ('Admin', 'Bodeguero', 'Vendedor') then
    raise exception 'No tienes permiso para operar traspasos (rol %)', v_mi_rol;
  end if;

  if p_accion = 'iniciar_picking' then
    if v_estado <> 'borrador' then
      raise exception 'Solo se puede iniciar picking en estado Pendiente. Estado actual: %', v_estado;
    end if;
    if v_mi_rol <> 'Admin' and v_mi_sede <> v_origen then
      raise exception 'Solo personal de la sede origen (%) puede hacer picking', v_origen;
    end if;
    update traspasos set estado = 'picking', picker_id = v_uid, fecha_picking = now(), updated_at = now()
     where id = p_traspaso_id;
    return jsonb_build_object('ok', true, 'estado', 'picking');

  elsif p_accion = 'actualizar_items' then
    if v_estado <> 'picking' then
      raise exception 'Solo se puede actualizar items en estado En Picking';
    end if;
    if v_uid <> v_picker then
      raise exception 'Solo el picker asignado puede actualizar los items del picking';
    end if;
    for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
      v_env := (v_item->>'cantidad_enviada')::integer;
      if v_env is not null and v_env < 0 then
        raise exception 'cantidad_enviada no puede ser negativa (recibido %)', v_env;
      end if;
      update detalle_traspaso set
        cantidad_enviada = coalesce(v_env, cantidad_enviada),
        picking_completado = coalesce((v_item->>'picking_completado')::boolean, picking_completado)
      where id = (v_item->>'detalle_id')::uuid and traspaso_id = p_traspaso_id;
    end loop;
    return jsonb_build_object('ok', true, 'accion', 'actualizar_items');

  elsif p_accion = 'verificar' then
    -- B6: se conserva por retrocompatibilidad, SIN exigir un tercero distinto
    -- al picker (la segregación de funciones se eliminó por pedido del cliente).
    if v_estado <> 'picking' then
      raise exception 'Solo se puede verificar un traspaso En Picking. Estado actual: %', v_estado;
    end if;
    if v_mi_rol <> 'Admin' and v_mi_sede <> v_origen then
      raise exception 'Solo personal de la sede origen (%) puede verificar', v_origen;
    end if;
    select count(*) into v_count from detalle_traspaso
     where traspaso_id = p_traspaso_id and picking_completado = false;
    if v_count > 0 then
      raise exception 'Hay % item(s) que no han sido completados en el picking', v_count;
    end if;
    update traspasos set estado = 'verificado', verificado_por = v_uid, fecha_verificacion = now(), updated_at = now()
     where id = p_traspaso_id;
    return jsonb_build_object('ok', true, 'estado', 'verificado');

  elsif p_accion = 'enviar' then
    -- B6: el picker puede enviar DIRECTO desde picking (sin verificación por
    -- tercero). Se conserva 'verificado' por compatibilidad.
    if v_estado not in ('picking', 'verificado') then
      raise exception 'Solo se puede enviar un traspaso en Picking o Verificado. Estado actual: %', v_estado;
    end if;
    if v_mi_rol <> 'Admin' and v_mi_sede <> v_origen then
      raise exception 'Solo personal de la sede origen (%) puede enviar', v_origen;
    end if;
    if v_estado = 'picking' then
      select count(*) into v_count from detalle_traspaso
       where traspaso_id = p_traspaso_id and picking_completado = false;
      if v_count > 0 then
        raise exception 'Hay % item(s) sin completar en el picking antes de enviar', v_count;
      end if;
    end if;
    if exists (
      select 1 from detalle_traspaso
       where traspaso_id = p_traspaso_id
         and (cantidad_enviada is null or cantidad_enviada <= 0)
    ) then
      raise exception 'Todos los items deben tener cantidad enviada (> 0) antes de enviar';
    end if;
    update traspasos set
      estado = 'en_transito',
      verificado_por = coalesce(verificado_por, v_uid),
      fecha_verificacion = coalesce(fecha_verificacion, now()),
      updated_at = now()
    where id = p_traspaso_id;
    return jsonb_build_object('ok', true, 'estado', 'en_transito');

  elsif p_accion = 'recibir' then
    if v_estado <> 'en_transito' then
      raise exception 'Solo se puede recibir un traspaso En Tránsito. Estado actual: %', v_estado;
    end if;
    if v_mi_rol <> 'Admin' and v_mi_sede <> v_destino then
      raise exception 'Solo usuarios de la sede destino (%) pueden confirmar la recepción', v_destino;
    end if;
    for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
      v_rec := coalesce((v_item->>'cantidad_recibida')::integer, 0);
      select cantidad_enviada into v_envia from detalle_traspaso
       where id = (v_item->>'detalle_id')::uuid and traspaso_id = p_traspaso_id;
      if not found then
        raise exception 'Ítem de traspaso no encontrado';
      end if;
      if v_rec < 0 or v_rec > coalesce(v_envia, 0) then
        raise exception 'cantidad_recibida (%) debe estar entre 0 y lo enviado (%)', v_rec, coalesce(v_envia, 0);
      end if;
      update detalle_traspaso set cantidad_recibida = v_rec
       where id = (v_item->>'detalle_id')::uuid and traspaso_id = p_traspaso_id;
    end loop;

    select exists(
      select 1 from detalle_traspaso
       where traspaso_id = p_traspaso_id and cantidad_recibida <> cantidad_enviada
    ) into v_hay_diff;

    if v_hay_diff then
      update traspasos set estado = 'con_diferencia', recibido_por = v_uid, fecha_recepcion = now(), updated_at = now()
       where id = p_traspaso_id;
      return jsonb_build_object('ok', true, 'estado', 'con_diferencia', 'hay_diferencia', true);
    else
      update traspasos set estado = 'recibido', recibido_por = v_uid, fecha_recepcion = now(), updated_at = now()
       where id = p_traspaso_id;
      return jsonb_build_object('ok', true, 'estado', 'recibido', 'hay_diferencia', false);
    end if;

  else
    raise exception 'Acción no válida: %. Opciones: iniciar_picking, actualizar_items, verificar, enviar, recibir', p_accion;
  end if;
end;
$function$;
