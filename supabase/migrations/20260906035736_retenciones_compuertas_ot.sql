-- Tres compuertas de la OT miden contra el total facturado. Con retencion, lo
-- cobrable es el NETO: total - retenciones_total. Sin este cambio una OT con
-- retencion NO SE PUEDE ENTREGAR nunca, porque el cliente abona menos de lo que
-- dice la factura y las tres la dan por impaga. Comprobado antes de aplicar:
-- "Saldo pendiente: total 1190000 vs abonado 1150000".
--
-- OJO con el orden en trg_orden_recalcular_total_mo: es un trigger BEFORE, y las
-- columnas generadas se calculan DESPUES de los BEFORE. NEW.retenciones_total
-- todavia no vale nada ahi, asi que hay que recalcularla en linea con las mismas
-- funciones inmutables.

-- Compuerta 1: tope de los abonos ----------------------------------------
CREATE OR REPLACE FUNCTION public.trg_abono_validar_tope()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_total     numeric;
  v_acumulado numeric;
begin
  if NEW.monto is null or NEW.monto <= 0 then
    raise exception 'El monto del abono debe ser mayor que 0';
  end if;
  if TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and NEW.monto > OLD.monto) then
    -- Pesos enteros: el tope se mide contra el total redondeado, consistente
    -- con el frontend (Math.round) y con el input, que solo admite dígitos.
    -- Así el saldo siempre se puede saldar exactamente.
    --
    -- El tope es lo COBRABLE, no lo facturado: si al cliente le retienen, va a
    -- abonar el neto y nunca va a llegar al total.
    select round(coalesce(total, 0), 0) - round(coalesce(retenciones_total, 0), 0)
      into v_total
      from ordenes_servicio where id = NEW.orden_id;
    -- Con la OT aún sin cotizar (total = 0) no hay techo contra el que medir:
    -- se acepta el anticipo, como antes del 2026-07-24. En cuanto la OT tenga
    -- valor, el tope vuelve a aplicarse y un acumulado que se pase se rechaza.
    if v_total > 0 then
      select coalesce(sum(monto), 0) into v_acumulado
        from abonos where orden_id = NEW.orden_id and id <> coalesce(NEW.id, -1);
      if v_acumulado + NEW.monto > v_total + 0.01 then
        raise exception 'El abono haría que el acumulado (%) supere el total cobrable de la OT (%). Registra a lo sumo el saldo pendiente (%).',
          v_acumulado + NEW.monto, v_total, greatest(v_total - v_acumulado, 0);
      end if;
    end if;
  end if;
  return NEW;
end;
$function$;

