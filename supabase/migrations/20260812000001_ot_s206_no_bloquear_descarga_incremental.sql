-- =====================================================================
-- Fix: la guarda S2-06 ("el total no puede quedar por debajo de lo ya
-- abonado") bloqueaba la DESCARGA de repuestos.
--
-- Causa: la descarga inserta los repuestos en detalle_orden UNO POR UNO
-- (OrdenDetalle.descargar). Cada insert dispara trg_orden_recalcular_totales,
-- que fija valor_repuestos = suma del detalle cargado HASTA ESE MOMENTO y
-- recalcula el total. Con el primer repuesto, el total cae del estimado a un
-- estado intermedio por debajo del abono y S2-06 lo bloquea — aunque al
-- terminar de cargar todos los repuestos el total superaría el abono.
-- (Reproducido en OT 185: al bajar valor_repuestos a 25.000 el total daba
--  103.000 < 110.000 abonados y saltaba el error exacto reportado.)
--
-- Arreglo:
--   1) trg_orden_recalcular_totales marca la señal cdv.recalc_detalle mientras
--      recalcula por la descarga; S2-06 se salta en ese caso.
--   2) S2-06 sigue vigente para ediciones MANUALES de montos (bajar la mano de
--      obra / repuestos por debajo del abono sigue bloqueado).
--   3) El tope real se valida al CERRAR la OT (fn_generar_venta_ot): si el total
--      final quedó por debajo de lo abonado (sobrepago del cliente), se bloquea
--      ahí con mensaje claro. Antes el cierre solo miraba el caso contrario
--      (saldo pendiente), nunca el sobrepago.
-- =====================================================================

-- (1) Recalc por descarga: marca la señal antes de tocar la OT.
CREATE OR REPLACE FUNCTION public.trg_orden_recalcular_totales()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_orden_id uuid; v_val numeric; v_cost numeric;
begin
  v_orden_id := coalesce(NEW.orden_id, OLD.orden_id);
  select coalesce(sum(subtotal),0), coalesce(sum(costo_unitario*cantidad),0)
    into v_val, v_cost from detalle_orden where orden_id = v_orden_id;
  -- Señal: este recálculo viene de la descarga incremental de repuestos, no de
  -- un cambio manual de montos. S2-06 (total >= abonos) NO debe dispararse aquí:
  -- mientras se cargan los repuestos uno por uno el total pasa por estados
  -- intermedios por debajo del abono. El tope real se valida al cerrar la OT.
  perform set_config('cdv.recalc_detalle', '1', true);
  update ordenes_servicio o set
    valor_repuestos = v_val,
    costo_repuestos = v_cost,
    total = round(greatest(0,
              o.costo_mano_obra + v_val + coalesce(o.valor_revision,0)
              - least(greatest(coalesce(o.descuento_valor,0),0),
                      o.costo_mano_obra + v_val + coalesce(o.valor_revision,0)))
            * (1 + coalesce(o.iva_pct,0)/100), 0),
    updated_at = now()
   where o.id = v_orden_id;
  perform set_config('cdv.recalc_detalle', '', true);
  return null;
end $function$;

