-- COT-C: exigir rol Admin/Vendedor (no solo sede) en registrar/convertir/cambiar_estado.
CREATE OR REPLACE FUNCTION public.fn_registrar_cotizacion(p_sede_id text, p_cliente_nombre text DEFAULT NULL::text, p_cliente_nit text DEFAULT NULL::text, p_cliente_email text DEFAULT NULL::text, p_cliente_telefono text DEFAULT NULL::text, p_descuento_pct numeric DEFAULT 0, p_vigencia_dias integer DEFAULT NULL::integer, p_iva_pct numeric DEFAULT NULL::numeric, p_observaciones text DEFAULT NULL::text, p_condiciones_pago text DEFAULT NULL::text, p_tiempo_entrega_nota text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb, p_cuentas_ids bigint[] DEFAULT '{}'::bigint[], p_ot_id uuid DEFAULT NULL::uuid, p_descuento_valor numeric DEFAULT NULL::numeric, p_domicilio numeric DEFAULT 0)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_vendedor_id uuid; v_cot_id uuid; v_numero int;
  v_subtotal numeric := 0; v_total numeric; v_desc numeric;
  v_iva numeric; v_validez int;
  v_my_rol text; v_my_sede text;
  v_ot_sede text;
  item jsonb;
  v_prod_id uuid; v_cant numeric; v_precio numeric; v_precio_in numeric; v_precio_cat numeric;
  v_serv_id bigint; v_serv_nombre text; v_serv_precio numeric;
  v_cuenta_id bigint;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La cotización debe tener al menos un ítem';
  end if;
  if p_cliente_nombre is null or trim(p_cliente_nombre) = '' then
    raise exception 'El nombre del cliente es obligatorio';
  end if;
  v_vendedor_id := auth.uid();
  if v_vendedor_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  v_my_rol := get_my_rol();
  v_my_sede := get_my_sede_id();
  if v_my_rol not in ('Admin','Vendedor') then
    raise exception 'No tienes permiso para registrar cotizaciones';
  end if;
  if v_my_rol <> 'Admin' and p_sede_id is distinct from v_my_sede then
    raise exception 'No puedes crear cotización en una sede distinta a la tuya';
  end if;

  if p_ot_id is not null then
    select sede_id into v_ot_sede from ordenes_servicio where id = p_ot_id;
    if v_ot_sede is null then
      raise exception 'OT vinculada no existe (id %)', p_ot_id;
    end if;
    if v_my_rol <> 'Admin' and v_ot_sede <> v_my_sede then
      raise exception 'No puedes vincular cotización a una OT de otra sede';
    end if;
  end if;

  v_iva := coalesce(p_iva_pct, nullif(fn_get_parametro('iva_pct'), '')::numeric, 19);
  v_validez := coalesce(p_vigencia_dias, nullif(fn_get_parametro('validez_cotizacion_dias'), '')::int, 15);
  if v_iva < 0 or v_iva > 100 then
    raise exception 'iva_pct debe estar entre 0 y 100 (recibido %)', v_iva;
  end if;
  if v_validez < 1 or v_validez > 365 then
    raise exception 'vigencia_dias debe estar entre 1 y 365 (recibido %)', v_validez;
  end if;

  insert into cotizaciones (
    vendedor_id, sede_id, cliente_nombre, cliente_nit, cliente_email, cliente_telefono,
    descuento_pct, descuento_valor, domicilio, iva_pct, vigencia_dias, subtotal, total, estado,
    observaciones, condiciones_pago, tiempo_entrega_nota, ot_id
  ) values (
    v_vendedor_id, p_sede_id, trim(p_cliente_nombre), p_cliente_nit, p_cliente_email, p_cliente_telefono,
    p_descuento_pct, p_descuento_valor, greatest(0, coalesce(p_domicilio, 0)), v_iva, v_validez, 0, 0, 'borrador',
    p_observaciones, p_condiciones_pago, p_tiempo_entrega_nota, p_ot_id
  ) returning id, numero into v_cot_id, v_numero;

  for item in select * from jsonb_array_elements(p_items) loop
    v_cant := (item->>'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then
      raise exception 'Cantidad de ítem debe ser > 0';
    end if;
    v_precio_in := nullif(item->>'precio_unitario', '')::numeric;
    v_serv_id   := nullif(item->>'servicio_id', '')::bigint;

    if v_serv_id is not null then
      select nombre, precio into v_serv_nombre, v_serv_precio
        from servicios where id = v_serv_id and activo = true;
      if v_serv_nombre is null then
        raise exception 'Servicio % no encontrado o inactivo', v_serv_id;
      end if;
      v_precio := case when v_precio_in is not null and v_precio_in >= 0 then v_precio_in else v_serv_precio end;
      insert into detalle_cotizacion (cotizacion_id, producto_id, servicio_id, descripcion, cantidad, precio_unitario, subtotal)
      values (v_cot_id, null, v_serv_id, v_serv_nombre, v_cant, v_precio, v_cant * v_precio);
    else
      v_prod_id := (item->>'producto_id')::uuid;
      select precio_venta into v_precio_cat from productos where id = v_prod_id and activo = true;
      if v_precio_cat is null then
        raise exception 'Producto % no encontrado o inactivo', v_prod_id;
      end if;
      v_precio := case when v_precio_in is not null and v_precio_in >= 0 then v_precio_in else v_precio_cat end;
      insert into detalle_cotizacion (cotizacion_id, producto_id, cantidad, precio_unitario, subtotal)
      values (v_cot_id, v_prod_id, v_cant, v_precio, v_cant * v_precio);
    end if;

    v_subtotal := v_subtotal + v_cant * v_precio;
  end loop;

  v_desc := coalesce(p_descuento_valor, v_subtotal * coalesce(p_descuento_pct, 0) / 100);
  v_desc := greatest(0, least(v_desc, v_subtotal));
  v_total := round((v_subtotal - v_desc) * (1 + v_iva / 100) + greatest(0, coalesce(p_domicilio, 0)));

  update cotizaciones set subtotal = v_subtotal, total = v_total where id = v_cot_id;

  if array_length(p_cuentas_ids, 1) > 0 then
    foreach v_cuenta_id in array p_cuentas_ids loop
      insert into cotizacion_cuentas_bancarias (cotizacion_id, cuenta_id)
      values (v_cot_id, v_cuenta_id) on conflict do nothing;
    end loop;
  end if;

  return jsonb_build_object('cotizacion_id', v_cot_id, 'numero', v_numero, 'total', v_total);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_convertir_cotizacion(p_cotizacion_id uuid)
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
  v_metodo text;
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
  v_metodo := case when v_abonado + 0.01 >= coalesce(v_cot.total,0) then 'Efectivo' else 'Crédito' end;

  insert into ventas (
    vendedor_id, sede_id, cliente_nombre, cliente_nit,
    subtotal, descuento_pct, descuento_valor, domicilio, iva_pct, total, metodo_pago
  )
  values (
    v_uid, v_cot.sede_id, v_cot.cliente_nombre, v_cot.cliente_nit,
    v_cot.subtotal, coalesce(v_cot.descuento_pct, 0), v_cot.descuento_valor,
    coalesce(v_cot.domicilio, 0), v_cot.iva_pct, v_cot.total, v_metodo
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

  return jsonb_build_object('ok', true, 'venta_id', v_venta_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_cambiar_estado_cotizacion(p_cotizacion_id uuid, p_nuevo_estado text, p_nota text DEFAULT NULL::text, p_razon text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cot cotizaciones%ROWTYPE;
  v_uid UUID := auth.uid();
  v_rol TEXT;
  v_sede TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT, sede_id INTO v_rol, v_sede FROM usuarios WHERE id = v_uid;
  IF v_rol NOT IN ('Admin','Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar el estado de cotizaciones';
  END IF;

  SELECT * INTO v_cot FROM cotizaciones WHERE id = p_cotizacion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotizacion no encontrada'; END IF;
  IF v_rol <> 'Admin' AND v_cot.sede_id <> v_sede THEN
    RAISE EXCEPTION 'No tienes permiso para esta operacion';
  END IF;

  IF (v_cot.estado IN ('aprobada','vencida') AND p_nuevo_estado = 'enviada')
     AND v_rol <> 'Admin' THEN
    RAISE EXCEPTION 'Solo el Admin puede revertir una cotizacion %', v_cot.estado;
  END IF;

  UPDATE cotizaciones SET
    estado          = p_nuevo_estado::estado_cotizacion,
    enviada_at      = CASE WHEN p_nuevo_estado='enviada'   THEN now() ELSE enviada_at  END,
    enviada_por     = CASE WHEN p_nuevo_estado='enviada'   THEN v_uid ELSE enviada_por END,
    aprobada_at     = CASE WHEN p_nuevo_estado='aprobada'  THEN now() ELSE aprobada_at END,
    aprobada_por    = CASE WHEN p_nuevo_estado='aprobada'  THEN v_uid ELSE aprobada_por END,
    nota_aprobacion = CASE WHEN p_nuevo_estado='aprobada'  THEN p_nota ELSE nota_aprobacion END,
    rechazada_at    = CASE WHEN p_nuevo_estado='rechazada' THEN now() ELSE rechazada_at END,
    rechazada_por   = CASE WHEN p_nuevo_estado='rechazada' THEN v_uid ELSE rechazada_por END,
    razon_rechazo   = CASE WHEN p_nuevo_estado='rechazada' THEN p_razon ELSE razon_rechazo END,
    vencida_at      = CASE WHEN p_nuevo_estado='vencida'   THEN now() ELSE vencida_at  END,
    fecha           = CASE WHEN v_cot.estado='vencida' AND p_nuevo_estado='enviada'
                            THEN now() ELSE fecha END,
    updated_at      = now()
  WHERE id = p_cotizacion_id;

  RETURN jsonb_build_object('ok', true, 'estado', p_nuevo_estado);
END; $function$;
