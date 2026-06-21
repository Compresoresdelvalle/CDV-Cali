-- ============================================================================
-- Rediseño OT — Opción A — FASE 4b: Anulación / cancelación (solo Admin).
-- - fn_anular_venta: si la venta es origen='ot', NO toca stock (nunca lo movió)
--   y revierte la OT a 'terminada' liberando sus anticipos.
-- - fn_cancelar_orden: permite cancelar una OT con anticipos (Admin), revirtiendo
--   el stock de repuestos; los anticipos quedan registrados y el cierre ya
--   excluye las OT canceladas (devolución se gestiona operativamente).
-- ============================================================================

create or replace function public.fn_anular_venta(p_venta_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_anulada boolean;
  v_item detalle_venta%rowtype;
  v_sede_id text;
  v_origen text;
  v_orden_id uuid;
  v_stock_ant integer;
  v_stock_post integer;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select get_my_rol() into v_rol;
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo el administrador puede anular ventas';
  end if;

  select anulada, sede_id, origen, orden_id into v_anulada, v_sede_id, v_origen, v_orden_id
  from ventas where id = p_venta_id;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v_anulada then raise exception 'La venta ya fue anulada anteriormente'; end if;

  perform set_config('cdv.anulando_venta', 'on', true);
  update ventas set anulada=true, anulada_por=v_uid, anulada_en=now(), motivo_anulacion=v_motivo
   where id = p_venta_id;
  perform set_config('cdv.anulando_venta', 'off', true);

  update pagos_cuenta set anulado=true, anulado_por=v_uid, anulado_en=now(),
         motivo_anulacion=coalesce(v_motivo,'Venta anulada')
   where venta_id = p_venta_id and coalesce(anulado,false)=false;

  -- Venta de OT: no movió stock (salió en la descarga de la OT). Revertir la OT.
  if v_origen = 'ot' then
    update abonos set venta_id = null where venta_id = p_venta_id;
    update ordenes_servicio set venta_id = null, estado = 'terminada', fecha_entrega = null
     where id = v_orden_id;
    return;
  end if;

  -- Venta directa: reintegrar stock por cada línea.
  for v_item in select * from detalle_venta where venta_id = p_venta_id loop
    if v_item.producto_id is null then continue; end if;
    select cantidad into v_stock_ant from inventario
     where producto_id = v_item.producto_id and sede_id = v_sede_id for update;
    v_stock_post := coalesce(v_stock_ant,0) + v_item.cantidad;
    update inventario set cantidad = v_stock_post, updated_at = now()
     where producto_id = v_item.producto_id and sede_id = v_sede_id;
    insert into movimientos (producto_id, sede_id, tipo, cantidad, stock_anterior, stock_posterior,
                            referencia_id, referencia_tipo, usuario_id, observaciones)
    select v_item.producto_id, v_sede_id, 'ajuste', v_item.cantidad,
           coalesce(v_stock_ant,0), v_stock_post, p_venta_id, 'venta', v_uid,
           'Anulación de venta #' || v.numero
    from ventas v where v.id = p_venta_id;
    perform fn_actualizar_estado_stock(v_item.producto_id, v_sede_id);
  end loop;
end;
$function$;

create or replace function public.fn_cancelar_orden(p_orden_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_rol text; v_estado estado_orden;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  select get_my_rol() into v_rol;
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo el administrador puede cancelar órdenes de trabajo';
  end if;

  select estado into v_estado from ordenes_servicio where id = p_orden_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if v_estado = 'entregada' then raise exception 'No se puede cancelar una OT ya entregada'; end if;
  if v_estado = 'cancelada' then raise exception 'La orden ya está cancelada'; end if;

  -- Admin puede cancelar aunque tenga anticipos (devolución operativa). El cierre
  -- excluye las OT canceladas, así que esos anticipos no cuentan como ingreso.
  delete from detalle_orden where orden_id = p_orden_id;
  update ordenes_servicio set estado = 'cancelada' where id = p_orden_id;
end;
$function$;
