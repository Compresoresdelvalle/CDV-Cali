-- ============================================================================
-- Reporte clienta (#4): simplificar el rol de los TÉCNICOS en Órdenes de Trabajo.
-- Los técnicos quedan disponibles para ser ASIGNADOS a una OT (lo hace Ventas) y
-- pueden VER sus OT, pero NO ejecutan el flujo (recepción, diagnóstico, cotización,
-- autorización, descarga, entrega/facturación). Todo eso es de Ventas/Admin.
--
-- Defensa en profundidad (el frontend ya pone la OT en solo-lectura para técnicos):
--   1) os_insert: crear OT solo Admin/Vendedor (antes incluía Tecnico).
--   2) os_update: operar/avanzar la OT solo Admin/Vendedor (antes: cualquiera de la sede).
--   3) fn_generar_venta_ot: facturar/entregar solo Admin/Vendedor.
-- SELECT sigue abierto (los técnicos ven sus OT asignadas en solo-lectura).
-- ============================================================================

-- 1) Crear OT: solo Admin/Vendedor
drop policy if exists os_insert on public.ordenes_servicio;
create policy os_insert on public.ordenes_servicio
  for insert
  with check (
    (select get_my_rol()) in ('Admin','Vendedor')
    and ((select get_my_rol()) = 'Admin' or sede_id = (select get_my_sede_id()))
  );

-- 2) Operar/avanzar OT: solo Admin/Vendedor (y no entregadas)
drop policy if exists os_update on public.ordenes_servicio;
create policy os_update on public.ordenes_servicio
  for update
  using (
    estado <> 'entregada'::estado_orden
    and (select get_my_rol()) in ('Admin','Vendedor')
    and ((select get_my_rol()) = 'Admin' or sede_id = (select get_my_sede_id()))
  )
  with check (
    (select get_my_rol()) in ('Admin','Vendedor')
    and ((select get_my_rol()) = 'Admin' or sede_id = (select get_my_sede_id()))
  );

-- 3) Facturar/entregar OT: solo Admin/Vendedor (rol-check explícito en la función)
create or replace function public.fn_generar_venta_ot(p_orden_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_uid uuid := auth.uid(); v_rol text; v_o ordenes_servicio; v_venta_id uuid;
        v_abonado numeric; v_det record; v_base numeric; v_mo numeric; v_serv_id bigint;
        v_no_aut boolean;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select get_my_rol() into v_rol;
  if v_rol not in ('Admin','Vendedor') then
    raise exception 'Solo Ventas o Administración pueden facturar y entregar una OT';
  end if;
  select * into v_o from ordenes_servicio where id = p_orden_id for update;
  if not found then raise exception 'OT no encontrada'; end if;
  if v_rol <> 'Admin' and v_o.sede_id <> get_my_sede_id() then
    raise exception 'Sin permiso sobre esta OT';
  end if;
  if v_o.venta_id is not null then raise exception 'La OT ya tiene venta generada'; end if;
  if v_o.estado <> 'terminada' then raise exception 'La OT debe estar TERMINADA para entregar'; end if;

  select coalesce(sum(monto),0) into v_abonado from abonos where orden_id = p_orden_id;
  if v_abonado + 0.01 < v_o.total then
    raise exception 'Saldo pendiente: total % vs abonado %', v_o.total, v_abonado;
  end if;

  v_no_aut := v_o.estado_autorizacion = 'no_autorizado';

  if v_no_aut then
    v_base := coalesce(v_o.valor_revision,0);
  else
    v_base := coalesce(v_o.costo_mano_obra,0) + coalesce(v_o.valor_repuestos,0) + coalesce(v_o.valor_revision,0);
  end if;

  insert into ventas (sede_id, vendedor_id, cliente_nombre, cliente_id, subtotal, descuento_valor,
                      iva_pct, total, metodo_pago, observaciones, origen, orden_id)
  values (v_o.sede_id, v_uid, v_o.cliente_nombre, v_o.cliente_id, v_base,
          case when v_no_aut then 0 else coalesce(v_o.descuento_valor,0) end,
          coalesce(v_o.iva_pct,0), v_o.total, 'Varios', 'Venta generada de OT #'||v_o.numero, 'ot', p_orden_id)
  returning id into v_venta_id;

  if not v_no_aut then
    for v_det in select * from detalle_orden where orden_id = p_orden_id loop
      insert into detalle_venta (venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal)
      values (v_venta_id, v_det.producto_id, v_det.cantidad, v_det.precio_unitario, v_det.costo_unitario, v_det.subtotal);
    end loop;
  end if;

  v_mo := case when v_no_aut then coalesce(v_o.valor_revision,0)
               else coalesce(v_o.costo_mano_obra,0) + coalesce(v_o.valor_revision,0) end;
  if v_mo > 0 then
    select id into v_serv_id from servicios where nombre = 'Mano de obra / revisión (OT)' limit 1;
    if v_serv_id is null then
      insert into servicios (nombre, precio, iva_pct, activo)
      values ('Mano de obra / revisión (OT)', 0, 0, true)
      returning id into v_serv_id;
    end if;
    insert into detalle_venta (venta_id, servicio_id, descripcion, cantidad, precio_unitario, subtotal)
    values (v_venta_id, v_serv_id,
            case when v_no_aut then 'Revisión / diagnóstico OT #'||v_o.numero
                 else 'Mano de obra / revisión OT #'||v_o.numero end,
            1, v_mo, v_mo);
  end if;

  update abonos set venta_id = v_venta_id where orden_id = p_orden_id;
  update ordenes_servicio set venta_id = v_venta_id, estado = 'entregada', fecha_entrega = now()
   where id = p_orden_id;

  return jsonb_build_object('venta_id', v_venta_id, 'total', v_o.total);
end $function$;
