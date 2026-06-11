-- BAJO (auditoría 2026-06-09, B9-3): en fn_abrir_garantia_venta el bloque que crea el
-- producto "chatarra" hace SELECT-then-INSERT sobre productos.referencia (UNIQUE) sin
-- ON CONFLICT. Dos garantías concurrentes que devuelven el mismo producto cuyo
-- CHAT-<ref> aún no existe ven NULL las dos; la segunda en commitear viola el UNIQUE y
-- aborta toda la RPC (fail-loud, sin corrupción, pero operación perdida).
--
-- Fix: reuso atómico con INSERT ... ON CONFLICT (referencia) DO NOTHING + re-SELECT del
-- id cuando ya existía. El resto de la función no cambia.

create or replace function public.fn_abrir_garantia_venta(p_payload jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_my_sede text;
  v_garantia_id uuid;
  v_venta record; v_orden record;
  v_anchor_fecha timestamptz;
  v_dias_garantia int;
  v_sede_id text; v_cliente_nombre text; v_cliente_telefono text;
  v_total_ref numeric;
  v_monto numeric;
  v_item jsonb; v_resolucion resolucion_garantia_venta;
  v_ot_reparacion_id uuid;
  v_prod uuid; v_cant int; v_stock_ant int;
  v_dev_item jsonb; v_ref_orig text; v_nom_orig text; v_cat_orig text;
  v_ref_chat text; v_prod_chat uuid; v_chat_post int; v_chat_ant int;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text, sede_id into v_rol, v_my_sede from usuarios where id = v_uid;
  if v_rol not in ('Admin','Vendedor','Tecnico') then
    raise exception 'No tienes permiso para abrir garantías de venta';
  end if;

  v_resolucion := (p_payload->>'resolucion')::resolucion_garantia_venta;

  if p_payload ? 'venta_id' and (p_payload->>'venta_id') is not null then
    select * into v_venta from ventas where id = (p_payload->>'venta_id')::uuid;
    if not found then raise exception 'Venta no encontrada'; end if;
    v_anchor_fecha := v_venta.fecha;
    v_sede_id := v_venta.sede_id;
    v_cliente_nombre := v_venta.cliente_nombre;
    v_total_ref := v_venta.total;
  elsif p_payload ? 'orden_servicio_id' and (p_payload->>'orden_servicio_id') is not null then
    select * into v_orden from ordenes_servicio where id = (p_payload->>'orden_servicio_id')::uuid;
    if not found then raise exception 'OT no encontrada'; end if;
    if v_orden.estado <> 'entregada' then
      raise exception 'Solo se puede abrir garantía sobre OT entregada';
    end if;
    v_anchor_fecha := coalesce(v_orden.fecha_entrega, v_orden.fecha);
    v_sede_id := v_orden.sede_id;
    v_cliente_nombre := v_orden.cliente_nombre;
    v_cliente_telefono := v_orden.cliente_telefono;
    v_total_ref := v_orden.total;
  else
    raise exception 'Debes especificar venta_id u orden_servicio_id';
  end if;

  if v_rol <> 'Admin' and v_sede_id is distinct from v_my_sede then
    raise exception 'No puedes abrir una garantía sobre una venta/OT de otra sede';
  end if;

  v_dias_garantia := coalesce(fn_get_parametro('dias_garantia_venta')::int, 90);
  if (now() - v_anchor_fecha) > make_interval(days := v_dias_garantia) then
    raise exception 'Garantía vencida (anchor: %, vigencia: % días)', v_anchor_fecha, v_dias_garantia;
  end if;

  v_monto := coalesce(nullif(p_payload->>'monto_devuelto','')::numeric, 0);
  if v_resolucion = 'devolver_dinero' then
    if v_monto <= 0 then
      raise exception 'El monto a devolver debe ser mayor que 0';
    end if;
    if v_monto > coalesce(v_total_ref, 0) then
      raise exception 'El monto a devolver (%) no puede superar el total original (%)', v_monto, coalesce(v_total_ref, 0);
    end if;
  end if;

  insert into garantias_venta (
    venta_id, orden_servicio_id, resolucion, estado, motivo,
    monto_devuelto, registrado_por
  ) values (
    nullif(p_payload->>'venta_id','')::uuid,
    nullif(p_payload->>'orden_servicio_id','')::uuid,
    v_resolucion,
    (case when v_resolucion = 'arreglar_producto' then 'abierta' else 'cerrada' end)::estado_garantia_venta,
    nullif(trim(p_payload->>'motivo'),''),
    case when v_resolucion = 'devolver_dinero' then v_monto else null end,
    v_uid
  ) returning id into v_garantia_id;

  if v_resolucion = 'cambiar_pieza' then
    for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
      v_prod := (v_item->>'producto_id')::uuid;
      v_cant := (v_item->>'cantidad')::int;
      if v_cant is null or v_cant <= 0 then
        raise exception 'Cantidad de ítem debe ser > 0';
      end if;

      insert into detalle_garantia_venta (garantia_id, producto_id, sede_id, cantidad)
      values (v_garantia_id, v_prod, v_sede_id, v_cant);

      select coalesce(cantidad,0) into v_stock_ant
        from inventario where producto_id=v_prod and sede_id=v_sede_id for update;
      if v_stock_ant < v_cant then
        raise exception 'Stock insuficiente del producto % (stock=%, requerido=%)', v_prod, v_stock_ant, v_cant;
      end if;
      update inventario set cantidad = cantidad - v_cant, ultimo_movimiento = now(), updated_at = now()
       where producto_id=v_prod and sede_id=v_sede_id;

      insert into movimientos (
        tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, observaciones
      ) values (
        'garantia_salida', v_prod, v_sede_id, -v_cant, v_stock_ant, v_stock_ant - v_cant,
        v_garantia_id, 'garantia_venta', v_uid, 'Garantía venta: cambio de pieza'
      );

      perform fn_actualizar_estado_stock(v_prod, v_sede_id);
    end loop;

  elsif v_resolucion = 'arreglar_producto' then
    insert into ordenes_servicio (
      cliente_nombre, cliente_telefono, equipo_descripcion,
      tecnico_id, sede_id, estado, tipo, estado_autorizacion, valor_revision, observaciones
    ) values (
      v_cliente_nombre, v_cliente_telefono,
      coalesce(nullif(trim(p_payload->>'equipo_descripcion'),''), 'Reparación por garantía'),
      v_uid, v_sede_id, 'abierta'::estado_orden, 'garantia'::tipo_ot,
      'autorizado', 0, 'OT generada automáticamente por garantía'
    ) returning id into v_ot_reparacion_id;

    update garantias_venta set ot_reparacion_id = v_ot_reparacion_id where id = v_garantia_id;
  end if;

  -- Producto(s) defectuoso(s) que devuelve el cliente -> CHATARRA (no vendible).
  for v_dev_item in select * from jsonb_array_elements(coalesce(p_payload->'items_devueltos','[]'::jsonb)) loop
    v_prod := (v_dev_item->>'producto_id')::uuid;
    v_cant := (v_dev_item->>'cantidad')::int;
    if v_prod is null or v_cant is null or v_cant <= 0 then continue; end if;

    select referencia, nombre, categoria into v_ref_orig, v_nom_orig, v_cat_orig
      from productos where id = v_prod;
    if v_ref_orig is null then continue; end if;

    v_ref_chat := 'CHAT-' || v_ref_orig;
    -- Reuso atómico ante concurrencia (B9-3): dos garantías del mismo producto a la vez
    -- ya no rompen el UNIQUE de productos.referencia.
    insert into productos (referencia, nombre, categoria, precio_venta, costo_promedio, tipo, vendible, activo, descripcion)
    values (v_ref_chat, v_nom_orig || ' (chatarra)', v_cat_orig, 0, 0, 'chatarra', false, true,
            'Retorno defectuoso por garantía — no vendible (chatarra)')
    on conflict (referencia) do nothing
    returning id into v_prod_chat;
    if v_prod_chat is null then
      select id into v_prod_chat from productos where referencia = v_ref_chat;
    end if;

    insert into inventario (producto_id, sede_id, cantidad)
    values (v_prod_chat, v_sede_id, v_cant)
    on conflict (producto_id, sede_id) do update
      set cantidad = inventario.cantidad + excluded.cantidad,
          ultimo_movimiento = now(), updated_at = now()
    returning cantidad into v_chat_post;
    v_chat_ant := v_chat_post - v_cant;

    insert into movimientos (
      tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, observaciones
    ) values (
      'garantia_entrada', v_prod_chat, v_sede_id, v_cant, v_chat_ant, v_chat_post,
      v_garantia_id, 'garantia_venta', v_uid, 'Retorno por garantía → chatarra (no vendible)'
    );

    perform fn_actualizar_estado_stock(v_prod_chat, v_sede_id);
  end loop;

  return v_garantia_id;
end $function$;
