-- Tarea 1 (cont.): las RPC vivas escriben su evento en el historial.
-- OJO: fn_prestar_herramientas_lote NO ponía el flag cdv.herramienta_rpc.
-- Funcionaba solo porque el trigger no bloqueaba 'prestada'. Al endurecer el
-- trigger (Tarea 3) el flag pasa a ser obligatorio: se agrega aquí.
create or replace function public.fn_prestar_herramientas_lote(p_herramienta_id uuid, p_usuario_id uuid, p_cantidad integer default 1, p_fecha_esperada timestamptz default null, p_observaciones text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_uid uuid := auth.uid(); v_rol text; v_misede text;
  v_anchor herramientas_prestamo; v_ids uuid[]; v_n int; v_obs text;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  if p_usuario_id is null then raise exception 'Selecciona un usuario'; end if;
  if p_cantidad is null or p_cantidad < 1 then raise exception 'Cantidad inválida'; end if;
  if not exists (select 1 from usuarios where id = p_usuario_id) then
    raise exception 'Usuario destinatario no válido';
  end if;
  select rol::text, sede_id into v_rol, v_misede from usuarios where id = v_uid;
  select * into v_anchor from herramientas_prestamo where id = p_herramienta_id for update;
  if not found then raise exception 'Herramienta no encontrada'; end if;
  if v_rol is distinct from 'Admin' and v_anchor.sede_id is distinct from v_misede then
    raise exception 'No tienes permiso sobre herramientas de esta sede';
  end if;
  v_obs := nullif(trim(coalesce(p_observaciones, '')), '');

  select array_agg(id) into v_ids from (
    select hp.id from herramientas_prestamo hp
    where hp.sede_id = v_anchor.sede_id and hp.estado = 'disponible' and hp.activo = true
      and ((v_anchor.producto_id is not null and hp.producto_id = v_anchor.producto_id)
        or (v_anchor.producto_id is null and hp.producto_id is null
            and hp.herramienta_nombre is not distinct from v_anchor.herramienta_nombre
            and hp.herramienta_codigo is not distinct from v_anchor.herramienta_codigo))
    order by (hp.id = p_herramienta_id) desc, hp.created_at
    limit p_cantidad for update skip locked
  ) sel;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then raise exception 'No hay unidades disponibles de esta herramienta en la sede'; end if;

  perform set_config('cdv.herramienta_rpc', 'on', true);
  update herramientas_prestamo set
    estado='prestada', estado_prestamo='activo', prestada_a=p_usuario_id,
    fecha_prestamo=now(), fecha_devolucion_esperada=p_fecha_esperada,
    fecha_devolucion_real=null, observaciones=v_obs, updated_at=now()
  where id = any(v_ids);
  perform set_config('cdv.herramienta_rpc', 'off', true);

  -- Un evento por UNIDAD prestada (cada fila = una unidad física).
  insert into herramientas_historial (herramienta_id, evento, usuario_id, registrado_por, sede_id, herramienta_nombre, observaciones)
  select hp.id, 'prestamo', p_usuario_id, v_uid, hp.sede_id, hp.herramienta_nombre, v_obs
  from herramientas_prestamo hp where hp.id = any(v_ids);

  return jsonb_build_object('ok', true, 'prestadas', v_n, 'solicitadas', p_cantidad);
end $fn$;

create or replace function public.fn_devolver_herramienta(p_herramienta_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_uid uuid := auth.uid(); v_rol text; v_sede text; v_h record;
  v_insumo_ant int; v_insumo_post int;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;
  select * into v_h from herramientas_prestamo where id = p_herramienta_id for update;
  if not found then raise exception 'Herramienta no encontrada'; end if;
  if v_h.activo is not true then raise exception 'La herramienta ya no está activa'; end if;
  if v_rol not in ('Admin','Bodeguero') then
    raise exception 'Solo Bodega o Administración pueden registrar devoluciones de herramientas';
  end if;
  if v_rol is distinct from 'Admin' and v_h.sede_id is distinct from v_sede then
    raise exception 'No tienes permiso sobre esta herramienta (es de otra sede)';
  end if;

  if v_h.producto_id is null then
    if v_h.estado <> 'prestada' then raise exception 'La herramienta no está prestada'; end if;
    perform set_config('cdv.herramienta_rpc', 'on', true);
    update herramientas_prestamo set estado='disponible', estado_prestamo='devuelto',
      fecha_devolucion_real=now(), prestada_a=null, updated_at=now() where id = p_herramienta_id;
    perform set_config('cdv.herramienta_rpc', 'off', true);
    insert into herramientas_historial (herramienta_id, evento, usuario_id, registrado_por, sede_id, herramienta_nombre, observaciones)
    values (p_herramienta_id, 'devolucion', v_h.prestada_a, v_uid, v_h.sede_id, v_h.herramienta_nombre, 'Devolución al catálogo de herramientas');
    return jsonb_build_object('herramienta_id', p_herramienta_id, 'inventariable', false, 'estado', 'disponible');
  end if;

  if v_rol is distinct from 'Admin' then
    raise exception 'Solo el Admin puede regresar una herramienta inventariable al stock de insumo';
  end if;
  if v_h.estado not in ('prestada', 'disponible') then
    raise exception 'Solo se puede regresar a insumo una herramienta prestada o disponible (estado actual: %)', v_h.estado;
  end if;

  insert into inventario (producto_id, sede_id, cantidad, cantidad_insumo)
  values (v_h.producto_id, v_h.sede_id, 0, 1)
  on conflict (producto_id, sede_id) do update
     set cantidad_insumo = inventario.cantidad_insumo + 1, ultimo_movimiento = now(), updated_at = now()
  returning cantidad_insumo into v_insumo_post;
  v_insumo_ant := v_insumo_post - 1;

  perform set_config('cdv.herramienta_rpc', 'on', true);
  update herramientas_prestamo set estado='disponible', estado_prestamo='devuelto',
    fecha_devolucion_real=now(), prestada_a=null, activo=false, updated_at=now() where id = p_herramienta_id;
  perform set_config('cdv.herramienta_rpc', 'off', true);

  insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_tipo, referencia_id, usuario_id, observaciones)
  values ('ajuste', v_h.producto_id, v_h.sede_id, 1, v_insumo_ant, v_insumo_post, 'herramienta', p_herramienta_id, v_uid,
    format('Herramienta → insumo: "%s" regresó al stock de insumo', v_h.herramienta_nombre));

  insert into herramientas_historial (herramienta_id, evento, usuario_id, registrado_por, sede_id, herramienta_nombre, observaciones)
  values (p_herramienta_id, 'devolucion', v_h.prestada_a, v_uid, v_h.sede_id, v_h.herramienta_nombre, 'Devolución: la unidad regresó al stock de insumo');

  perform fn_actualizar_estado_stock(v_h.producto_id, v_h.sede_id);
  return jsonb_build_object('herramienta_id', p_herramienta_id, 'inventariable', true, 'cantidad_insumo', v_insumo_post, 'retirada', true);
end $fn$;

create or replace function public.fn_consumir_herramienta(p_herramienta_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_uid uuid := auth.uid(); v_rol text; v_h record; v_insumo int;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text into v_rol from usuarios where id = v_uid;
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo el Admin puede marcar una herramienta como consumida';
  end if;
  select * into v_h from herramientas_prestamo where id = p_herramienta_id for update;
  if not found then raise exception 'Herramienta no encontrada'; end if;
  if v_h.activo is not true then raise exception 'La herramienta ya no está activa'; end if;
  if v_h.estado <> 'prestada' then
    raise exception 'Solo se puede consumir una herramienta prestada (estado actual: %)', v_h.estado;
  end if;

  perform set_config('cdv.herramienta_rpc', 'on', true);
  update herramientas_prestamo set estado='consumido', estado_prestamo='devuelto',
    fecha_devolucion_real=now(), activo=false, updated_at=now() where id = p_herramienta_id;
  perform set_config('cdv.herramienta_rpc', 'off', true);

  if v_h.producto_id is not null then
    select cantidad_insumo into v_insumo from inventario where producto_id = v_h.producto_id and sede_id = v_h.sede_id;
    insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_tipo, referencia_id, usuario_id, observaciones)
    values ('ajuste', v_h.producto_id, v_h.sede_id, 0, coalesce(v_insumo,0), coalesce(v_insumo,0), 'herramienta', p_herramienta_id, v_uid,
      format('Herramienta "%s" marcada como consumida/dada de baja (no regresa al insumo)', v_h.herramienta_nombre));
  end if;

  insert into herramientas_historial (herramienta_id, evento, usuario_id, registrado_por, sede_id, herramienta_nombre, observaciones)
  values (p_herramienta_id, 'consumo', v_h.prestada_a, v_uid, v_h.sede_id, v_h.herramienta_nombre, 'Consumo/baja definitiva: no regresa al insumo');

  return jsonb_build_object('herramienta_id', p_herramienta_id, 'estado', 'consumido');
end $fn$;