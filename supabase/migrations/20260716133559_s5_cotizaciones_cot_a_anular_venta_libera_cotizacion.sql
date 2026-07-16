-- COT-A: fn_anular_venta también libera la cotización de origen (venta_id=NULL)
-- para que pueda reconvertirse. Preserva toda la lógica existente.
CREATE OR REPLACE FUNCTION public.fn_anular_venta(p_venta_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); v_rol text; v_anulada boolean;
  v_item detalle_venta%rowtype; v_sede_id text; v_origen text; v_orden_id uuid;
  v_obs text; v_stock_ant integer; v_stock_post integer;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select get_my_rol() into v_rol;
  if v_rol is distinct from 'Admin' then raise exception 'Solo el administrador puede anular ventas'; end if;
  select anulada, sede_id, origen, orden_id, observaciones
    into v_anulada, v_sede_id, v_origen, v_orden_id, v_obs
  from ventas where id = p_venta_id;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v_anulada then raise exception 'La venta ya fue anulada anteriormente'; end if;
  if v_obs is not null and v_obs like 'Cambio por venta #%' then
    raise exception 'Esta venta es la diferencia de un cambio de producto; no se puede anular directamente.';
  end if;
  perform set_config('cdv.anulando_venta', 'on', true);
  update ventas set anulada=true, anulada_por=v_uid, anulada_en=now(), motivo_anulacion=v_motivo
   where id = p_venta_id;
  update pagos_cuenta set anulado=true, anulado_por=v_uid, anulado_en=now(),
         motivo_anulacion=coalesce(v_motivo,'Venta anulada')
   where venta_id = p_venta_id and coalesce(anulado,false)=false;
  -- COT-A: liberar cotización vinculada para que pueda reconvertirse
  update cotizaciones set venta_id = null, updated_at = now()
   where venta_id = p_venta_id;
  if v_origen = 'ot' then
    update abonos set venta_id = null where venta_id = p_venta_id;
    update ordenes_servicio set venta_id = null, estado = 'terminada', fecha_entrega = null
     where id = v_orden_id;
    update garantias_venta
       set estado = 'abierta', fecha_cierre = null, cerrado_por = null
     where ot_reparacion_id = v_orden_id and estado = 'cerrada';
    perform set_config('cdv.anulando_venta', 'off', true);
    return;
  end if;
  perform set_config('cdv.anulando_venta', 'off', true);
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
