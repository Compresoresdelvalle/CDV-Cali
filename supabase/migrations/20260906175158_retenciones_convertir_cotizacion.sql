-- Una venta que nace de una cotizacion tambien puede llevar retencion.
--
-- Hasta ahora fn_convertir_cotizacion no recibia las tarifas, asi que si un
-- cliente grande compraba por cotizacion no habia forma de registrar lo que le
-- retenian: la venta nacia con retencion cero y la caja contaba de mas.
--
-- Y hay algo peor que el hueco funcional: el cobro del saldo en el acto hace un
-- INSERT DIRECTO en pagos_cuenta, sin pasar por fn_registrar_pago_cuenta. Ese
-- INSERT se salta el tope que si conoce la retencion, asi que habria metido al
-- cierre un cobro por el total facturado cuando el cliente solo entrega el neto.
-- Aqui el saldo pasa a medirse contra lo cobrable, que es lo que se cobra.
--
-- Los tres parametros van al final y con DEFAULT 0: ningun llamado existente se
-- rompe y una conversion sin retencion se comporta exactamente igual que antes.
CREATE OR REPLACE FUNCTION public.fn_convertir_cotizacion(
  p_cotizacion_id uuid,
  p_pago_metodo text DEFAULT NULL::text,
  p_pago_cuenta_bancaria text DEFAULT NULL::text,
  p_retefuente_pct numeric DEFAULT 0,   -- RETENCIONES
  p_reteica_pct numeric DEFAULT 0,      -- RETENCIONES
  p_reteiva_pct numeric DEFAULT 0       -- RETENCIONES
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  v_rf numeric; v_ri numeric; v_riva numeric;  -- RETENCIONES
  v_ret numeric;                                -- RETENCIONES
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

  -- RETENCIONES: se recortan a [0, 100]. El CHECK de la tabla los rechazaria,
  -- pero un mensaje de constraint no le dice nada a la vendedora.
  v_rf   := greatest(0, least(100, coalesce(p_retefuente_pct, 0)));
  v_ri   := greatest(0, least(100, coalesce(p_reteica_pct, 0)));
  v_riva := greatest(0, least(100, coalesce(p_reteiva_pct, 0)));

  -- La venta SIEMPRE nace a 'Crédito' (ver encabezado de la migración).
  insert into ventas (
    vendedor_id, sede_id, cliente_nombre, cliente_nit,
    subtotal, descuento_pct, descuento_valor, domicilio, iva_pct, total, metodo_pago,
    retefuente_pct, reteica_pct, reteiva_pct                          -- RETENCIONES
  )
  values (
    v_uid, v_cot.sede_id, v_cot.cliente_nombre, v_cot.cliente_nit,
    v_cot.subtotal, coalesce(v_cot.descuento_pct, 0), v_cot.descuento_valor,
    coalesce(v_cot.domicilio, 0), v_cot.iva_pct, v_cot.total, 'Crédito',
    v_rf, v_ri, v_riva                                                -- RETENCIONES
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
  -- RETENCIONES: la columna generada ya está al día en este punto.
  select coalesce(total,0), coalesce(retenciones_total,0)
    into v_total, v_ret
    from ventas where id = v_venta_id;
  -- Lo cobrable es el NETO: la retención no la paga el cliente. Misma fórmula
  -- que v_cuentas_por_cobrar.saldo y que fn_registrar_pago_cuenta.
  v_saldo := v_total - v_ret - v_abonado;

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
    'retenciones', v_ret,                                             -- RETENCIONES
    'saldo_pendiente', v_saldo - v_cobrado
  );
end;
$function$;

-- CREATE OR REPLACE con parametros nuevos crea una funcion DISTINTA: hay que
-- borrar la vieja o PostgREST no sabe cual llamar. Y la nueva nace con EXECUTE
-- para PUBLIC, asi que `anon` podria convertir cotizaciones saltandose la RLS
-- (es SECURITY DEFINER). Misma leccion que con fn_registrar_venta.
DROP FUNCTION public.fn_convertir_cotizacion(uuid, text, text);

REVOKE EXECUTE ON FUNCTION public.fn_convertir_cotizacion(uuid, text, text, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_convertir_cotizacion(uuid, text, text, numeric, numeric, numeric) TO authenticated, service_role;
