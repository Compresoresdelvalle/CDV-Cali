-- ============================================================================
-- Rediseño OT — Opción A — FIX: la venta-OT fallaba con mano de obra.
-- detalle_venta exige producto_id XOR servicio_id. La línea de "mano de obra /
-- revisión" no tenía ninguno → violaba el constraint. Ahora usa un servicio
-- genérico "Mano de obra / revisión (OT)" (find-or-create) con precio override.
-- ============================================================================

create or replace function public.fn_generar_venta_ot(p_orden_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_uid uuid := auth.uid(); v_rol text; v_o ordenes_servicio; v_venta_id uuid;
        v_abonado numeric; v_det record; v_base numeric; v_mo numeric; v_serv_id bigint;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select get_my_rol() into v_rol;
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

  v_base := coalesce(v_o.costo_mano_obra,0) + coalesce(v_o.valor_repuestos,0) + coalesce(v_o.valor_revision,0);

  insert into ventas (sede_id, vendedor_id, cliente_nombre, cliente_id, subtotal, descuento_valor,
                      iva_pct, total, metodo_pago, observaciones, origen, orden_id)
  values (v_o.sede_id, v_uid, v_o.cliente_nombre, v_o.cliente_id, v_base, coalesce(v_o.descuento_valor,0),
          coalesce(v_o.iva_pct,0), v_o.total, 'Varios', 'Venta generada de OT #'||v_o.numero, 'ot', p_orden_id)
  returning id into v_venta_id;

  -- Líneas de repuestos (a precio). No descuentan stock (blindaje origen='ot').
  for v_det in select * from detalle_orden where orden_id = p_orden_id loop
    insert into detalle_venta (venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal)
    values (v_venta_id, v_det.producto_id, v_det.cantidad, v_det.precio_unitario, v_det.costo_unitario, v_det.subtotal);
  end loop;

  -- Línea de mano de obra + revisión, como SERVICIO genérico (cumple XOR).
  v_mo := coalesce(v_o.costo_mano_obra,0) + coalesce(v_o.valor_revision,0);
  if v_mo > 0 then
    select id into v_serv_id from servicios where nombre = 'Mano de obra / revisión (OT)' limit 1;
    if v_serv_id is null then
      insert into servicios (nombre, precio, iva_pct, activo)
      values ('Mano de obra / revisión (OT)', 0, 0, true)
      returning id into v_serv_id;
    end if;
    insert into detalle_venta (venta_id, servicio_id, descripcion, cantidad, precio_unitario, subtotal)
    values (v_venta_id, v_serv_id, 'Mano de obra / revisión OT #'||v_o.numero, 1, v_mo, v_mo);
  end if;

  update abonos set venta_id = v_venta_id where orden_id = p_orden_id;
  update ordenes_servicio set venta_id = v_venta_id, estado = 'entregada', fecha_entrega = now()
   where id = p_orden_id;

  return jsonb_build_object('venta_id', v_venta_id, 'total', v_o.total);
end $$;

revoke execute on function public.fn_generar_venta_ot(uuid) from public, anon;
grant execute on function public.fn_generar_venta_ot(uuid) to authenticated;
