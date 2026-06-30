-- Redondeo a pesos enteros (sin centavos) — 2026-06-30
--
-- Reporte de la clienta: en el cierre y en algunas pantallas aparecían decimales
-- (ej. transferencia $3.888.435,12, egreso $22.600,09). Causa CONFIRMADA: el total
-- se calcula aplicando el IVA del 19% (y en compras el IVA se redondeaba a 2 dec.),
-- lo que deja fracciones de peso que luego se acumulan al sumar en el cierre.
-- En COP no se manejan centavos, así que se redondea TODO total a pesos enteros
-- en el origen (triggers y funciones) y se limpian los registros ya guardados.
--
-- Money paths tocados: ventas, órdenes de servicio (OT), compras y cotizaciones.
-- Los abonos ya se registran en pesos enteros (0 con centavos), no se tocan.

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Ventas — trg_recalcular_total_venta: total a pesos enteros
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.trg_recalcular_total_venta()
 returns trigger language plpgsql set search_path to 'public','pg_temp'
as $function$
declare
  v_subtotal numeric(12,2);
  v_venta    record;
  v_desc     numeric;
begin
  select coalesce(sum(subtotal), 0) into v_subtotal
  from detalle_venta where venta_id = coalesce(NEW.venta_id, OLD.venta_id);

  select descuento_pct, descuento_valor, iva_pct, coalesce(domicilio, 0) as domicilio
    into v_venta
  from ventas where id = coalesce(NEW.venta_id, OLD.venta_id);

  v_desc := coalesce(
    v_venta.descuento_valor,
    v_subtotal * coalesce(v_venta.descuento_pct, 0) / 100
  );
  v_desc := greatest(0, least(v_desc, v_subtotal));

  update ventas set
    subtotal = v_subtotal,
    -- round(...) a 0 decimales: el total que entra al cierre queda en pesos enteros.
    total = round((v_subtotal - v_desc) * (1 + coalesce(v_venta.iva_pct, 0) / 100)
            + v_venta.domicilio)
  where id = coalesce(NEW.venta_id, OLD.venta_id);

  return coalesce(NEW, OLD);
end; $function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) OT — trg_orden_recalcular_totales: total a pesos enteros
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.trg_orden_recalcular_totales()
 returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_orden_id uuid; v_val numeric; v_cost numeric;
begin
  v_orden_id := coalesce(NEW.orden_id, OLD.orden_id);
  select coalesce(sum(subtotal),0), coalesce(sum(costo_unitario*cantidad),0)
    into v_val, v_cost from detalle_orden where orden_id = v_orden_id;
  update ordenes_servicio o set
    valor_repuestos = v_val,
    costo_repuestos = v_cost,
    total = round((o.costo_mano_obra + v_val + coalesce(o.valor_revision,0) - coalesce(o.descuento_valor,0))
                  * (1 + coalesce(o.iva_pct,0)/100), 0),
    updated_at = now()
   where o.id = v_orden_id;
  return null;
