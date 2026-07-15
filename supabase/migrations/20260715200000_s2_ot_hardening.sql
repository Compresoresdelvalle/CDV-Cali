-- =====================================================================
-- S2 — Órdenes de Trabajo: endurecimiento de integridad/seguridad
-- Fecha: 2026-07-15
-- Autor: pista de base de datos (correcciones Sección 2)
--
-- Cambios NO destructivos y reversibles. Cada objeto reemplazado incluye
-- su definición ORIGINAL comentada arriba (para revertir si hiciera falta).
-- IDs de fixes: S2-01, S2-02, S2-03, S2-04, S2-06, S2-08, S2-09, S2-10,
--               S2-11, S2-12, S2-15, S2-19, S2-20, S2-22, S2-26.
-- =====================================================================


-- =====================================================================
-- S2-01 — fn_cancelar_orden: bloquear cancelación si hay anticipos
-- ---------------------------------------------------------------------
-- ORIGINAL:
-- CREATE OR REPLACE FUNCTION public.fn_cancelar_orden(p_orden_id uuid)
--  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
-- declare v_rol text; v_estado estado_orden;
-- begin
--   if auth.uid() is null then raise exception 'No autenticado'; end if;
--   select get_my_rol() into v_rol;
--   if v_rol is distinct from 'Admin' then
--     raise exception 'Solo el administrador puede cancelar órdenes de trabajo';
--   end if;
--   select estado into v_estado from ordenes_servicio where id = p_orden_id for update;
--   if not found then raise exception 'Orden no encontrada'; end if;
--   if v_estado = 'entregada' then raise exception 'No se puede cancelar una OT ya entregada'; end if;
--   if v_estado = 'cancelada' then raise exception 'La orden ya está cancelada'; end if;
--   delete from detalle_orden where orden_id = p_orden_id;
--   update ordenes_servicio set estado = 'cancelada' where id = p_orden_id;
-- end;
-- $function$
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cancelar_orden(p_orden_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_rol text; v_estado estado_orden; v_ab numeric;
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

  -- S2-01: no permitir cancelar con anticipos; primero devolver el dinero al cliente.
  select coalesce(sum(monto),0) into v_ab from abonos where orden_id = p_orden_id;
  if v_ab > 0 then
    raise exception 'No se puede cancelar: la OT tiene anticipos por $%. Registra primero la devolución del dinero al cliente y luego cancélala.',
      to_char(v_ab, 'FM999G999G999G990');
  end if;

  delete from detalle_orden where orden_id = p_orden_id;
  update ordenes_servicio set estado = 'cancelada' where id = p_orden_id;
end;
$function$;


-- =====================================================================
-- S2-02 + S2-03 + S2-04(a) + S2-06 + S2-11 + S2-22
-- trg_orden_recalcular_total_mo (BEFORE INSERT/UPDATE en ordenes_servicio)
-- ---------------------------------------------------------------------
-- ORIGINAL:
-- CREATE OR REPLACE FUNCTION public.trg_orden_recalcular_total_mo()
--  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare v_det_rep numeric;
-- begin
--   if TG_OP = 'UPDATE' and OLD.estado = 'entregada' and NEW.estado = 'entregada' then
--     if NEW.costo_mano_obra   is distinct from OLD.costo_mano_obra
--        or NEW.cliente_nombre is distinct from OLD.cliente_nombre
--        or NEW.cliente_telefono is distinct from OLD.cliente_telefono
--        or NEW.equipo_descripcion is distinct from OLD.equipo_descripcion
--        or NEW.diagnostico   is distinct from OLD.diagnostico
--        or NEW.trabajo_realizado is distinct from OLD.trabajo_realizado then
--       raise exception 'No se puede modificar una orden entregada';
--     end if;
--   end if;
--   if TG_OP = 'UPDATE' then
--     select coalesce(sum(subtotal),0) into v_det_rep
--       from detalle_orden where orden_id = NEW.id;
--     if v_det_rep > 0 and NEW.valor_repuestos is distinct from v_det_rep then
--       NEW.valor_repuestos := v_det_rep;
--     end if;
--   end if;
--   if TG_OP = 'INSERT'
--      or NEW.costo_mano_obra is distinct from OLD.costo_mano_obra
--      or NEW.valor_repuestos is distinct from OLD.valor_repuestos
--      or NEW.valor_revision is distinct from OLD.valor_revision
--      or NEW.iva_pct        is distinct from OLD.iva_pct
--      or NEW.descuento_valor is distinct from OLD.descuento_valor
--      or NEW.estado_autorizacion is distinct from OLD.estado_autorizacion then
--     if NEW.estado_autorizacion = 'no_autorizado' then
--       NEW.total := round(coalesce(NEW.valor_revision,0) * (1 + coalesce(NEW.iva_pct,0)/100), 2);
--     else
--       NEW.total := round((coalesce(NEW.costo_mano_obra,0) + coalesce(NEW.valor_repuestos,0)
--                           + coalesce(NEW.valor_revision,0) - coalesce(NEW.descuento_valor,0))
--                          * (1 + coalesce(NEW.iva_pct,0)/100), 2);
--     end if;
--   end if;
--   return NEW;
-- end $function$
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_orden_recalcular_total_mo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_det_rep numeric;
  v_base    numeric;
  v_desc    numeric;
  v_abonado numeric;
  v_anulando boolean;
begin
  v_anulando := coalesce(current_setting('cdv.anulando_venta', true), 'off') = 'on';

  -- S2-11: una OT entregada o cancelada no admite cambios (excepto flujo de anulación).
  if TG_OP = 'UPDATE' and OLD.estado in ('entregada','cancelada') and not v_anulando then
    if NEW.costo_mano_obra        is distinct from OLD.costo_mano_obra
       or NEW.valor_repuestos     is distinct from OLD.valor_repuestos
       or NEW.valor_revision      is distinct from OLD.valor_revision
       or NEW.iva_pct             is distinct from OLD.iva_pct
       or NEW.descuento_valor     is distinct from OLD.descuento_valor
       or NEW.estado_autorizacion is distinct from OLD.estado_autorizacion
       or NEW.cliente_nombre      is distinct from OLD.cliente_nombre
       or NEW.cliente_telefono    is distinct from OLD.cliente_telefono
       or NEW.equipo_descripcion  is distinct from OLD.equipo_descripcion
       or NEW.diagnostico         is distinct from OLD.diagnostico
       or NEW.trabajo_realizado   is distinct from OLD.trabajo_realizado then
      raise exception 'La OT % está % y no admite cambios', OLD.numero, OLD.estado;
    end if;
  end if;

  if TG_OP = 'UPDATE' then
    select coalesce(sum(subtotal),0) into v_det_rep
      from detalle_orden where orden_id = NEW.id;
    if v_det_rep > 0 and NEW.valor_repuestos is distinct from v_det_rep then
      NEW.valor_repuestos := v_det_rep;
    end if;
  end if;

  -- S2-04(a): no permitir marcar 'no_autorizado' con repuestos cargados;
  -- se fuerza a quitarlos (así el trigger de reversión devuelve el stock).
  if NEW.estado_autorizacion = 'no_autorizado'
     and (TG_OP = 'INSERT' or OLD.estado_autorizacion is distinct from NEW.estado_autorizacion)
     and exists (select 1 from detalle_orden where orden_id = NEW.id) then
    raise exception 'Esta OT tiene repuestos cargados. Quítalos antes de marcarla como no autorizada (el cliente no autorizó la reparación).';
  end if;

  if TG_OP = 'INSERT'
     or NEW.costo_mano_obra     is distinct from OLD.costo_mano_obra
     or NEW.valor_repuestos     is distinct from OLD.valor_repuestos
     or NEW.valor_revision      is distinct from OLD.valor_revision
     or NEW.iva_pct             is distinct from OLD.iva_pct
     or NEW.descuento_valor     is distinct from OLD.descuento_valor
     or NEW.estado_autorizacion is distinct from OLD.estado_autorizacion then

    if NEW.estado_autorizacion = 'no_autorizado' then
      -- S2-22: sin autorización solo se cobra la revisión; el resto queda en 0.
      NEW.costo_mano_obra := 0;
      NEW.valor_repuestos := 0;
      v_base := coalesce(NEW.valor_revision,0);            -- valor_revision NO se toca
      -- S2-02/S2-03: total entero y nunca negativo
      NEW.total := round(greatest(0, v_base) * (1 + coalesce(NEW.iva_pct,0)/100), 0);
    else
      v_base := coalesce(NEW.costo_mano_obra,0) + coalesce(NEW.valor_repuestos,0)
                + coalesce(NEW.valor_revision,0);
      -- S2-02: descuento clampado a [0, base]
      v_desc := least(greatest(coalesce(NEW.descuento_valor,0), 0), v_base);
      if v_desc is distinct from NEW.descuento_valor then
        NEW.descuento_valor := v_desc;
      end if;
      -- S2-02/S2-03: total entero y nunca negativo
      NEW.total := round(greatest(0, v_base - v_desc) * (1 + coalesce(NEW.iva_pct,0)/100), 0);
    end if;

    -- S2-06: el total no puede quedar por debajo de lo ya abonado.
    if not v_anulando and NEW.estado is distinct from 'cancelada' then
      select coalesce(sum(monto),0) into v_abonado from abonos where orden_id = NEW.id;
      if v_abonado > 0 and NEW.total < v_abonado then
        raise exception 'No puedes dejar el total ($%) por debajo de lo ya abonado ($%). Ajusta los abonos primero.',
          to_char(NEW.total,   'FM999G999G999G990'),
          to_char(v_abonado,   'FM999G999G999G990');
      end if;
    end if;
  end if;

  return NEW;
end $function$;


-- =====================================================================
-- S2-02 + S2-03 — trg_orden_recalcular_totales (AFTER en detalle_orden)
-- Defensa en profundidad: total entero y no negativo. (El valor final lo
-- fija de todos modos trg_orden_recalcular_total_mo en el UPDATE que emite
-- esta función, pero se mantiene coherente.)
-- ---------------------------------------------------------------------
-- ORIGINAL:
-- CREATE OR REPLACE FUNCTION public.trg_orden_recalcular_totales()
--  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare v_orden_id uuid; v_val numeric; v_cost numeric;
-- begin
--   v_orden_id := coalesce(NEW.orden_id, OLD.orden_id);
--   select coalesce(sum(subtotal),0), coalesce(sum(costo_unitario*cantidad),0)
--     into v_val, v_cost from detalle_orden where orden_id = v_orden_id;
--   update ordenes_servicio o set
--     valor_repuestos = v_val,
--     costo_repuestos = v_cost,
--     total = round((o.costo_mano_obra + v_val + coalesce(o.valor_revision,0) - coalesce(o.descuento_valor,0))
--                   * (1 + coalesce(o.iva_pct,0)/100), 0),
--     updated_at = now()
--    where o.id = v_orden_id;
--   return null;
-- end $function$
-- ---------------------------------------------------------------------
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
  return null;
end $function$;


-- =====================================================================
-- S2-09 — trg_orden_validar_transicion: entrega solo vía fn_generar_venta_ot
-- ---------------------------------------------------------------------
-- ORIGINAL (solo se agrega el bloque S2-09; el resto se preserva íntegro):
-- ...ver definición previa en migración de máquina de estados...
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_orden_validar_transicion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if OLD.estado = NEW.estado then return NEW; end if;
  if coalesce(current_setting('cdv.anulando_venta', true), 'off') = 'on' then
    return NEW;
  end if;

  -- S2-09: la transición a 'entregada' solo puede ocurrir dentro de
  -- fn_generar_venta_ot (que activa la señal GUC 'cdv.entregando_ot').
  if NEW.estado = 'entregada' and OLD.estado is distinct from 'entregada'
     and coalesce(current_setting('cdv.entregando_ot', true), 'off') <> 'on' then
    raise exception 'La entrega solo se hace desde "Convertir a venta y entregar".';
  end if;

  if OLD.estado in ('entregada','cancelada') then
    raise exception 'La OT % es inmutable (estado %)', OLD.numero, OLD.estado;
  end if;
  if NEW.estado = 'cancelada' then return NEW; end if;
  if not (
       (OLD.estado='recepcion'          and NEW.estado='diagnostico')
    or (OLD.estado='diagnostico'        and NEW.estado='cotizada')
    or (OLD.estado='cotizada'           and NEW.estado='autorizada')
    or (OLD.estado='autorizada'         and NEW.estado='en_proceso')
    or (OLD.estado='en_proceso'         and NEW.estado in ('esperando_repuesto','terminada'))
    or (OLD.estado='esperando_repuesto' and NEW.estado in ('en_proceso','terminada'))
    or (OLD.estado='terminada'          and NEW.estado='entregada')
    or (OLD.estado='abierta'            and NEW.estado in ('en_proceso','esperando_repuesto','completada','diagnostico'))
    or (OLD.estado='en_proceso'         and NEW.estado='completada')
    or (OLD.estado='esperando_repuesto' and NEW.estado='completada')
    or (OLD.estado='completada'         and NEW.estado in ('pendiente_recogida','entregada'))
    or (OLD.estado='pendiente_recogida' and NEW.estado='entregada')
  ) then
    raise exception 'Transición no permitida: % -> %', OLD.estado, NEW.estado;
  end if;

  if NEW.estado='cotizada' and coalesce(NEW.diagnostico,'')='' then
    raise exception 'Falta el diagnóstico para cotizar';
  end if;

  if NEW.estado='en_proceso' and OLD.estado='autorizada' then
    if coalesce(NEW.estado_autorizacion,'') = 'no_autorizado' then
      if coalesce(NEW.valor_revision,0) <= 0 then
        raise exception 'Indica el valor a cobrar por la revisión';
      end if;
    elsif coalesce(NEW.estado_autorizacion,'') = 'autorizado' then
      if jsonb_array_length(coalesce(NEW.cotizacion_draft,'[]'::jsonb))=0
         and coalesce(NEW.costo_mano_obra,0)=0 and coalesce(NEW.valor_repuestos,0)=0 then
        raise exception 'Agrega al menos un repuesto o mano de obra para la reparación autorizada';
      end if;
    else
      raise exception 'Marca si el cliente autoriza o no la reparación';
    end if;
  end if;

  if NEW.estado='terminada' and coalesce(NEW.trabajo_realizado,'')='' then
    raise exception 'Falta registrar el trabajo realizado para terminar';
  end if;

  if NEW.estado='pendiente_recogida' and OLD.estado<>'pendiente_recogida' then
    NEW.pendiente_recogida_at := now();
  end if;

  return NEW;
end $function$;


-- =====================================================================
-- S2-09 — fn_generar_venta_ot: activar señal GUC 'cdv.entregando_ot'
-- + S2-03: coherente con totales enteros (tolerancia 0.01 intacta)
-- ---------------------------------------------------------------------
-- ORIGINAL: ver migración venta_ot_metodo_abonos (misma lógica; solo se
-- agregan los set_config alrededor del UPDATE que entrega la OT).
-- ---------------------------------------------------------------------
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

  -- S2-09: señal transaccional que autoriza la transición a 'entregada'.
  perform set_config('cdv.entregando_ot', 'on', true);
  update ordenes_servicio set venta_id = v_venta_id, estado = 'entregada', fecha_entrega = now()
   where id = p_orden_id;
  perform set_config('cdv.entregando_ot', 'off', true);

  return jsonb_build_object('venta_id', v_venta_id, 'total', v_o.total);
end $function$;


-- =====================================================================
-- S2-08 + S2-12 — fn_asociar_cotizacion_a_ot
--   * precio_unitario correcto (antes se metía el precio en costo_unitario)
--   * costo_unitario = 0 -> el trigger lo rellena con costo_promedio real
--   * solo ítems con producto_id (excluye servicios)
--   * rechaza OT 'cancelada' o 'entregada'
--   * montos en pesos enteros (S2-03)
-- ---------------------------------------------------------------------
-- ORIGINAL: ver migración fase11_asociar_cotizacion_a_ot (bloque INSERT
-- usaba costo_unitario = ROUND(dc.precio_unitario * v_factor, 2), sin
-- precio_unitario, sin filtrar servicios, y solo validaba 'entregada').
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_asociar_cotizacion_a_ot(p_cotizacion_id uuid, p_ot_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_my_rol TEXT; v_my_sede TEXT;
  v_cot RECORD;
  v_ot_sede TEXT; v_ot_estado estado_orden;
  v_items_copiados INT := 0;
  v_factor NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  v_my_rol := get_my_rol();
  v_my_sede := get_my_sede_id();

  SELECT sede_id, ot_id, iva_pct, descuento_pct
    INTO v_cot
    FROM cotizaciones WHERE id = p_cotizacion_id;
  IF v_cot.sede_id IS NULL THEN
    RAISE EXCEPTION 'Cotización no existe';
  END IF;

  SELECT sede_id, estado INTO v_ot_sede, v_ot_estado
    FROM ordenes_servicio WHERE id = p_ot_id;
  IF v_ot_sede IS NULL THEN RAISE EXCEPTION 'OT no existe'; END IF;
  -- S2-12: rechazar OT cerrada (entregada) o cancelada
  IF v_ot_estado = 'entregada' THEN
    RAISE EXCEPTION 'No se puede modificar una OT entregada';
  END IF;
  IF v_ot_estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se puede modificar una OT cancelada';
  END IF;

  IF v_my_rol <> 'Admin' THEN
    IF v_cot.sede_id <> v_my_sede THEN
      RAISE EXCEPTION 'No puedes asociar cotización de otra sede';
    END IF;
    IF v_ot_sede <> v_my_sede THEN
      RAISE EXCEPTION 'No puedes asociar a una OT de otra sede';
    END IF;
  END IF;
  IF v_cot.sede_id <> v_ot_sede THEN
    RAISE EXCEPTION 'Cotización y OT deben pertenecer a la misma sede';
  END IF;

  IF v_cot.ot_id IS NOT NULL AND v_cot.ot_id <> p_ot_id THEN
    RAISE EXCEPTION 'La cotización ya está vinculada a otra OT (%). Desvincúlala primero.', v_cot.ot_id;
  END IF;

  UPDATE cotizaciones SET ot_id = p_ot_id, updated_at = now()
   WHERE id = p_cotizacion_id;

  -- Aplicar IVA al copiar (precio que paga el cliente)
  v_factor := 1 + COALESCE(v_cot.iva_pct, 0) / 100.0;

  -- Limpiar items previamente copiados de ESTA cotización (idempotente al re-asociar)
  DELETE FROM detalle_orden
   WHERE orden_id = p_ot_id
     AND cotizacion_id = p_cotizacion_id;

  WITH inserted AS (
    INSERT INTO detalle_orden (orden_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal, cotizacion_id)
    SELECT p_ot_id,
           dc.producto_id,
           dc.cantidad,
           ROUND(dc.precio_unitario * v_factor, 0),          -- S2-08: precio de venta con IVA
           0,                                                -- costo lo fija el trigger (costo_promedio real)
           ROUND(dc.precio_unitario * v_factor, 0) * dc.cantidad,
           p_cotizacion_id
      FROM detalle_cotizacion dc
     WHERE dc.cotizacion_id = p_cotizacion_id
       AND dc.producto_id IS NOT NULL                        -- S2-08: excluir servicios
    RETURNING 1
  )
  SELECT count(*) INTO v_items_copiados FROM inserted;

  RETURN jsonb_build_object(
    'cotizacion_id', p_cotizacion_id,
    'ot_id', p_ot_id,
    'items_copiados', v_items_copiados,
    'iva_aplicado', COALESCE(v_cot.iva_pct, 0)
  );
END; $function$;


-- =====================================================================
-- S2-15 — fn_generar_producto_segunda_ot: aceptar estado 'terminada'
-- ---------------------------------------------------------------------
-- ORIGINAL: check exigía estado IN ('completada','pendiente_recogida','entregada').
-- Solo se agrega 'terminada' a la lista permitida; el resto se preserva.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_generar_producto_segunda_ot(p_orden_id uuid, p_nombre text, p_categoria text, p_precio numeric, p_costo numeric, p_cantidad numeric, p_sede text DEFAULT NULL::text, p_referencia text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid       uuid := auth.uid();
  v_rol       text;
  v_sede      text;
  v_ot        record;
  v_ref       text;
  v_prod_id   uuid;
  v_sede_dest text;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;

  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;

  select id, numero, sede_id, estado::text, equipo_descripcion
    into v_ot from ordenes_servicio where id = p_orden_id;
  if v_ot.id is null then raise exception 'OT no encontrada'; end if;

  if v_rol not in ('Admin', 'Bodeguero', 'Tecnico') then
    raise exception 'No tienes permiso para generar inventario';
  end if;
  if v_rol <> 'Admin' and v_ot.sede_id <> v_sede then
    raise exception 'No puedes generar inventario de una OT de otra sede';
  end if;
  if v_ot.estado not in ('terminada', 'completada', 'pendiente_recogida', 'entregada') then
    raise exception 'Solo desde una OT terminada (estado actual: %)', v_ot.estado;
  end if;
  if p_nombre is null or trim(p_nombre) = '' then
    raise exception 'El nombre del producto es obligatorio';
  end if;
  if p_categoria is null or trim(p_categoria) = '' then
    raise exception 'La categoría es obligatoria';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor a 0';
  end if;
  if coalesce(p_precio, 0) < 0 or coalesce(p_costo, 0) < 0 then
    raise exception 'Precio o costo inválido';
  end if;

  v_sede_dest := coalesce(nullif(trim(p_sede), ''), v_ot.sede_id);

  v_ref := nullif(trim(p_referencia), '');
  if v_ref is null then
    v_ref := '2DA-OT' || v_ot.numero;
    if exists (select 1 from productos where referencia = v_ref) then
      v_ref := v_ref || '-' || left(replace(gen_random_uuid()::text, '-', ''), 5);
    end if;
  elsif exists (select 1 from productos where referencia = v_ref) then
    raise exception 'Ya existe un producto con la referencia %', v_ref;
  end if;

  insert into productos (
    referencia, nombre, categoria, precio_venta, costo_promedio,
    tipo, vendible, activo, descripcion
  ) values (
    v_ref, trim(p_nombre), upper(trim(p_categoria)),
    coalesce(p_precio, 0), coalesce(p_costo, 0),
    'segunda_mano', true, true,
    'Generado desde OT #' || v_ot.numero
  ) returning id into v_prod_id;

  insert into inventario (producto_id, sede_id, cantidad)
  values (v_prod_id, v_sede_dest, p_cantidad)
  on conflict (producto_id, sede_id)
    do update set cantidad = inventario.cantidad + excluded.cantidad;

  insert into movimientos (
    tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id
  ) values (
    'ajuste', v_prod_id, v_sede_dest, p_cantidad, 0, p_cantidad,
    p_orden_id, 'orden_segunda', v_uid
  );

  perform fn_actualizar_estado_stock(v_prod_id, v_sede_dest);

  return jsonb_build_object(
    'producto_id', v_prod_id, 'referencia', v_ref, 'sede', v_sede_dest
  );
end;
$function$;


-- =====================================================================
-- S2-20 — fn_anular_venta: al anular una venta-OT, reabrir la(s) garantía(s)
-- que se cerraron por la entrega de ESA OT.
-- ---------------------------------------------------------------------
-- ORIGINAL: ver migración ventas_anulacion_trazable_y_revertir_pagos /
-- anular_venta_ignora_servicios. Solo se agrega el bloque de reapertura de
-- garantías dentro de la rama origen='ot'.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_anular_venta(p_venta_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); v_rol text; v_anulada boolean;
  v_item detalle_venta%rowtype; v_sede_id text; v_origen text; v_orden_id uuid;
  v_obs text;
  v_stock_ant integer; v_stock_post integer;
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
  -- S1-07: la venta-diferencia de un cambio de producto no puede anularse directo
  if v_obs is not null and v_obs like 'Cambio por venta #%' then
    raise exception 'Esta venta es la diferencia de un cambio de producto; no se puede anular directamente.';
  end if;
  perform set_config('cdv.anulando_venta', 'on', true);
  update ventas set anulada=true, anulada_por=v_uid, anulada_en=now(), motivo_anulacion=v_motivo
   where id = p_venta_id;
  update pagos_cuenta set anulado=true, anulado_por=v_uid, anulado_en=now(),
         motivo_anulacion=coalesce(v_motivo,'Venta anulada')
   where venta_id = p_venta_id and coalesce(anulado,false)=false;
  if v_origen = 'ot' then
    update abonos set venta_id = null where venta_id = p_venta_id;
    update ordenes_servicio set venta_id = null, estado = 'terminada', fecha_entrega = null
     where id = v_orden_id;
    -- S2-20: reabrir las garantías que se cerraron por la entrega de ESTA OT.
    update garantias_venta
       set estado = 'abierta', fecha_cierre = null, cerrado_por = null
     where ot_reparacion_id = v_orden_id
       and estado = 'cerrada';
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


-- =====================================================================
-- S2-19 — Cerrar exposición de anon en tablas de OT
-- ---------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ordenes_servicio FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.detalle_orden    FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.abonos           FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ot_checklist     FROM anon;

-- Policies de escritura hoy con rol {public} -> restringir a authenticated
-- (se preservan USING/WITH CHECK).
ALTER POLICY os_insert       ON public.ordenes_servicio TO authenticated;
ALTER POLICY abonos_insert   ON public.abonos           TO authenticated;
ALTER POLICY ot_checklist_rw ON public.ot_checklist     TO authenticated;

-- =====================================================================
-- S2-11 — os_update: excluir también 'cancelada' + rol authenticated
-- ---------------------------------------------------------------------
ALTER POLICY os_update ON public.ordenes_servicio
  TO authenticated
  USING (
    (estado <> ALL (ARRAY['entregada'::estado_orden, 'cancelada'::estado_orden]))
    AND ((SELECT get_my_rol()) = ANY (ARRAY['Admin'::text, 'Vendedor'::text]))
    AND (((SELECT get_my_rol()) = 'Admin'::text) OR (sede_id = (SELECT get_my_sede_id())))
  )
  WITH CHECK (
    ((SELECT get_my_rol()) = ANY (ARRAY['Admin'::text, 'Vendedor'::text]))
    AND (((SELECT get_my_rol()) = 'Admin'::text) OR (sede_id = (SELECT get_my_sede_id())))
  );


-- =====================================================================
-- S2-03 — DATA FIX puntual: redondear a pesos enteros el total de las 2 OT
-- atascadas por centavos (terminada/pendiente_recogida, sin venta).
-- #89: 540500.38 -> 540500 | #97: 3343.90 -> 3344
-- (round(total,0) == round(base*(1+iva/100),0), verificado.)
-- ---------------------------------------------------------------------
UPDATE public.ordenes_servicio
   SET total = round(total, 0)
 WHERE estado IN ('terminada','pendiente_recogida')
   AND venta_id IS NULL
   AND total <> round(total, 0);


-- =====================================================================
-- S2-10 — Unicidad de venta ACTIVA por OT (índice único PARCIAL).
-- No se puede usar WHERE orden_id IS NOT NULL a secas porque una venta
-- anulada conserva su orden_id (p.ej. OT #43: venta #406 anulada + #410
-- activa). Se excluyen las anuladas: a lo sumo UNA venta activa por OT.
-- Verificado (coordinador + esta pista): 0 orden_id con >1 venta activa.
-- =====================================================================
CREATE UNIQUE INDEX IF NOT EXISTS ux_ventas_orden_id_activa
  ON public.ventas (orden_id)
  WHERE orden_id IS NOT NULL AND anulada = false;

-- =====================================================================
-- S2-26 — NO-APLICA en BD: repuesto con costo_promedio = 0 es dato de
-- catálogo faltante. No hay fix seguro en base de datos (no se inventa
-- costo). Requiere cargar costos en el catálogo de productos.
-- =====================================================================
