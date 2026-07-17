-- Sección 9 — Herramientas. Tarea 2: estados muertos `extraviada` y `en_mantenimiento`.
-- La UI ya los mostraba en filtros/badges pero NINGUNA función los escribía: no había
-- forma de marcar una herramienta como perdida ni de mandarla a mantenimiento.
--
-- Permisos: Bodega/Admin, siguiendo el patrón vivo (fn_devolver_herramienta,
-- fn_crear_herramienta_desde_insumo). Vendedor/Técnico no.
--
-- INVENTARIO: el extravío NO toca stock. fn_crear_herramienta_desde_insumo ya descuenta
-- `cantidad_insumo` cuando la unidad se convierte en herramienta, así que la unidad
-- extraviada YA estaba fuera del insumo. Descontar otra vez sería doble conteo.
-- Mismo criterio que fn_consumir_herramienta: solo se deja un movimiento informativo
-- (cantidad 0) para las inventariables.

create or replace function public.fn_marcar_herramienta_extraviada(p_herramienta_id uuid, p_observaciones text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_uid uuid := auth.uid(); v_rol text; v_sede text; v_h record; v_obs text; v_insumo int;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;
  if v_rol not in ('Admin','Bodeguero') then
    raise exception 'Solo Bodega o Administración pueden marcar una herramienta como extraviada';
  end if;
  select * into v_h from herramientas_prestamo where id = p_herramienta_id for update;
  if not found then raise exception 'Herramienta no encontrada'; end if;
  if v_h.activo is not true then raise exception 'La herramienta ya no está activa'; end if;
  if v_rol is distinct from 'Admin' and v_h.sede_id is distinct from v_sede then
    raise exception 'No tienes permiso sobre esta herramienta (es de otra sede)';
  end if;
  if v_h.estado not in ('disponible','prestada','en_mantenimiento') then
    raise exception 'No se puede marcar como extraviada una herramienta en estado %', v_h.estado;
  end if;
  v_obs := nullif(trim(coalesce(p_observaciones, '')), '');

  -- Se conserva prestada_a: si se perdió en manos de alguien, la ficha debe seguir diciéndolo.
  -- La herramienta queda activo=true: una extraviada puede aparecer (fn_recuperar_herramienta).
  perform set_config('cdv.herramienta_rpc', 'on', true);
  update herramientas_prestamo set estado='extraviada', updated_at=now() where id = p_herramienta_id;
  perform set_config('cdv.herramienta_rpc', 'off', true);

  insert into herramientas_historial (herramienta_id, evento, usuario_id, registrado_por, sede_id, herramienta_nombre, observaciones)
  values (p_herramienta_id, 'extravio', v_h.prestada_a, v_uid, v_h.sede_id, v_h.herramienta_nombre,
    coalesce(v_obs, 'Extravío registrado') || format(' (se extravió estando %s)', v_h.estado));

  if v_h.producto_id is not null then
    select cantidad_insumo into v_insumo from inventario where producto_id = v_h.producto_id and sede_id = v_h.sede_id;
    insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_tipo, referencia_id, usuario_id, observaciones)
    values ('ajuste', v_h.producto_id, v_h.sede_id, 0, coalesce(v_insumo,0), coalesce(v_insumo,0), 'herramienta', p_herramienta_id, v_uid,
      format('Herramienta "%s" marcada como EXTRAVIADA (no afecta el insumo: ya había salido al crearse)', v_h.herramienta_nombre));
  end if;

  return jsonb_build_object('herramienta_id', p_herramienta_id, 'estado', 'extraviada',
    'estado_anterior', v_h.estado, 'prestada_a', v_h.prestada_a);
end $fn$;

