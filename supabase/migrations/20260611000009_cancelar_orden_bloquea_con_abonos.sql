-- INFO (auditoría 2026-06-09, I1): fn_cancelar_orden borra detalle_orden (reintegra
-- stock vía trigger) y pone estado='cancelada', pero NO toca la tabla abonos. Si la OT
-- tenía anticipos, quedan ligados a una OT cancelada sin asiento de devolución: el dinero
-- figura como recibido contra una OT inexistente comercialmente. El flujo de cancelación
-- no cierra el ciclo financiero.
--
-- Fix (mínimo viable, consistente con el resto de fn_* que validan precondiciones; la
-- tabla abonos no admite negativos ni tiene columna de anulación, así que no hay forma
-- de asentar un reembolso hoy): bloquear la cancelación si hay abonos>0, obligando a
-- gestionar la devolución del anticipo antes de cancelar.

create or replace function public.fn_cancelar_orden(p_orden_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_rol    text;
  v_estado estado_orden;
  v_abonos numeric;
begin
  select get_my_rol() into v_rol;
  if v_rol <> 'Admin' then
    raise exception 'Solo el administrador puede cancelar órdenes de trabajo';
  end if;

  select estado into v_estado from ordenes_servicio where id = p_orden_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if v_estado = 'entregada' then raise exception 'No se puede cancelar una OT ya entregada'; end if;
  if v_estado = 'cancelada' then raise exception 'La orden ya está cancelada'; end if;

  v_abonos := coalesce(fn_total_abonos_ot(p_orden_id), 0);
  if v_abonos > 0 then
    raise exception 'No se puede cancelar: la OT tiene abonos registrados por %. Gestiona la devolución del anticipo al cliente antes de cancelar.', v_abonos;
  end if;

  delete from detalle_orden where orden_id = p_orden_id;
  update ordenes_servicio set estado = 'cancelada' where id = p_orden_id;
end; $function$;
