-- Venta de OT: método "Varios" → "Abonos OT" — 2026-07-05
--
-- Reporte de la clienta: al entregar una OT, la venta generada aparecía con
-- método de pago "Varios" y creía que era un error suyo o del sistema.
-- No hay bug de dinero: la venta origen='ot' es solo el documento fiscal
-- (el dinero real entra por los abonos, y el cierre la excluye a propósito
-- para no contar doble). Pero la etiqueta "Varios" confunde.
--
-- FIX: la venta de OT queda con metodo_pago = 'Abonos OT' (el pago real está
-- en los abonos de la orden). Sin impacto en cierres: esas ventas se excluyen
-- por origen='ot', no por método. El front pinta métodos desconocidos con el
-- estilo neutro (metodoPagoClass → 'mixto'), así que no rompe nada visual.

-- 1) fn_generar_venta_ot: solo cambia el literal del método.
--    (Definición vigente en prod; único cambio: 'Varios' → 'Abonos OT'.)
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
          coalesce(v_o.iva_pct,0), v_o.total, 'Abonos OT', 'Venta generada de OT #'||v_o.numero, 'ot', p_orden_id)
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

-- 2) Backfill: las 11 ventas de OT existentes con 'Varios' pasan a 'Abonos OT'.
--    (El guard de ventas solo protege 'anulada'; metodo_pago es actualizable.)
update ventas set metodo_pago = 'Abonos OT'
 where origen = 'ot' and metodo_pago = 'Varios';