-- (2) La guarda S2-06 respeta la señal: se salta durante la descarga, sigue
--     vigente para ediciones manuales de montos.
CREATE OR REPLACE FUNCTION public.trg_orden_recalcular_total_mo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_det_rep numeric; v_base numeric; v_desc numeric; v_abonado numeric; v_anulando boolean;
begin
  v_anulando := coalesce(current_setting('cdv.anulando_venta', true), 'off') = 'on';
  if TG_OP = 'UPDATE' and OLD.estado in ('entregada','cancelada') and not v_anulando then
    if NEW.costo_mano_obra is distinct from OLD.costo_mano_obra
       or NEW.valor_repuestos is distinct from OLD.valor_repuestos
       or NEW.valor_revision is distinct from OLD.valor_revision
       or NEW.iva_pct is distinct from OLD.iva_pct
       or NEW.descuento_valor is distinct from OLD.descuento_valor
       or NEW.estado_autorizacion is distinct from OLD.estado_autorizacion
       or NEW.cliente_nombre is distinct from OLD.cliente_nombre
       or NEW.cliente_telefono is distinct from OLD.cliente_telefono
       or NEW.equipo_descripcion is distinct from OLD.equipo_descripcion
       or NEW.diagnostico is distinct from OLD.diagnostico
       or NEW.trabajo_realizado is distinct from OLD.trabajo_realizado then
      raise exception 'La OT % está % y no admite cambios', OLD.numero, OLD.estado;
    end if;
  end if;
  if TG_OP = 'UPDATE' then
    select coalesce(sum(subtotal),0) into v_det_rep from detalle_orden where orden_id = NEW.id;
    if v_det_rep > 0 and NEW.valor_repuestos is distinct from v_det_rep then
      NEW.valor_repuestos := v_det_rep;
    end if;
  end if;
  if NEW.estado_autorizacion = 'no_autorizado'
     and (TG_OP = 'INSERT' or OLD.estado_autorizacion is distinct from NEW.estado_autorizacion)
     and exists (select 1 from detalle_orden where orden_id = NEW.id) then
    raise exception 'Esta OT tiene repuestos cargados. Quítalos antes de marcarla como no autorizada (el cliente no autorizó la reparación).';
  end if;
  if TG_OP = 'INSERT'
     or NEW.costo_mano_obra is distinct from OLD.costo_mano_obra
     or NEW.valor_repuestos is distinct from OLD.valor_repuestos
     or NEW.valor_revision is distinct from OLD.valor_revision
     or NEW.iva_pct is distinct from OLD.iva_pct
     or NEW.descuento_valor is distinct from OLD.descuento_valor
     or NEW.estado_autorizacion is distinct from OLD.estado_autorizacion then
    if NEW.estado_autorizacion = 'no_autorizado' then
      NEW.costo_mano_obra := 0; NEW.valor_repuestos := 0;
      v_base := coalesce(NEW.valor_revision,0);
      NEW.total := round(greatest(0, v_base) * (1 + coalesce(NEW.iva_pct,0)/100), 0);
    else
      v_base := coalesce(NEW.costo_mano_obra,0) + coalesce(NEW.valor_repuestos,0) + coalesce(NEW.valor_revision,0);
      v_desc := least(greatest(coalesce(NEW.descuento_valor,0), 0), v_base);
      if v_desc is distinct from NEW.descuento_valor then NEW.descuento_valor := v_desc; end if;
      NEW.total := round(greatest(0, v_base - v_desc) * (1 + coalesce(NEW.iva_pct,0)/100), 0);
    end if;
    -- S2-06: el total no puede quedar por debajo de lo ya abonado. Se SALTA
    -- cuando el recálculo viene de la descarga de repuestos (cdv.recalc_detalle):
    -- ahí los estados intermedios por debajo del abono son normales y el tope se
    -- valida al cerrar la OT. Sigue vigente para ediciones manuales de montos.
    if not v_anulando
       and NEW.estado is distinct from 'cancelada'
       and coalesce(current_setting('cdv.recalc_detalle', true), '') <> '1' then
      select coalesce(sum(monto),0) into v_abonado from abonos where orden_id = NEW.id;
      if v_abonado > 0 and NEW.total < v_abonado then
        raise exception 'No puedes dejar el total ($%) por debajo de lo ya abonado ($%). Ajusta los abonos primero.',
          to_char(NEW.total,'FM999G999G999G990'), to_char(v_abonado,'FM999G999G999G990');
      end if;
    end if;
  end if;
  return NEW;
end $function$;

-- (3) El cierre valida el sobrepago (total final por debajo de lo abonado).
CREATE OR REPLACE FUNCTION public.fn_generar_venta_ot(p_orden_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- Sobrepago: el total final quedó por debajo de lo ya abonado (antes lo
  -- bloqueaba S2-06 en cada repuesto; ahora la validación real vive aquí). No se
  -- cierra con saldo a favor silencioso: hay que ajustar/reembolsar los abonos.
  if v_abonado > v_o.total + 0.01 then
    raise exception 'No puedes cerrar la OT #%: el total ($%) quedó por debajo de lo ya abonado ($%). El cliente pagó de más; ajusta los abonos (o reembolsa la diferencia) primero.',
      v_o.numero, to_char(v_o.total,'FM999G999G999G990'), to_char(v_abonado,'FM999G999G999G990');
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
  perform set_config('cdv.entregando_ot', 'on', true);
  update ordenes_servicio set venta_id = v_venta_id, estado = 'entregada', fecha_entrega = now()
   where id = p_orden_id;
  perform set_config('cdv.entregando_ot', 'off', true);
  return jsonb_build_object('venta_id', v_venta_id, 'total', v_o.total);
end $function$;