-- Compuerta 2: la entrega de la OT ---------------------------------------
CREATE OR REPLACE FUNCTION public.fn_generar_venta_ot(p_orden_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_rol text; v_o ordenes_servicio; v_venta_id uuid;
        v_abonado numeric; v_det record; v_base numeric; v_mo numeric; v_serv_id bigint;
        v_no_aut boolean; v_cobrable numeric;
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
  -- Lo que el cliente tiene que abonar es el NETO. La retencion no la paga el:
  -- la consigna a la DIAN o al municipio a nombre de la empresa.
  v_cobrable := v_o.total - coalesce(v_o.retenciones_total, 0);
  if v_abonado + 0.01 < v_cobrable then
    raise exception 'Saldo pendiente: cobrable % (total % menos retenciones %) vs abonado %',
      v_cobrable, v_o.total, coalesce(v_o.retenciones_total,0), v_abonado;
  end if;
  if v_abonado > v_cobrable + 0.01 then
    raise exception 'No puedes cerrar la OT #%: lo cobrable ($%) quedó por debajo de lo ya abonado ($%). El cliente pagó de más; ajusta los abonos (o reembolsa la diferencia) primero.',
      v_o.numero, to_char(v_cobrable,'FM999G999G999G990'), to_char(v_abonado,'FM999G999G999G990');
  end if;
  v_no_aut := v_o.estado_autorizacion = 'no_autorizado';
  if v_no_aut then
    v_base := coalesce(v_o.valor_revision,0);
  else
    v_base := coalesce(v_o.costo_mano_obra,0) + coalesce(v_o.valor_repuestos,0) + coalesce(v_o.valor_revision,0);
  end if;
  -- Las tarifas de retencion se COPIAN a la venta que genera la OT para que el
  -- documento final las lleve impresas. No se cuentan dos veces: el cierre
  -- excluye origen='ot' de todos los caminos de venta y cuenta los abonos, que
  -- ya vienen netos.
  insert into ventas (sede_id, vendedor_id, cliente_nombre, cliente_id, subtotal, descuento_valor,
                      iva_pct, total, metodo_pago, observaciones, origen, orden_id,
                      retefuente_pct, reteica_pct, reteiva_pct)
  values (v_o.sede_id, v_uid, v_o.cliente_nombre, v_o.cliente_id, v_base,
          case when v_no_aut then 0 else coalesce(v_o.descuento_valor,0) end,
          coalesce(v_o.iva_pct,0), v_o.total, 'Abonos OT', 'Venta generada de OT #'||v_o.numero, 'ot', p_orden_id,
          coalesce(v_o.retefuente_pct,0), coalesce(v_o.reteica_pct,0), coalesce(v_o.reteiva_pct,0))
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
  return jsonb_build_object('venta_id', v_venta_id, 'total', v_o.total,
                            'retenciones', coalesce(v_o.retenciones_total,0),
                            'cobrable', v_cobrable);
end $function$;

-- Compuerta 3: no dejar el total por debajo de lo abonado ------------------
CREATE OR REPLACE FUNCTION public.trg_orden_recalcular_total_mo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_det_rep numeric; v_base numeric; v_desc numeric; v_abonado numeric; v_anulando boolean;
        v_ret numeric; v_base_ret numeric;
begin
  v_anulando := coalesce(current_setting('cdv.anulando_venta', true), 'off') = 'on';
  if TG_OP = 'UPDATE' and OLD.estado in ('entregada','cancelada') and not v_anulando then
    if NEW.costo_mano_obra is distinct from OLD.costo_mano_obra
       or NEW.valor_repuestos is distinct from OLD.valor_repuestos
       or NEW.valor_revision is distinct from OLD.valor_revision
       or NEW.iva_pct is distinct from OLD.iva_pct
       or NEW.descuento_valor is distinct from OLD.descuento_valor
       or NEW.estado_autorizacion is distinct from OLD.estado_autorizacion
       or NEW.retefuente_pct is distinct from OLD.retefuente_pct
       or NEW.reteica_pct is distinct from OLD.reteica_pct
       or NEW.reteiva_pct is distinct from OLD.reteiva_pct
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
     or NEW.estado_autorizacion is distinct from OLD.estado_autorizacion
     or NEW.retefuente_pct is distinct from OLD.retefuente_pct
     or NEW.reteica_pct is distinct from OLD.reteica_pct
     or NEW.reteiva_pct is distinct from OLD.reteiva_pct then
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
    if not v_anulando
       and NEW.estado is distinct from 'cancelada'
       and coalesce(current_setting('cdv.recalc_detalle', true), '') <> '1' then
      select coalesce(sum(monto),0) into v_abonado from abonos where orden_id = NEW.id;
      -- NEW.retenciones_total todavia no existe: es GENERATED y se calcula
      -- DESPUES de los triggers BEFORE. Se recalcula aqui con las mismas
      -- funciones inmutables que usa la columna, para no discrepar nunca.
      v_base_ret := public._fn_base_retencion_ot(NEW.estado_autorizacion, NEW.costo_mano_obra,
                      NEW.valor_repuestos, NEW.valor_revision, NEW.descuento_valor);
      v_ret := round(v_base_ret * coalesce(NEW.retefuente_pct,0) / 100)
             + round(v_base_ret * coalesce(NEW.reteica_pct,0) / 100)
             + round(round(v_base_ret * coalesce(NEW.iva_pct,0) / 100) * coalesce(NEW.reteiva_pct,0) / 100);
      if v_abonado > 0 and (NEW.total - v_ret) < v_abonado then
        raise exception 'No puedes dejar lo cobrable ($%) por debajo de lo ya abonado ($%). Ajusta los abonos primero.',
          to_char(NEW.total - v_ret,'FM999G999G999G990'), to_char(v_abonado,'FM999G999G999G990');
      end if;
    end if;
  end if;
  return NEW;
end $function$;
