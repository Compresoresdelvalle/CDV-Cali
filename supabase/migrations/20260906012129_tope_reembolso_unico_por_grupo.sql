-- Tope UNICO de reembolso por grupo (OT + todas sus ventas), enchufado en las
-- dos RPC que sacan plata de la caja.
--
-- Contexto: hasta hoy habia tres cuentas separadas que no se hablaban, asi que
-- se podia devolver el total de una compra mas de una vez (por devolucion y por
-- garantia sobre la misma venta; y al abrir la garantia desde la OT, tambien
-- contra la OT y contra su factura). Los reembolsos salen como egreso del cierre
-- del dia, asi que era plata duplicada de verdad.
--
-- Aqui las dos funciones pasan a preguntarle a fn_reembolsado_del_grupo, que es
-- la unica fuente de verdad. El tope contra el que se compara NO cambia (sigue
-- siendo el total del documento por el que se entra): solo cambia lo que se suma
-- contra ese tope. Por eso el cambio solo puede rechazar mas, nunca aceptar mas,
-- y ninguna operacion valida de hoy deja de funcionar.
--
-- Serializacion: los FOR UPDATE existentes bloquean la fila por la que se entro
-- (la OT o la venta), que son filas distintas segun la puerta, asi que por si
-- solos no cierran la carrera entre dos reclamos simultaneos del mismo grupo. Se
-- agrega un pg_advisory_xact_lock sobre la clave del GRUPO, que es la misma sin
-- importar la puerta. Se toma despues de los FOR UPDATE y siempre sobre la misma
-- clave, asi que no hay ciclo de espera posible entre las rutas.

