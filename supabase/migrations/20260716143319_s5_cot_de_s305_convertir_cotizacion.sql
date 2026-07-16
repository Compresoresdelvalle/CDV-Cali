-- S3-05 (COT-D/E): nueva firma retrocompatible de fn_convertir_cotizacion.
-- Firma anterior: fn_convertir_cotizacion(uuid) -> se DROPEA para evitar overload
-- ambiguo con la nueva de 3 args con defaults.
--
-- Cambios de diseño (Opción 2 — el dinero cuenta el día que entra):
--  1) La venta creada SIEMPRE nace con metodo_pago='Crédito' (se elimina la regla
--     binaria "v_abonado>=total -> 'Efectivo'"). Así el cierre nunca cuenta el total
--     de la venta el día de conversión; el dinero entra por abonos_cotizacion (antes)
--     y por pagos_cuenta (el saldo, hoy o después).
--  2) Si p_pago_metodo no es null, el cliente paga el SALDO (total - abonado) en el
--     acto. Se registra el cobro en pagos_cuenta espejando fn_registrar_pago_cuenta
--     (validación de método, cuenta obligatoria para pagos electrónicos, usuario).
--     Se inserta directamente (no se llama a fn_registrar_pago_cuenta) porque esa
--     función exige rol Admin, mientras que convertir lo permite Admin y Vendedor.
--  3) El saldo se calcula contra el total AUTORITATIVO de la venta (tras el
--     recálculo del trigger trg_recalcular_total_venta sobre detalle_venta).
--  4) Si el saldo es <= 0 (cotización 100% abonada), se ignora p_pago_metodo.
--  5) Devuelve además 'abonado' y 'saldo_pendiente' para que el frontend informe.
--
-- Métodos de pago aceptados para el cobro del saldo: 'Efectivo', 'Transferencia',
-- 'Tarjeta' (los mismos de pagos_cuenta / fn_registrar_pago_cuenta). Para
-- 'Transferencia' y 'Tarjeta' es obligatorio p_pago_cuenta_bancaria (etiqueta de
-- cuenta, mismo formato que guarda el resto del sistema en pagos_cuenta.cuenta_bancaria).
--
-- Retrocompatibilidad: con los defaults NULL, una llamada de 1 argumento produce una
-- venta a Crédito sin cobro (correcto).
DROP FUNCTION IF EXISTS public.fn_convertir_cotizacion(uuid);

CREATE OR REPLACE FUNCTION public.fn_convertir_cotizacion(
  p_cotizacion_id uuid,
  p_pago_metodo text DEFAULT NULL::text,
  p_pago_cuenta_bancaria text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cot cotizaciones%rowtype;
  v_det record;
  v_venta_id uuid;
  v_uid uuid := auth.uid();
  v_rol text; v_sede text;
  v_costo_prod numeric;
  v_abonado numeric;
  v_total numeric;
  v_saldo numeric;
  v_metodo text := nullif(trim(p_pago_metodo), '');
  v_cuenta text := nullif(trim(p_pago_cuenta_bancaria), '');
  v_cobrado numeric := 0;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;
  if v_rol not in ('Admin','Vendedor') then
    raise exception 'No tienes permiso para convertir cotizaciones';
  end if;
  select * into v_cot from cotizaciones where id = p_cotizacion_id for update;
  if not found then raise exception 'Cotizacion no encontrada'; end if;
  if v_rol <> 'Admin' and v_cot.sede_id <> v_sede then
    raise exception 'No tienes permiso para esta operacion';
  end if;
  if v_cot.venta_id is not null then
    raise exception 'Esta cotizacion ya fue convertida en venta';
  end if;
  if v_cot.ot_id is not null then
    raise exception 'Esta cotizacion esta vinculada a una orden de trabajo; se factura por la OT y no puede convertirse en venta por separado';
  end if;
  if v_cot.estado <> 'aprobada' then
    raise exception 'Solo se puede convertir una cotizacion APROBADA. Estado actual: %', v_cot.estado;
  end if;

  select coalesce(sum(monto),0) into v_abonado from abonos_cotizacion where cotizacion_id = p_cotizacion_id;

  -- La venta SIEMPRE nace a 'Crédito' (ver encabezado de la migración).
  insert into ventas (
    vendedor_id, sede_id, cliente_nombre, cliente_nit,
    subtotal, descuento_pct, descuento_valor, domicilio, iva_pct, total, metodo_pago
  )
  values (
    v_uid, v_cot.sede_id, v_cot.cliente_nombre, v_cot.cliente_nit,
    v_cot.subtotal, coalesce(v_cot.descuento_pct, 0), v_cot.descuento_valor,
    coalesce(v_cot.domicilio, 0), v_cot.iva_pct, v_cot.total, 'Crédito'
  )
  returning id into v_venta_id;

  for v_det in
    select producto_id, servicio_id, descripcion, cantidad, precio_unitario, subtotal
      from detalle_cotizacion where cotizacion_id = p_cotizacion_id
  loop
    if v_det.servicio_id is not null then
      insert into detalle_venta (
        venta_id, producto_id, servicio_id, descripcion,
        cantidad, precio_unitario, costo_unitario, subtotal
      ) values (
        v_venta_id, null, v_det.servicio_id, v_det.descripcion,
        v_det.cantidad, v_det.precio_unitario, 0, v_det.subtotal
      );
    else
      select coalesce(p.costo_promedio, v_det.precio_unitario)
        into v_costo_prod from productos p where p.id = v_det.producto_id;
      insert into detalle_venta (
        venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal
      ) values (
        v_venta_id, v_det.producto_id, v_det.cantidad,
        v_det.precio_unitario, coalesce(v_costo_prod, v_det.precio_unitario), v_det.subtotal
      );
    end if;
  end loop;

  update cotizaciones set venta_id = v_venta_id, updated_at = now()
   where id = p_cotizacion_id;

  -- Total autoritativo tras el recálculo del trigger sobre detalle_venta.
  select coalesce(total,0) into v_total from ventas where id = v_venta_id;
  v_saldo := v_total - v_abonado;

  -- Cobro del saldo en el acto (opcional). Espeja fn_registrar_pago_cuenta.
  if v_metodo is not null and v_saldo > 0 then
    if v_metodo not in ('Efectivo','Transferencia','Tarjeta') then
      raise exception 'Método de pago inválido (%). Aceptados: Efectivo, Transferencia, Tarjeta', v_metodo;
    end if;
    if v_metodo in ('Transferencia','Tarjeta') and v_cuenta is null then
      raise exception 'Indica la cuenta bancaria para pagos electrónicos';
    end if;
    insert into pagos_cuenta (tipo, venta_id, monto, metodo_pago, cuenta_bancaria, observaciones, registrado_por)
    values ('cobro', v_venta_id, v_saldo, v_metodo, v_cuenta,
            'Cobro del saldo al convertir cotización #'||coalesce(v_cot.numero::text,'?'), v_uid);
    v_cobrado := v_saldo;
  end if;

  return jsonb_build_object(
    'ok', true,
    'venta_id', v_venta_id,
    'abonado', v_abonado,
    'saldo_pendiente', v_saldo - v_cobrado
  );
end;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_convertir_cotizacion(uuid, text, text) TO authenticated, service_role;
