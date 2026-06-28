-- Reporte clienta (validado): los técnicos podían registrar la DEVOLUCIÓN de
-- herramientas. Solo Bodega y Administración deben poder hacerlo (prestar ya estaba
-- restringido a Admin/Bodeguero, pero devolver no exigía rol — solo "misma sede").
--
-- Fix: (1) fn_devolver_herramienta exige rol Admin o Bodeguero (Bodeguero solo su
-- sede); (2) RLS hp_update se endurece a Admin o (Bodeguero y misma sede), como
-- hp_insert, para defensa en profundidad (los RPC son SECURITY DEFINER, no se ven
-- afectados; no hay updates directos desde el frontend).

create or replace function public.fn_devolver_herramienta(p_herramienta_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text; v_sede text;
  v_h record;
  v_insumo_ant int; v_insumo_post int;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;

  select * into v_h from herramientas_prestamo
   where id = p_herramienta_id for update;
  if not found then raise exception 'Herramienta no encontrada'; end if;
  if v_h.activo is not true then
    raise exception 'La herramienta ya no está activa';
  end if;

  -- Solo Bodega o Administración pueden registrar devoluciones (los técnicos no).
  if v_rol not in ('Admin','Bodeguero') then
    raise exception 'Solo Bodega o Administración pueden registrar devoluciones de herramientas';
  end if;
  if v_rol is distinct from 'Admin' and v_h.sede_id is distinct from v_sede then
    raise exception 'No tienes permiso sobre esta herramienta (es de otra sede)';
  end if;

  if v_h.producto_id is null then
    if v_h.estado <> 'prestada' then
      raise exception 'La herramienta no está prestada';
    end if;
    perform set_config('cdv.herramienta_rpc', 'on', true);
    update herramientas_prestamo
       set estado = 'disponible', estado_prestamo = 'devuelto',
           fecha_devolucion_real = now(), prestada_a = null, updated_at = now()
     where id = p_herramienta_id;
    perform set_config('cdv.herramienta_rpc', 'off', true);
    return jsonb_build_object('herramienta_id', p_herramienta_id,
      'inventariable', false, 'estado', 'disponible');
  end if;

  -- Regresar una inventariable al stock de insumo: solo Admin.
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo el Admin puede regresar una herramienta inventariable al stock de insumo';
  end if;

  if v_h.estado not in ('prestada', 'disponible') then
    raise exception 'Solo se puede regresar a insumo una herramienta prestada o disponible (estado actual: %)', v_h.estado;
  end if;

  insert into inventario (producto_id, sede_id, cantidad, cantidad_insumo)
  values (v_h.producto_id, v_h.sede_id, 0, 1)
  on conflict (producto_id, sede_id) do update
     set cantidad_insumo = inventario.cantidad_insumo + 1,
         ultimo_movimiento = now(), updated_at = now()
  returning cantidad_insumo into v_insumo_post;
  v_insumo_ant := v_insumo_post - 1;

  perform set_config('cdv.herramienta_rpc', 'on', true);
  update herramientas_prestamo
     set estado = 'disponible', estado_prestamo = 'devuelto',
         fecha_devolucion_real = now(), prestada_a = null,
         activo = false, updated_at = now()
   where id = p_herramienta_id;
  perform set_config('cdv.herramienta_rpc', 'off', true);

  insert into movimientos (
    tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_tipo, referencia_id, usuario_id, observaciones
  ) values (
    'ajuste', v_h.producto_id, v_h.sede_id, 1, v_insumo_ant, v_insumo_post,
    'herramienta', p_herramienta_id, v_uid,
    format('Herramienta → insumo: "%s" regresó al stock de insumo', v_h.herramienta_nombre)
  );

  perform fn_actualizar_estado_stock(v_h.producto_id, v_h.sede_id);

  return jsonb_build_object('herramienta_id', p_herramienta_id,
    'inventariable', true, 'cantidad_insumo', v_insumo_post, 'retirada', true);
end $function$;

-- RLS: endurecer UPDATE a Admin o (Bodeguero y misma sede), como hp_insert.
drop policy if exists hp_update on public.herramientas_prestamo;
create policy hp_update on public.herramientas_prestamo
  for update
  using (
    (select get_my_rol()) = 'Admin'
    or ((select get_my_rol()) = 'Bodeguero' and sede_id = (select get_my_sede_id()))
  )
  with check (
    (select get_my_rol()) = 'Admin'
    or ((select get_my_rol()) = 'Bodeguero' and sede_id = (select get_my_sede_id()))
  );
