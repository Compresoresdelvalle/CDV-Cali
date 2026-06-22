-- ============================================================================
-- REQ7 — Prestar varias unidades de la misma referencia en un solo movimiento.
-- El modelo es por instancia (1 fila = 1 herramienta). Este RPC presta hasta N
-- unidades DISPONIBLES de la misma referencia (mismo producto_id, o mismo
-- nombre+código para herramientas manuales) en la misma sede, al mismo usuario
-- y fecha, en una sola transacción.
-- Permiso: Admin, o usuario de la misma sede (igual que el préstamo actual).
-- La transición disponible→prestada pasa el trigger trg_hp_proteger_mutacion
-- sin bandera (no toca activo ni producto_id).
-- ============================================================================

create or replace function public.fn_prestar_herramientas_lote(
  p_herramienta_id uuid,
  p_usuario_id uuid,
  p_cantidad int default 1,
  p_fecha_esperada timestamptz default null,
  p_observaciones text default null)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid    uuid := auth.uid();
  v_rol    text;
  v_misede text;
  v_anchor herramientas_prestamo;
  v_ids    uuid[];
  v_n      int;
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

  -- Hasta N unidades disponibles de la MISMA referencia en la sede (ancla primero).
  select array_agg(id) into v_ids from (
    select hp.id
    from herramientas_prestamo hp
    where hp.sede_id = v_anchor.sede_id
      and hp.estado = 'disponible'
      and hp.activo = true
      and (
        (v_anchor.producto_id is not null and hp.producto_id = v_anchor.producto_id)
        or (v_anchor.producto_id is null and hp.producto_id is null
            and hp.herramienta_nombre is not distinct from v_anchor.herramienta_nombre
            and hp.herramienta_codigo is not distinct from v_anchor.herramienta_codigo)
      )
    order by (hp.id = p_herramienta_id) desc, hp.created_at
    limit p_cantidad
    for update skip locked
  ) sel;

  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then
    raise exception 'No hay unidades disponibles de esta herramienta en la sede';
  end if;

  update herramientas_prestamo set
    estado                    = 'prestada',
    estado_prestamo           = 'activo',
    prestada_a                = p_usuario_id,
    fecha_prestamo            = now(),
    fecha_devolucion_esperada = p_fecha_esperada,
    fecha_devolucion_real     = null,
    observaciones             = nullif(trim(coalesce(p_observaciones, '')), ''),
    updated_at                = now()
  where id = any(v_ids);

  return jsonb_build_object('ok', true, 'prestadas', v_n, 'solicitadas', p_cantidad);
end $$;

revoke execute on function public.fn_prestar_herramientas_lote(uuid, uuid, int, timestamptz, text) from public, anon;
grant execute on function public.fn_prestar_herramientas_lote(uuid, uuid, int, timestamptz, text) to authenticated;
