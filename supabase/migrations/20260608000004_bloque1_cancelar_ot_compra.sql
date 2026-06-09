-- Bloque 1 — Paso 2/2: cancelación (solo Admin) de OT y compras con reversa
-- de stock. Patrón basado en fn_anular_venta.

-- (a) Transición de OT: permitir cualquier estado no terminal → 'cancelada',
--     y dejar 'cancelada' como terminal (igual que 'entregada').
create or replace function public.trg_orden_validar_transicion()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $function$
begin
  if old.estado = new.estado then return new; end if;
  if old.estado in ('entregada', 'cancelada') then
    raise exception 'OT % es inmutable', old.estado;
  end if;
  if new.estado = 'cancelada' then
    null;  -- cancelación: permitida desde cualquier estado no terminal
  elsif old.estado = 'abierta' and new.estado = 'completada'
        and new.estado_autorizacion = 'no_autorizado' then
    null;
  elsif not (
    (old.estado = 'abierta' and new.estado in ('en_proceso','esperando_repuesto'))
    or (old.estado = 'en_proceso' and new.estado in ('esperando_repuesto','completada'))
    or (old.estado = 'esperando_repuesto' and new.estado in ('en_proceso','completada'))
    or (old.estado = 'completada' and new.estado in ('pendiente_recogida','entregada'))
    or (old.estado = 'pendiente_recogida' and new.estado = 'entregada')
  ) then
    raise exception 'Transición ilegal de % a %', old.estado, new.estado;
  end if;
  if new.estado = 'pendiente_recogida' and old.estado <> 'pendiente_recogida' then
    new.pendiente_recogida_at := now();
  end if;
  return new;
end; $function$;

-- (b) Validaciones de anticipo/autorización: la cancelación las omite (un Admin
--     puede cancelar una OT en cualquier estado de autorización).
create or replace function public.trg_orden_validar_anticipo()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $function$
declare v_total numeric;
begin
  if new.estado = 'cancelada' then return new; end if;  -- cancelar siempre permitido

  if new.estado_autorizacion = 'pendiente' and new.estado <> 'abierta' then
    raise exception 'No se puede avanzar la OT mientras la autorización del cliente esté en "pendiente". Marca primero "Autorizado" o "No autorizado".';
  end if;

  if new.estado_autorizacion = 'no_autorizado'
     and new.estado in ('en_proceso','esperando_repuesto') then
    raise exception 'OT no autorizada no debe iniciar trabajo (en_proceso/esperando_repuesto). Pasa directo a "Completada" para cobrar valor por revisión.';
  end if;

  if new.estado_autorizacion = 'autorizado'
     and new.estado in ('en_proceso','esperando_repuesto','completada') then
    if (old.estado is distinct from new.estado)
       or (old.estado_autorizacion is distinct from new.estado_autorizacion) then
      select coalesce(sum(monto),0) into v_total from abonos where orden_id = new.id;
      if v_total = 0 then
        raise exception 'OT autorizada con trabajo iniciado requiere al menos un anticipo registrado';
      end if;
    end if;
  end if;

  if new.estado_autorizacion = 'no_autorizado'
     and new.estado in ('completada','pendiente_recogida','entregada')
     and (new.valor_revision is null or new.valor_revision <= 0) then
    raise exception 'OT no autorizada al cerrarse requiere un valor por revisión > 0';
  end if;

  return new;
end; $function$;

-- (c) Cancelar OT: devuelve los repuestos consumidos (al borrar detalle_orden,
--     trg_orden_revertir_repuesto restaura el insumo) y marca 'cancelada'.
create or replace function public.fn_cancelar_orden(p_orden_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_rol    text;
  v_estado estado_orden;
begin
  select get_my_rol() into v_rol;
  if v_rol <> 'Admin' then
    raise exception 'Solo el administrador puede cancelar órdenes de trabajo';
  end if;

  select estado into v_estado from ordenes_servicio where id = p_orden_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if v_estado = 'entregada' then raise exception 'No se puede cancelar una OT ya entregada'; end if;
  if v_estado = 'cancelada' then raise exception 'La orden ya está cancelada'; end if;

  delete from detalle_orden where orden_id = p_orden_id;  -- restaura stock vía trigger
  update ordenes_servicio set estado = 'cancelada' where id = p_orden_id;
end; $function$;

-- (d) Cancelar compra: si ya ingresó stock (recibida), lo revierte por ítem.
--     Bloquea si el stock disponible ya no alcanza (parte se usó/vendió).
--     No re-recalcula costo_promedio (reversa de promedio ponderado es lossy;
--     drift menor y aceptable en una cancelación).
create or replace function public.fn_cancelar_compra(p_compra_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_rol             text;
  v_estado          estado_compra;
  v_recibida        boolean;
  v_sede            text;
  v_det             record;
  v_stock_ant       integer;
  v_stock_insumo_ant integer;
  v_disp            integer;
  v_new             integer;
begin
  select get_my_rol() into v_rol;
  if v_rol <> 'Admin' then
    raise exception 'Solo el administrador puede cancelar compras';
  end if;

  select estado, recibida, sede_destino_id
    into v_estado, v_recibida, v_sede
    from compras where id = p_compra_id for update;
  if not found then raise exception 'Compra no encontrada'; end if;
  if v_estado = 'cancelada' then raise exception 'La compra ya está cancelada'; end if;

  if v_recibida then
    for v_det in select * from detalle_compra where compra_id = p_compra_id loop
      select coalesce(cantidad,0), coalesce(cantidad_insumo,0)
        into v_stock_ant, v_stock_insumo_ant
        from inventario
       where producto_id = v_det.producto_id and sede_id = v_sede
       for update;

      if v_det.destino = 'insumo' then
        v_disp := coalesce(v_stock_insumo_ant,0);
      else
        v_disp := coalesce(v_stock_ant,0);
      end if;

      if v_disp < v_det.cantidad then
        raise exception 'No se puede cancelar: el inventario ya no tiene stock suficiente para revertir el producto % (disponible %, requiere %). Parte de esa compra ya se usó o vendió.',
          v_det.producto_id, v_disp, v_det.cantidad;
      end if;

      if v_det.destino = 'insumo' then
        v_new := v_stock_insumo_ant - v_det.cantidad;
        update inventario
           set cantidad_insumo = v_new, ultimo_movimiento = now(), updated_at = now()
         where producto_id = v_det.producto_id and sede_id = v_sede;
        insert into movimientos (tipo, producto_id, sede_id, cantidad,
          stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
        values ('ajuste', v_det.producto_id, v_sede, v_det.cantidad,
          v_stock_insumo_ant, v_new, p_compra_id, 'compra', auth.uid(),
          'Cancelación de compra (reversa de insumo)');
      else
        v_new := v_stock_ant - v_det.cantidad;
        update inventario
           set cantidad = v_new, ultimo_movimiento = now(), updated_at = now()
         where producto_id = v_det.producto_id and sede_id = v_sede;
        insert into movimientos (tipo, producto_id, sede_id, cantidad,
          stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
        values ('ajuste', v_det.producto_id, v_sede, v_det.cantidad,
          v_stock_ant, v_new, p_compra_id, 'compra', auth.uid(),
          'Cancelación de compra (reversa)');
        perform fn_actualizar_estado_stock(v_det.producto_id, v_sede);
      end if;
    end loop;
  end if;

  update compras set estado = 'cancelada' where id = p_compra_id;
end; $function$;

grant execute on function public.fn_cancelar_orden(uuid) to authenticated;
grant execute on function public.fn_cancelar_compra(uuid) to authenticated;
