-- ============================================================================
-- Rediseño OT — Opción A — FASE 4: Generar la venta en la recogida.
-- - trg_venta_descontar_stock: NO descuenta stock cuando la venta es origen='ot'
--   (el stock ya salió en la descarga de la OT).
-- - fn_generar_venta_ot: crea UNA venta (origen='ot') a precio, con IVA/descuento
--   de la OT, líneas de repuesto + línea de servicio (mano de obra + revisión),
--   concilia los anticipos y deja la OT entregada. Idempotente.
-- ============================================================================

create or replace function public.trg_venta_descontar_stock()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_inv record; v_venta record;
begin
  if NEW.producto_id is null then return NEW; end if;
  select sede_id, vendedor_id, origen into v_venta from ventas where id = NEW.venta_id;
  if v_venta.origen = 'ot' then
    return NEW;  -- el stock ya salió por la OT; no descontar de nuevo
  end if;

  select id, cantidad into v_inv from inventario
   where producto_id = NEW.producto_id and sede_id = v_venta.sede_id for update;
  if not found then
    insert into inventario (producto_id, sede_id, cantidad) values (NEW.producto_id, v_venta.sede_id, 0)
      on conflict (producto_id, sede_id) do nothing;
    select id, cantidad into v_inv from inventario
     where producto_id = NEW.producto_id and sede_id = v_venta.sede_id for update;
  end if;
  if coalesce(v_inv.cantidad,0) < NEW.cantidad then
    raise exception 'Stock insuficiente en sede % (disp %, req %)',
      v_venta.sede_id, coalesce(v_inv.cantidad,0), NEW.cantidad;
  end if;
  update inventario set cantidad = cantidad - NEW.cantidad, ultimo_movimiento = now(), updated_at = now()
   where id = v_inv.id;
  insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
                          referencia_id, referencia_tipo, usuario_id)
  values ('venta', NEW.producto_id, v_venta.sede_id, -NEW.cantidad,
          v_inv.cantidad, v_inv.cantidad - NEW.cantidad, NEW.venta_id, 'venta', v_venta.vendedor_id);
  perform fn_actualizar_estado_stock(NEW.producto_id, v_venta.sede_id);
  return NEW;
end $$;

create or replace function public.fn_generar_venta_ot(p_orden_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_uid uuid := auth.uid(); v_rol text; v_o ordenes_servicio; v_venta_id uuid;
        v_abonado numeric; v_det record; v_base numeric;
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

  for v_det in select * from detalle_orden where orden_id = p_orden_id loop
    insert into detalle_venta (venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal)
    values (v_venta_id, v_det.producto_id, v_det.cantidad, v_det.precio_unitario, v_det.costo_unitario, v_det.subtotal);
  end loop;

  if coalesce(v_o.costo_mano_obra,0) + coalesce(v_o.valor_revision,0) > 0 then
    insert into detalle_venta (venta_id, producto_id, descripcion, cantidad, precio_unitario, subtotal)
    values (v_venta_id, null, 'Mano de obra / revisión OT #'||v_o.numero, 1,
            coalesce(v_o.costo_mano_obra,0)+coalesce(v_o.valor_revision,0),
            coalesce(v_o.costo_mano_obra,0)+coalesce(v_o.valor_revision,0));
  end if;

  update abonos set venta_id = v_venta_id where orden_id = p_orden_id;
  update ordenes_servicio set venta_id = v_venta_id, estado = 'entregada', fecha_entrega = now()
   where id = p_orden_id;

  return jsonb_build_object('venta_id', v_venta_id, 'total', v_o.total);
end $$;

revoke execute on function public.fn_generar_venta_ot(uuid) from public, anon;
grant execute on function public.fn_generar_venta_ot(uuid) to authenticated;