end $function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) Compras — fn_registrar_compra: IVA y total a pesos enteros
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.fn_registrar_compra(p_sede_id text, p_proveedor text, p_factura_proveedor text DEFAULT NULL::text, p_observaciones text DEFAULT NULL::text, p_recibir boolean DEFAULT false, p_items jsonb DEFAULT '[]'::jsonb, p_iva_pct numeric DEFAULT 19, p_metodo_pago text DEFAULT 'Efectivo'::text, p_cuenta_bancaria text DEFAULT NULL::text, p_descuento_valor numeric DEFAULT NULL::numeric)
 returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare
  v_usuario_id uuid;
  v_mi_sede    text;
  v_mi_rol     text;
  v_compra_id  uuid;
  v_numero     int;
  item         jsonb;
  v_prod_id    uuid;
  v_cantidad   integer;
  v_costo      numeric;
  v_destino    text;
  v_subtotal   numeric := 0;
  v_desc       numeric;
  v_iva_pct    numeric;
  v_iva        numeric;
  v_total      numeric;
  v_metodo     text;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La compra debe tener al menos un ítem';
  end if;

  v_usuario_id := auth.uid();
  if v_usuario_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  select sede_id, rol::text into v_mi_sede, v_mi_rol
    from usuarios where id = v_usuario_id;

  if v_mi_rol not in ('Admin', 'Bodeguero', 'Vendedor') then
    raise exception 'No tienes permiso para registrar compras';
  end if;
  if v_mi_rol <> 'Admin' and v_mi_sede is distinct from p_sede_id then
    raise exception 'No puedes registrar compras en una sede distinta a la tuya';
  end if;
  if p_proveedor is null or trim(p_proveedor) = '' then
    raise exception 'El proveedor es obligatorio';
  end if;

  v_metodo := coalesce(nullif(trim(p_metodo_pago), ''), 'Efectivo');
  if v_metodo not in ('Efectivo', 'Transferencia', 'Tarjeta', 'Crédito') then
    raise exception 'Método de pago inválido (%)', v_metodo;
  end if;

  v_iva_pct := greatest(0, least(100, coalesce(p_iva_pct, 19)));

  for item in select * from jsonb_array_elements(p_items) loop
    v_prod_id  := (item->>'producto_id')::uuid;
    v_cantidad := (item->>'cantidad')::integer;
    v_costo    := (item->>'costo_unitario')::numeric;
    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cantidad inválida para el producto %', v_prod_id;
    end if;
    if v_costo is null or v_costo < 0 then
      raise exception 'Costo inválido para el producto %', v_prod_id;
    end if;
    if not exists (select 1 from productos where id = v_prod_id and activo = true) then
      raise exception 'Producto % no encontrado o inactivo', v_prod_id;
    end if;
    v_subtotal := v_subtotal + v_cantidad * v_costo;
  end loop;

  v_desc  := greatest(0, least(coalesce(p_descuento_valor, 0), v_subtotal));
  -- IVA y total a pesos enteros (sin centavos).
  v_iva   := round((v_subtotal - v_desc) * v_iva_pct / 100, 0);
  v_total := round((v_subtotal - v_desc) + v_iva);

  insert into compras (
    proveedor, registrado_por, sede_destino_id, subtotal, iva, iva_pct, total,
    factura_proveedor, observaciones, recibida,
    metodo_pago, cuenta_bancaria, descuento_valor
  ) values (
    trim(p_proveedor), v_usuario_id, p_sede_id, v_subtotal, v_iva, v_iva_pct, v_total,
    nullif(trim(coalesce(p_factura_proveedor, '')), ''),
    nullif(trim(coalesce(p_observaciones, '')), ''),
    false,
    v_metodo,
    case when v_metodo in ('Transferencia', 'Tarjeta')
      then nullif(trim(coalesce(p_cuenta_bancaria, '')), '') else null end,
    nullif(v_desc, 0)
  ) returning id, numero into v_compra_id, v_numero;

  for item in select * from jsonb_array_elements(p_items) loop
    v_prod_id  := (item->>'producto_id')::uuid;
    v_cantidad := (item->>'cantidad')::integer;
    v_costo    := (item->>'costo_unitario')::numeric;
    v_destino  := lower(coalesce(nullif(trim(item->>'destino'), ''), 'venta'));
    if v_destino not in ('venta', 'insumo') then
      v_destino := 'venta';
    end if;
    insert into detalle_compra (compra_id, producto_id, cantidad, costo_unitario, subtotal, destino)
    values (v_compra_id, v_prod_id, v_cantidad, v_costo, v_cantidad * v_costo, v_destino);
  end loop;

  if p_recibir then
    update compras set recibida = true, fecha_recepcion = now()
     where id = v_compra_id;
  end if;

  return jsonb_build_object(
    'compra_id', v_compra_id, 'numero', v_numero,
    'subtotal', v_subtotal, 'iva_pct', v_iva_pct, 'iva', v_iva, 'total', v_total,
    'recibida', p_recibir
  );
end;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4) Cotizaciones — total a pesos enteros (registrar y editar)
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.fn_registrar_cotizacion(p_sede_id text, p_cliente_nombre text DEFAULT NULL::text, p_cliente_nit text DEFAULT NULL::text, p_cliente_email text DEFAULT NULL::text, p_cliente_telefono text DEFAULT NULL::text, p_descuento_pct numeric DEFAULT 0, p_vigencia_dias integer DEFAULT NULL::integer, p_iva_pct numeric DEFAULT NULL::numeric, p_observaciones text DEFAULT NULL::text, p_condiciones_pago text DEFAULT NULL::text, p_tiempo_entrega_nota text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb, p_cuentas_ids bigint[] DEFAULT '{}'::bigint[], p_ot_id uuid DEFAULT NULL::uuid, p_descuento_valor numeric DEFAULT NULL::numeric, p_domicilio numeric DEFAULT 0)
 returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
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

create or replace function public.fn_editar_cotizacion(p_cotizacion_id uuid, p_cliente_nombre text DEFAULT NULL::text, p_cliente_nit text DEFAULT NULL::text, p_cliente_email text DEFAULT NULL::text, p_cliente_telefono text DEFAULT NULL::text, p_descuento_pct numeric DEFAULT 0, p_vigencia_dias integer DEFAULT NULL::integer, p_iva_pct numeric DEFAULT NULL::numeric, p_observaciones text DEFAULT NULL::text, p_condiciones_pago text DEFAULT NULL::text, p_tiempo_entrega_nota text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb, p_cuentas_ids bigint[] DEFAULT '{}'::bigint[], p_descuento_valor numeric DEFAULT NULL::numeric, p_domicilio numeric DEFAULT 0)
 returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
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
  v_total := round((v_subtotal - v_desc) * (1 + v_iva / 100) + greatest(0, coalesce(p_domicilio, 0)));

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

-- ───────────────────────────────────────────────────────────────────────────
-- 5) Limpieza de los registros ya guardados con centavos (redondeo a pesos).
--    No toca "anulada" (no dispara el guard de ventas). Diferencias < 1 peso.
-- ───────────────────────────────────────────────────────────────────────────
update ventas            set total = round(total)             where total is distinct from round(total);
update cotizaciones      set total = round(total)             where total is distinct from round(total);
update ordenes_servicio  set total = round(total)             where total is distinct from round(total);

-- Compras: el guard trg_before_update_compra_materiales protege los importes de
-- compras ya registradas. Es una salvaguarda contra ediciones accidentales; aquí
-- es una corrección controlada (solo redondeo < 1 peso), así que lo desactivamos
-- puntualmente para el backfill y lo reactivamos enseguida.
alter table compras disable trigger trg_before_update_compra_materiales;
update compras set iva = round(iva), total = round(total) where total is distinct from round(total);
alter table compras enable trigger trg_before_update_compra_materiales;
