-- BAJO (auditoría 2026-06-09, B9-6): fn_editar_cotizacion declaraba editables
-- 'borrador','enviada','rechazada' y al final forzaba estado='borrador'. Pero el
-- validador trg_cotizacion_validar_transicion NO permite enviada->borrador ni
-- rechazada->borrador, así que editar una cotización enviada/rechazada abortaba con
-- "Transición ilegal de enviada a borrador" (rollback, sin pérdida de datos, pero con
-- un error técnico confuso). La función y el frontend prometían un camino que el
-- trigger siempre rechaza.
--
-- Fix (Opción A — fuente de verdad única, coherente con el botón Editar que solo aparece
-- en 'borrador'): restringir la edición a 'borrador'. El frontend CotizacionEditar.jsx
-- espeja la regla. (borrador->borrador no es transición: el validador la deja pasar.)

create or replace function public.fn_editar_cotizacion(p_cotizacion_id uuid, p_cliente_nombre text DEFAULT NULL::text, p_cliente_nit text DEFAULT NULL::text, p_cliente_email text DEFAULT NULL::text, p_cliente_telefono text DEFAULT NULL::text, p_descuento_pct numeric DEFAULT 0, p_vigencia_dias integer DEFAULT NULL::integer, p_iva_pct numeric DEFAULT NULL::numeric, p_observaciones text DEFAULT NULL::text, p_condiciones_pago text DEFAULT NULL::text, p_tiempo_entrega_nota text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb, p_cuentas_ids bigint[] DEFAULT '{}'::bigint[], p_descuento_valor numeric DEFAULT NULL::numeric, p_domicilio numeric DEFAULT 0)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid; v_my_rol text; v_my_sede text;
  v_estado text; v_sede text; v_venta_id uuid;
  v_iva numeric; v_validez int;
  v_subtotal numeric := 0; v_total numeric; v_desc numeric;
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
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Usuario no autenticado';
  end if;

  v_my_rol := get_my_rol();
  v_my_sede := get_my_sede_id();

  select estado::text, sede_id, venta_id into v_estado, v_sede, v_venta_id
    from cotizaciones where id = p_cotizacion_id for update;
  if not found then
    raise exception 'Cotización no encontrada';
  end if;
  if v_my_rol <> 'Admin' and v_sede is distinct from v_my_sede then
    raise exception 'No puedes editar una cotización de otra sede';
  end if;
  if v_venta_id is not null then
    raise exception 'No se puede editar una cotización ya convertida en venta';
  end if;
  if v_estado <> 'borrador' then
    raise exception 'Solo se puede editar una cotización en estado borrador (estado actual: %)', v_estado;
  end if;

  v_iva := coalesce(p_iva_pct, nullif(fn_get_parametro('iva_pct'), '')::numeric, 19);
  v_validez := coalesce(p_vigencia_dias, nullif(fn_get_parametro('validez_cotizacion_dias'), '')::int, 15);
  if v_iva < 0 or v_iva > 100 then
    raise exception 'iva_pct debe estar entre 0 y 100 (recibido %)', v_iva;
  end if;
  if v_validez < 1 or v_validez > 365 then
    raise exception 'vigencia_dias debe estar entre 1 y 365 (recibido %)', v_validez;
  end if;

  delete from detalle_cotizacion where cotizacion_id = p_cotizacion_id;

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
      values (p_cotizacion_id, null, v_serv_id, v_serv_nombre, v_cant, v_precio, v_cant * v_precio);
    else
      v_prod_id := (item->>'producto_id')::uuid;
      select precio_venta into v_precio_cat from productos where id = v_prod_id and activo = true;
      if v_precio_cat is null then
        raise exception 'Producto % no encontrado o inactivo', v_prod_id;
      end if;
      v_precio := case when v_precio_in is not null and v_precio_in >= 0 then v_precio_in else v_precio_cat end;
      insert into detalle_cotizacion (cotizacion_id, producto_id, cantidad, precio_unitario, subtotal)
      values (p_cotizacion_id, v_prod_id, v_cant, v_precio, v_cant * v_precio);
    end if;

    v_subtotal := v_subtotal + v_cant * v_precio;
  end loop;

  v_desc := coalesce(p_descuento_valor, v_subtotal * coalesce(p_descuento_pct, 0) / 100);
  v_desc := greatest(0, least(v_desc, v_subtotal));
  v_total := (v_subtotal - v_desc) * (1 + v_iva / 100) + greatest(0, coalesce(p_domicilio, 0));

  update cotizaciones set
    cliente_nombre      = trim(p_cliente_nombre),
    cliente_nit         = p_cliente_nit,
    cliente_email       = p_cliente_email,
    cliente_telefono    = p_cliente_telefono,
    descuento_pct       = p_descuento_pct,
    descuento_valor     = p_descuento_valor,
    domicilio           = greatest(0, coalesce(p_domicilio, 0)),
    iva_pct             = v_iva,
    vigencia_dias       = v_validez,
    subtotal            = v_subtotal,
    total               = v_total,
    estado              = 'borrador',
    observaciones       = p_observaciones,
    condiciones_pago    = p_condiciones_pago,
    tiempo_entrega_nota = p_tiempo_entrega_nota
  where id = p_cotizacion_id;

  delete from cotizacion_cuentas_bancarias where cotizacion_id = p_cotizacion_id;
  if array_length(p_cuentas_ids, 1) > 0 then
    foreach v_cuenta_id in array p_cuentas_ids loop
      insert into cotizacion_cuentas_bancarias (cotizacion_id, cuenta_id)
      values (p_cotizacion_id, v_cuenta_id) on conflict do nothing;
    end loop;
  end if;

  return jsonb_build_object('cotizacion_id', p_cotizacion_id, 'subtotal', v_subtotal, 'total', v_total);
end;
$function$;