CREATE OR REPLACE FUNCTION public.fn_abrir_garantia_venta(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_ref_venta_id uuid; v_ref_ot_id uuid; v_ya_devuelto numeric;
  v_grupo_ot uuid;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text, sede_id into v_rol, v_my_sede from usuarios where id = v_uid;
  if v_rol not in ('Admin','Vendedor','Tecnico') then
    raise exception 'No tienes permiso para abrir garantías de venta';
  end if;

  v_resolucion := (p_payload->>'resolucion')::resolucion_garantia_venta;

  if p_payload ? 'venta_id' and (p_payload->>'venta_id') is not null then
    select * into v_venta from ventas where id = (p_payload->>'venta_id')::uuid for update;
    if not found then raise exception 'Venta no encontrada'; end if;
    v_anchor_fecha := v_venta.fecha;
    v_sede_id := v_venta.sede_id;
    v_cliente_nombre := v_venta.cliente_nombre;
    v_total_ref := v_venta.total;
    v_ref_venta_id := v_venta.id;
  elsif p_payload ? 'orden_servicio_id' and (p_payload->>'orden_servicio_id') is not null then
    select * into v_orden from ordenes_servicio where id = (p_payload->>'orden_servicio_id')::uuid for update;
    if not found then raise exception 'OT no encontrada'; end if;
    if v_orden.estado <> 'entregada' then
      raise exception 'Solo se puede abrir garantía sobre OT entregada';
    end if;
    v_anchor_fecha := coalesce(v_orden.fecha_entrega, v_orden.fecha);
    v_sede_id := v_orden.sede_id;
    v_cliente_nombre := v_orden.cliente_nombre;
    v_cliente_telefono := v_orden.cliente_telefono;
    v_total_ref := v_orden.total;
    v_ref_ot_id := v_orden.id;
  else
    raise exception 'Debes especificar venta_id u orden_servicio_id';
  end if;

  if v_rol <> 'Admin' and v_sede_id is distinct from v_my_sede then
    raise exception 'No puedes abrir una garantía sobre una venta/OT de otra sede';
  end if;

  v_dias_garantia := coalesce(fn_get_parametro('dias_garantia_venta')::int, 90);
  if (now() - v_anchor_fecha) > make_interval(days := v_dias_garantia) then
    -- El mensaje viejo escupia 'anchor' y un timestamp crudo. Ahora que la
    -- garantia tambien se abre desde la OT lo lee la vendedora en el mostrador,
    -- asi que dice desde cuando, hasta cuando y cuanto se paso.
    raise exception 'La garantia ya vencio: son % dias contados desde el %, asi que el plazo se cumplio el % y hoy van % dias de mas. Si de todos modos hay que responderle al cliente, tiene que autorizarlo Maritza.',
      v_dias_garantia,
      to_char(v_anchor_fecha AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY'),
      to_char((v_anchor_fecha + make_interval(days := v_dias_garantia)) AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY'),
      extract(day from (now() - v_anchor_fecha))::int - v_dias_garantia;
  end if;

  v_monto := coalesce(nullif(p_payload->>'monto_devuelto','')::numeric, 0);
  if v_resolucion = 'devolver_dinero' then
    if v_monto <= 0 then
      raise exception 'El monto a devolver debe ser mayor que 0';
    end if;
    if v_monto > coalesce(v_total_ref, 0) then
      raise exception 'El monto a devolver (%) no puede superar el total original (%)', v_monto, coalesce(v_total_ref, 0);
    end if;
    -- Reembolso ACUMULADO, ahora por GRUPO (una OT + todas las ventas que
    -- genero) y contando tambien las devoluciones de cliente, que salen de la
    -- misma plata. Antes esto era un if/else que miraba `venta_id` O
    -- `orden_servicio_id` y no veia devoluciones: se podia devolver el total
    -- dos veces por puertas distintas.
    --
    -- La clave del grupo es la OT cuando existe (se entre por ella o por su
    -- factura); si no, la venta suelta. El advisory lock sobre esa clave es lo
    -- que serializa de verdad: los FOR UPDATE de arriba bloquean la fila por la
    -- que se entro, que es una fila DISTINTA segun la puerta, asi que por si
    -- solos no cierran la carrera. Se toma despues de esos FOR UPDATE y siempre
    -- sobre la misma clave, asi que no hay ciclo de espera posible.
    v_grupo_ot := v_ref_ot_id;
    if v_grupo_ot is null and v_ref_venta_id is not null then
      select orden_id into v_grupo_ot from ventas where id = v_ref_venta_id;
    end if;
    perform pg_advisory_xact_lock(
      hashtext('reembolso:' || coalesce(v_grupo_ot, v_ref_venta_id)::text));

    v_ya_devuelto := fn_reembolsado_del_grupo(v_ref_ot_id, v_ref_venta_id);

    if v_ya_devuelto + v_monto > coalesce(v_total_ref, 0) then
      raise exception 'No se puede devolver $%: de esta compra ya se devolvieron $% y el total fue $%, asi que como maximo quedan $%. La cuenta suma las devoluciones y las garantias de la orden de trabajo Y de su factura, porque son la misma plata. Revisa el historial de la venta antes de insistir.',
        to_char(v_monto, 'FM999G999G999G990'),
        to_char(v_ya_devuelto, 'FM999G999G999G990'),
        to_char(coalesce(v_total_ref, 0), 'FM999G999G999G990'),
        to_char(greatest(coalesce(v_total_ref, 0) - v_ya_devuelto, 0), 'FM999G999G999G990');
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


CREATE OR REPLACE FUNCTION public.fn_registrar_devolucion_cliente(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rol text; v_my_sede text;
  v_venta record;
  v_producto_id uuid := nullif(p_payload->>'producto_id','')::uuid;
  v_cantidad int := (p_payload->>'cantidad')::int;
  v_destino text := coalesce(nullif(p_payload->>'destino_stock',''), 'vendible');
  v_monto numeric := coalesce(nullif(p_payload->>'monto_reembolso','')::numeric, 0);
  v_metodo text := nullif(trim(p_payload->>'metodo_reembolso'),'');
  v_cuenta text := nullif(trim(p_payload->>'cuenta_reembolso'),'');
  v_motivo text := coalesce(nullif(trim(p_payload->>'motivo'),''), 'Devolución de cliente');
  v_obs text := nullif(trim(p_payload->>'observaciones'),'');
  v_sede text;
  v_cant_orig int; v_dev_previo int;
  v_ya_reemb numeric;
  v_grupo_ot uuid;
  v_dev_id uuid; v_numero int;
  v_stock_ant int; v_stock_post int; v_reingresa boolean;
  v_ref text; v_nom text; v_cat text; v_ref_chat text; v_prod_chat uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::text, sede_id INTO v_rol, v_my_sede FROM usuarios WHERE id = v_uid;
  IF v_rol IS NULL OR v_rol NOT IN ('Admin','Bodeguero','Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar devoluciones';
  END IF;

  IF v_producto_id IS NULL THEN RAISE EXCEPTION 'Falta el producto'; END IF;
  IF v_cantidad IS NULL OR v_cantidad <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser mayor a 0'; END IF;
  IF v_destino NOT IN ('vendible','chatarra','no_reingresa') THEN
    RAISE EXCEPTION 'Destino inválido';
  END IF;

  -- `orden_id` se agrega para el tope por grupo: si la venta nacio de una OT, el
  -- reembolso comparte cupo con las garantias de esa OT.
  SELECT id, numero, sede_id, total, anulada, orden_id INTO v_venta
  FROM ventas WHERE id = nullif(p_payload->>'venta_id','')::uuid FOR UPDATE;
  IF v_venta.id IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;
  IF v_venta.anulada THEN
    RAISE EXCEPTION 'No se puede devolver sobre una venta anulada';
  END IF;
  v_sede := v_venta.sede_id;

  -- Vendedor: solo sobre su sede.
  IF v_rol <> 'Admin' AND v_rol <> 'Bodeguero' AND v_sede IS DISTINCT FROM v_my_sede THEN
    RAISE EXCEPTION 'Solo puedes registrar devoluciones de ventas de tu sede';
  END IF;

  -- El producto debía estar en la venta.
  SELECT coalesce(sum(cantidad),0) INTO v_cant_orig
  FROM detalle_venta WHERE venta_id = v_venta.id AND producto_id = v_producto_id;
  IF v_cant_orig = 0 THEN RAISE EXCEPTION 'El producto no estaba en la venta original'; END IF;

  -- No exceder lo vendido (contando devoluciones previas no anuladas).
  SELECT coalesce(sum(cantidad),0) INTO v_dev_previo
  FROM devoluciones WHERE venta_id = v_venta.id AND producto_id = v_producto_id
    AND estado <> 'anulada';
  IF v_dev_previo + v_cantidad > v_cant_orig THEN
    RAISE EXCEPTION 'La cantidad excede lo vendido (vendido %, ya devuelto %, intentas %)',
      v_cant_orig, v_dev_previo, v_cantidad;
  END IF;

  -- Reembolso: validaciones de dinero.
  IF v_monto > 0 THEN
    IF v_metodo IS NULL THEN RAISE EXCEPTION 'Elige el método del reembolso'; END IF;
    -- Tope acumulado por GRUPO: devoluciones + garantias de reembolso, tanto de
    -- esta venta como de la OT que la genero (si nacio de una). Antes solo se
    -- miraba `venta_id`, asi que una garantia colgada de la OT no se veia y se
    -- podia devolver el total dos veces.
    --
    -- Mismo candado y misma clave que fn_abrir_garantia_venta: es lo que hace
    -- que las dos puertas se serialicen entre si. Va despues del FOR UPDATE de
    -- la venta, igual que alla, para que el orden de adquisicion sea el mismo.
    v_grupo_ot := v_venta.orden_id;
    PERFORM pg_advisory_xact_lock(
      hashtext('reembolso:' || coalesce(v_grupo_ot, v_venta.id)::text));

    v_ya_reemb := fn_reembolsado_del_grupo(NULL, v_venta.id);

    IF v_ya_reemb + v_monto > coalesce(v_venta.total,0) + 0.01 THEN
      RAISE EXCEPTION 'No se puede reembolsar $%: de esta venta ya se devolvieron $% y el total fue $%, asi que como maximo quedan $%. La cuenta suma las devoluciones y las garantias de la venta Y de la orden de trabajo que la genero, porque son la misma plata.',
        to_char(v_monto, 'FM999G999G999G990'),
        to_char(v_ya_reemb, 'FM999G999G999G990'),
        to_char(coalesce(v_venta.total,0), 'FM999G999G999G990'),
        to_char(greatest(coalesce(v_venta.total,0) - v_ya_reemb, 0), 'FM999G999G999G990');
    END IF;
  ELSE
    v_metodo := NULL; v_cuenta := NULL;
  END IF;

  v_reingresa := (v_destino = 'vendible');

  INSERT INTO devoluciones (venta_id, producto_id, sede_id, cantidad, motivo, observaciones,
    registrado_por, reingresa_stock, estado, destino_stock, monto_reembolso, metodo_reembolso, cuenta_reembolso)
  VALUES (v_venta.id, v_producto_id, v_sede, v_cantidad, v_motivo, v_obs,
    v_uid, v_reingresa, 'procesada', v_destino, v_monto, v_metodo, v_cuenta)
  RETURNING id, numero INTO v_dev_id, v_numero;

  -- Inventario según destino.
  IF v_destino = 'vendible' THEN
    INSERT INTO inventario (producto_id, sede_id, cantidad, estado_stock)
    VALUES (v_producto_id, v_sede, 0, 'OK')
    ON CONFLICT (producto_id, sede_id) DO NOTHING;
    SELECT cantidad INTO v_stock_ant FROM inventario
      WHERE producto_id=v_producto_id AND sede_id=v_sede FOR UPDATE;
    UPDATE inventario SET cantidad = cantidad + v_cantidad, ultimo_movimiento=now(), updated_at=now()
      WHERE producto_id=v_producto_id AND sede_id=v_sede RETURNING cantidad INTO v_stock_post;
    INSERT INTO movimientos (producto_id, sede_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, observaciones)
    VALUES (v_producto_id, v_sede, 'devolucion', v_cantidad, v_stock_ant, v_stock_post,
      v_dev_id, 'devolucion', v_uid, 'Devolución de cliente #' || v_numero || ' (vuelve a stock)');
    PERFORM fn_actualizar_estado_stock(v_producto_id, v_sede);

  ELSIF v_destino = 'chatarra' THEN
    SELECT referencia, nombre, categoria INTO v_ref, v_nom, v_cat FROM productos WHERE id=v_producto_id;
    v_ref_chat := 'CHAT-' || v_ref;
    INSERT INTO productos (referencia, nombre, categoria, precio_venta, costo_promedio, tipo, vendible, activo, descripcion)
    VALUES (v_ref_chat, v_nom || ' (chatarra)', v_cat, 0, 0, 'chatarra', false, true,
            'Retorno por devolución de cliente — no vendible (chatarra)')
    ON CONFLICT (referencia) DO NOTHING RETURNING id INTO v_prod_chat;
    IF v_prod_chat IS NULL THEN SELECT id INTO v_prod_chat FROM productos WHERE referencia=v_ref_chat; END IF;

    INSERT INTO inventario (producto_id, sede_id, cantidad)
    VALUES (v_prod_chat, v_sede, v_cantidad)
    ON CONFLICT (producto_id, sede_id) DO UPDATE
      SET cantidad = inventario.cantidad + excluded.cantidad, ultimo_movimiento=now(), updated_at=now()
    RETURNING cantidad INTO v_stock_post;
    v_stock_ant := v_stock_post - v_cantidad;
    UPDATE devoluciones SET chatarra_producto_id = v_prod_chat WHERE id = v_dev_id;

    INSERT INTO movimientos (producto_id, sede_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, observaciones)
    VALUES (v_prod_chat, v_sede, 'devolucion', v_cantidad, v_stock_ant, v_stock_post,
      v_dev_id, 'devolucion', v_uid, 'Devolución de cliente #' || v_numero || ' → chatarra');
    PERFORM fn_actualizar_estado_stock(v_prod_chat, v_sede);
  END IF;
  -- no_reingresa: no toca inventario.

  RETURN jsonb_build_object(
    'devolucion_id', v_dev_id, 'numero', v_numero, 'sede_id', v_sede,
    'destino_stock', v_destino, 'monto_reembolso', v_monto, 'metodo_reembolso', v_metodo
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_registrar_devolucion_cliente(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_registrar_devolucion_cliente(jsonb) TO authenticated;