create or replace function public.fn_recuperar_herramienta(p_herramienta_id uuid, p_observaciones text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_uid uuid := auth.uid(); v_rol text; v_sede text; v_h record; v_obs text;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;
  if v_rol not in ('Admin','Bodeguero') then
    raise exception 'Solo Bodega o Administración pueden recuperar una herramienta extraviada';
  end if;
  select * into v_h from herramientas_prestamo where id = p_herramienta_id for update;
  if not found then raise exception 'Herramienta no encontrada'; end if;
  if v_h.activo is not true then raise exception 'La herramienta ya no está activa'; end if;
  if v_rol is distinct from 'Admin' and v_h.sede_id is distinct from v_sede then
    raise exception 'No tienes permiso sobre esta herramienta (es de otra sede)';
  end if;
  if v_h.estado <> 'extraviada' then
    raise exception 'Solo se puede recuperar una herramienta extraviada (estado actual: %)', v_h.estado;
  end if;
  v_obs := nullif(trim(coalesce(p_observaciones, '')), '');

  -- Apareció: vuelve a manos de la empresa y el préstamo que quedó abierto se cierra.
  -- No toca inventario: sigue siendo herramienta, no regresa al insumo (eso es fn_devolver_herramienta).
  perform set_config('cdv.herramienta_rpc', 'on', true);
  update herramientas_prestamo set estado='disponible', estado_prestamo='devuelto',
    fecha_devolucion_real=now(), prestada_a=null, updated_at=now() where id = p_herramienta_id;
  perform set_config('cdv.herramienta_rpc', 'off', true);

  insert into herramientas_historial (herramienta_id, evento, usuario_id, registrado_por, sede_id, herramienta_nombre, observaciones)
  values (p_herramienta_id, 'recuperacion', v_h.prestada_a, v_uid, v_h.sede_id, v_h.herramienta_nombre,
    coalesce(v_obs, 'La herramienta extraviada apareció y vuelve al catálogo'));

  return jsonb_build_object('herramienta_id', p_herramienta_id, 'estado', 'disponible', 'estaba_en_manos_de', v_h.prestada_a);
end $fn$;

create or replace function public.fn_enviar_herramienta_mantenimiento(p_herramienta_id uuid, p_observaciones text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_uid uuid := auth.uid(); v_rol text; v_sede text; v_h record; v_obs text;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;
  if v_rol not in ('Admin','Bodeguero') then
    raise exception 'Solo Bodega o Administración pueden enviar una herramienta a mantenimiento';
  end if;
  select * into v_h from herramientas_prestamo where id = p_herramienta_id for update;
  if not found then raise exception 'Herramienta no encontrada'; end if;
  if v_h.activo is not true then raise exception 'La herramienta ya no está activa'; end if;
  if v_rol is distinct from 'Admin' and v_h.sede_id is distinct from v_sede then
    raise exception 'No tienes permiso sobre esta herramienta (es de otra sede)';
  end if;
  if v_h.estado not in ('disponible','prestada') then
    raise exception 'Solo se puede enviar a mantenimiento una herramienta disponible o prestada (estado actual: %)', v_h.estado;
  end if;
  v_obs := nullif(trim(coalesce(p_observaciones, '')), '');

  -- Si venía prestada, la unidad volvió físicamente: el préstamo se cierra.
  -- No toca inventario: la unidad sigue siendo herramienta, no regresa al insumo.
  perform set_config('cdv.herramienta_rpc', 'on', true);
  update herramientas_prestamo set estado='en_mantenimiento',
    estado_prestamo = case when v_h.estado='prestada' then 'devuelto'::estado_prestamo else v_h.estado_prestamo end,
    fecha_devolucion_real = case when v_h.estado='prestada' then now() else v_h.fecha_devolucion_real end,
    prestada_a = case when v_h.estado='prestada' then null else v_h.prestada_a end,
    updated_at=now() where id = p_herramienta_id;
  perform set_config('cdv.herramienta_rpc', 'off', true);

  insert into herramientas_historial (herramienta_id, evento, usuario_id, registrado_por, sede_id, herramienta_nombre, observaciones)
  values (p_herramienta_id, 'mantenimiento_entrada', v_h.prestada_a, v_uid, v_h.sede_id, v_h.herramienta_nombre,
    coalesce(v_obs, 'Entra a mantenimiento') || format(' (venía de estado %s)', v_h.estado));

  return jsonb_build_object('herramienta_id', p_herramienta_id, 'estado', 'en_mantenimiento', 'estado_anterior', v_h.estado);
end $fn$;

create or replace function public.fn_finalizar_mantenimiento(p_herramienta_id uuid, p_observaciones text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_uid uuid := auth.uid(); v_rol text; v_sede text; v_h record; v_obs text;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;
  if v_rol not in ('Admin','Bodeguero') then
    raise exception 'Solo Bodega o Administración pueden cerrar un mantenimiento';
  end if;
  select * into v_h from herramientas_prestamo where id = p_herramienta_id for update;
  if not found then raise exception 'Herramienta no encontrada'; end if;
  if v_h.activo is not true then raise exception 'La herramienta ya no está activa'; end if;
  if v_rol is distinct from 'Admin' and v_h.sede_id is distinct from v_sede then
    raise exception 'No tienes permiso sobre esta herramienta (es de otra sede)';
  end if;
  if v_h.estado <> 'en_mantenimiento' then
    raise exception 'La herramienta no está en mantenimiento (estado actual: %)', v_h.estado;
  end if;
  v_obs := nullif(trim(coalesce(p_observaciones, '')), '');

  perform set_config('cdv.herramienta_rpc', 'on', true);
  update herramientas_prestamo set estado='disponible', updated_at=now() where id = p_herramienta_id;
  perform set_config('cdv.herramienta_rpc', 'off', true);

  insert into herramientas_historial (herramienta_id, evento, usuario_id, registrado_por, sede_id, herramienta_nombre, observaciones)
  values (p_herramienta_id, 'mantenimiento_salida', null, v_uid, v_h.sede_id, v_h.herramienta_nombre,
    coalesce(v_obs, 'Sale de mantenimiento y vuelve al catálogo'));

  return jsonb_build_object('herramienta_id', p_herramienta_id, 'estado', 'disponible');
end $fn$;

-- ACL igual al patrón vivo (fn_devolver_herramienta): sin PUBLIC, sin anon.
revoke all on function public.fn_marcar_herramienta_extraviada(uuid, text) from public, anon;
revoke all on function public.fn_recuperar_herramienta(uuid, text) from public, anon;
revoke all on function public.fn_enviar_herramienta_mantenimiento(uuid, text) from public, anon;
revoke all on function public.fn_finalizar_mantenimiento(uuid, text) from public, anon;
grant execute on function public.fn_marcar_herramienta_extraviada(uuid, text) to authenticated, service_role;
grant execute on function public.fn_recuperar_herramienta(uuid, text) to authenticated, service_role;
grant execute on function public.fn_enviar_herramienta_mantenimiento(uuid, text) to authenticated, service_role;
grant execute on function public.fn_finalizar_mantenimiento(uuid, text) to authenticated, service_role;