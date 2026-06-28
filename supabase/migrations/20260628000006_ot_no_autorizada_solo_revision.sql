-- ============================================================================
-- Fix (cadena del Reporte 1 — OT no autorizada): el TOTAL y la VENTA de una OT
-- "no_autorizado" deben ser SOLO la revisión / diagnóstico.
--
-- Contexto: el front ya permite cerrar una OT no autorizada sin descargar
-- repuestos (se descarta el borrador sin tocar inventario). Pero el total de la
-- OT se calculaba como mano_obra + repuestos + revisión, así que una OT que
-- cotizó repuestos y luego NO fue autorizada quedaba con un total inflado y la
-- entrega exigía cobrar repuestos que nunca se usaron. (Antes este caso no se
-- podía cerrar, por eso nunca se había manifestado.)
--
-- Solución (no destructiva: NO borra la cotización, solo cambia el cobro):
--   1) trg_orden_recalcular_total_mo: si estado_autorizacion='no_autorizado',
--      total = valor_revision * (1 + iva/100). Recalcula también cuando cambia
--      estado_autorizacion.
--   2) fn_generar_venta_ot: si la OT no fue autorizada, la venta de entrega lleva
--      una sola línea de servicio = valor_revision (sin repuestos ni mano de obra)
--      y sin descuento, de modo que el total recalculado por trg_recalcular_total_venta
--      sea exactamente la revisión.
--   3) Re-sincroniza las OT no autorizadas NO entregadas que quedaron desfasadas.
-- ============================================================================

-- 1) Total de la OT --------------------------------------------------------------
create or replace function public.trg_orden_recalcular_total_mo()
returns trigger language plpgsql set search_path to 'public','pg_temp'
as $$
declare v_det_rep numeric;
begin
  -- Guardia: no permitir modificar campos clave de una orden entregada.
  if TG_OP = 'UPDATE' and OLD.estado = 'entregada' and NEW.estado = 'entregada' then
    if NEW.costo_mano_obra   is distinct from OLD.costo_mano_obra
       or NEW.cliente_nombre is distinct from OLD.cliente_nombre
       or NEW.cliente_telefono is distinct from OLD.cliente_telefono
       or NEW.equipo_descripcion is distinct from OLD.equipo_descripcion
       or NEW.diagnostico   is distinct from OLD.diagnostico
       or NEW.trabajo_realizado is distinct from OLD.trabajo_realizado then
      raise exception 'No se puede modificar una orden entregada';
    end if;
  end if;

  -- BLINDAJE: si ya hay repuestos descargados, valor_repuestos deriva del detalle.
  if TG_OP = 'UPDATE' then
    select coalesce(sum(subtotal),0) into v_det_rep
      from detalle_orden where orden_id = NEW.id;
    if v_det_rep > 0 and NEW.valor_repuestos is distinct from v_det_rep then
      NEW.valor_repuestos := v_det_rep;
    end if;
  end if;

  if TG_OP = 'INSERT'
     or NEW.costo_mano_obra is distinct from OLD.costo_mano_obra
     or NEW.valor_repuestos is distinct from OLD.valor_repuestos
     or NEW.valor_revision is distinct from OLD.valor_revision
     or NEW.iva_pct        is distinct from OLD.iva_pct
     or NEW.descuento_valor is distinct from OLD.descuento_valor
     or NEW.estado_autorizacion is distinct from OLD.estado_autorizacion then
    if NEW.estado_autorizacion = 'no_autorizado' then
      -- Cliente no autorizó: el total es SOLO la revisión / diagnóstico.
      NEW.total := round(coalesce(NEW.valor_revision,0) * (1 + coalesce(NEW.iva_pct,0)/100), 2);
    else
      NEW.total := round((coalesce(NEW.costo_mano_obra,0) + coalesce(NEW.valor_repuestos,0)
                          + coalesce(NEW.valor_revision,0) - coalesce(NEW.descuento_valor,0))
                         * (1 + coalesce(NEW.iva_pct,0)/100), 2);
    end if;
  end if;
  return NEW;
end $$;

-- 2) Venta de entrega ------------------------------------------------------------
create or replace function public.fn_generar_venta_ot(p_orden_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_uid uuid := auth.uid(); v_rol text; v_o ordenes_servicio; v_venta_id uuid;
        v_abonado numeric; v_det record; v_base numeric; v_mo numeric; v_serv_id bigint;
        v_no_aut boolean;
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

  v_no_aut := v_o.estado_autorizacion = 'no_autorizado';

  if v_no_aut then
    -- No autorizada: la venta es solo la revisión, sin repuestos, mano ni descuento.
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

  -- Repuestos descargados (no hay ninguno si la OT no fue autorizada).
  if not v_no_aut then
    for v_det in select * from detalle_orden where orden_id = p_orden_id loop
      insert into detalle_venta (venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal)
      values (v_venta_id, v_det.producto_id, v_det.cantidad, v_det.precio_unitario, v_det.costo_unitario, v_det.subtotal);
    end loop;
  end if;

  -- Línea de servicio: solo revisión (no autorizada) o mano de obra + revisión.
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

-- 3) Re-sincronizar OT no autorizadas NO entregadas con total desfasado -----------
update ordenes_servicio
set total = round(coalesce(valor_revision,0) * (1 + coalesce(iva_pct,0)/100), 2)
where estado_autorizacion = 'no_autorizado'
  and estado not in ('entregada','cancelada')
  and total is distinct from round(coalesce(valor_revision,0) * (1 + coalesce(iva_pct,0)/100), 2);
