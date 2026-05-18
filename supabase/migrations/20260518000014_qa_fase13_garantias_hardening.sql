-- QA Campaña — Fase 13 (Garantías)
-- Cierra 3 hallazgos P1 de la revisión:
--   * F13-01 (P1, server-authoritative): `fn_abrir_garantia_compra` usaba el
--     `costo_unitario` enviado por el cliente para calcular el monto de la
--     `notas_credito_proveedor` → un cliente manipulado podía inflar la nota
--     crédito. Ahora el costo se lee de `detalle_compra` (autoritativo) y de
--     paso valida que el producto pertenezca a la compra.
--   * F13-02 (P1, RBAC): ni `fn_abrir_garantia_venta` ni
--     `fn_abrir_garantia_compra` validaban que la venta/OT/compra fuera de la
--     sede del usuario → un no-Admin podía abrir garantía (y descontar stock)
--     sobre operaciones de otra sede. Se añade verificación de sede.
--   * F13-03 (P1, seguridad): `fn_abrir_garantia_venta` aceptaba cualquier
--     `monto_devuelto` del cliente sin tope → se podía registrar una
--     devolución de dinero arbitraria. Ahora se topa al total original y se
--     exige monto > 0.

CREATE OR REPLACE FUNCTION public.fn_abrir_garantia_compra(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT;
  v_my_sede TEXT;
  v_garantia_id UUID;
  v_compra RECORD;
  v_item JSONB;
  v_estado_final estado_garantia_compra;
  v_monto_total NUMERIC := 0;
  v_resolucion resolucion_garantia_compra;
  v_prod UUID; v_cant INT;
  v_costo NUMERIC;
  v_stock_ant INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT, sede_id INTO v_rol, v_my_sede FROM usuarios WHERE id = v_uid;
  IF v_rol NOT IN ('Admin','Bodeguero') THEN
    RAISE EXCEPTION 'No tienes permiso para abrir garantías de compra';
  END IF;

  SELECT * INTO v_compra FROM compras WHERE id = (p_payload->>'compra_id')::UUID;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada'; END IF;
  IF NOT COALESCE(v_compra.recibida, FALSE) THEN
    RAISE EXCEPTION 'Solo se puede abrir garantía sobre compras ya recibidas';
  END IF;
  IF v_rol <> 'Admin' AND v_compra.sede_destino_id IS DISTINCT FROM v_my_sede THEN
    RAISE EXCEPTION 'No puedes abrir una garantía sobre una compra de otra sede';
  END IF;

  v_resolucion := (p_payload->>'resolucion')::resolucion_garantia_compra;
  v_estado_final := CASE v_resolucion
    WHEN 'nota_credito'      THEN 'nota_credito_emitida'
    WHEN 'reposicion_fisica' THEN 'reposicion_pendiente'
    ELSE 'abierta'
  END;

  INSERT INTO garantias_compra (compra_id, resolucion, estado, motivo, registrado_por)
  VALUES (v_compra.id, v_resolucion, v_estado_final,
          NULLIF(TRIM(p_payload->>'motivo'),''), v_uid)
  RETURNING id INTO v_garantia_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    v_prod := (v_item->>'producto_id')::UUID;
    v_cant := (v_item->>'cantidad')::INT;
    IF v_cant IS NULL OR v_cant <= 0 THEN
      RAISE EXCEPTION 'Cantidad de ítem debe ser > 0';
    END IF;

    -- Costo server-authoritative: del detalle de la compra, no del cliente.
    -- Valida de paso que el producto pertenezca a la compra.
    SELECT costo_unitario INTO v_costo
      FROM detalle_compra
     WHERE compra_id = v_compra.id AND producto_id = v_prod
     LIMIT 1;
    IF v_costo IS NULL THEN
      RAISE EXCEPTION 'El producto % no pertenece a la compra %', v_prod, v_compra.id;
    END IF;

    INSERT INTO detalle_garantia_compra (
      garantia_id, producto_id, sede_id, cantidad, costo_unitario
    ) VALUES (
      v_garantia_id, v_prod, v_compra.sede_destino_id, v_cant, v_costo
    );
    v_monto_total := v_monto_total + v_cant * v_costo;

    -- Lock + leer stock + restar
    SELECT COALESCE(cantidad,0) INTO v_stock_ant
      FROM inventario WHERE producto_id=v_prod AND sede_id=v_compra.sede_destino_id
      FOR UPDATE;
    IF v_stock_ant < v_cant THEN
      RAISE EXCEPTION 'Stock insuficiente del producto % en sede % (stock=%, requerido=%)',
        v_prod, v_compra.sede_destino_id, v_stock_ant, v_cant;
    END IF;
    UPDATE inventario SET cantidad = cantidad - v_cant, ultimo_movimiento = now(), updated_at = now()
     WHERE producto_id=v_prod AND sede_id=v_compra.sede_destino_id;

    INSERT INTO movimientos (
      tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, observaciones
    ) VALUES (
      'garantia_salida', v_prod, v_compra.sede_destino_id, -v_cant,
      v_stock_ant, v_stock_ant - v_cant,
      v_garantia_id, 'garantia_compra', v_uid,
      'Devolución por garantía al proveedor'
    );

    PERFORM fn_actualizar_estado_stock(v_prod, v_compra.sede_destino_id);
  END LOOP;

  IF v_resolucion = 'nota_credito' AND v_monto_total > 0 THEN
    INSERT INTO notas_credito_proveedor (
      proveedor, garantia_compra_id, monto, saldo_restante, observaciones, registrado_por
    ) VALUES (
      v_compra.proveedor, v_garantia_id, v_monto_total, v_monto_total,
      'Nota crédito por garantía de compra', v_uid
    );
  END IF;

  RETURN v_garantia_id;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_abrir_garantia_venta(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT;
  v_my_sede TEXT;
  v_garantia_id UUID;
  v_venta RECORD; v_orden RECORD;
  v_anchor_fecha TIMESTAMPTZ;
  v_dias_garantia INT;
  v_sede_id TEXT; v_cliente_nombre TEXT; v_cliente_telefono TEXT;
  v_total_ref NUMERIC;
  v_monto NUMERIC;
  v_item JSONB; v_resolucion resolucion_garantia_venta;
  v_ot_reparacion_id UUID;
  v_prod UUID; v_cant INT; v_stock_ant INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT, sede_id INTO v_rol, v_my_sede FROM usuarios WHERE id = v_uid;
  IF v_rol NOT IN ('Admin','Vendedor','Tecnico') THEN
    RAISE EXCEPTION 'No tienes permiso para abrir garantías de venta';
  END IF;

  v_resolucion := (p_payload->>'resolucion')::resolucion_garantia_venta;

  IF p_payload ? 'venta_id' AND (p_payload->>'venta_id') IS NOT NULL THEN
    SELECT * INTO v_venta FROM ventas WHERE id = (p_payload->>'venta_id')::UUID;
    IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;
    v_anchor_fecha := v_venta.fecha;
    v_sede_id := v_venta.sede_id;
    v_cliente_nombre := v_venta.cliente_nombre;
    v_total_ref := v_venta.total;
  ELSIF p_payload ? 'orden_servicio_id' AND (p_payload->>'orden_servicio_id') IS NOT NULL THEN
    SELECT * INTO v_orden FROM ordenes_servicio WHERE id = (p_payload->>'orden_servicio_id')::UUID;
    IF NOT FOUND THEN RAISE EXCEPTION 'OT no encontrada'; END IF;
    IF v_orden.estado <> 'entregada' THEN
      RAISE EXCEPTION 'Solo se puede abrir garantía sobre OT entregada';
    END IF;
    v_anchor_fecha := COALESCE(v_orden.fecha_entrega, v_orden.fecha);
    v_sede_id := v_orden.sede_id;
    v_cliente_nombre := v_orden.cliente_nombre;
    v_cliente_telefono := v_orden.cliente_telefono;
    v_total_ref := v_orden.total;
  ELSE
    RAISE EXCEPTION 'Debes especificar venta_id u orden_servicio_id';
  END IF;

  IF v_rol <> 'Admin' AND v_sede_id IS DISTINCT FROM v_my_sede THEN
    RAISE EXCEPTION 'No puedes abrir una garantía sobre una venta/OT de otra sede';
  END IF;

  v_dias_garantia := COALESCE(fn_get_parametro('dias_garantia_venta')::INT, 90);
  IF (now() - v_anchor_fecha) > make_interval(days := v_dias_garantia) THEN
    RAISE EXCEPTION 'Garantía vencida (anchor: %, vigencia: % días)',
      v_anchor_fecha, v_dias_garantia;
  END IF;

  -- Monto a devolver server-authoritative: > 0 y topado al total original.
  v_monto := COALESCE(NULLIF(p_payload->>'monto_devuelto','')::NUMERIC, 0);
  IF v_resolucion = 'devolver_dinero' THEN
    IF v_monto <= 0 THEN
      RAISE EXCEPTION 'El monto a devolver debe ser mayor que 0';
    END IF;
    IF v_monto > COALESCE(v_total_ref, 0) THEN
      RAISE EXCEPTION 'El monto a devolver (%) no puede superar el total original (%)',
        v_monto, COALESCE(v_total_ref, 0);
    END IF;
  END IF;

  INSERT INTO garantias_venta (
    venta_id, orden_servicio_id, resolucion, estado, motivo,
    monto_devuelto, registrado_por
  ) VALUES (
    NULLIF(p_payload->>'venta_id','')::UUID,
    NULLIF(p_payload->>'orden_servicio_id','')::UUID,
    v_resolucion,
    (CASE WHEN v_resolucion = 'arreglar_producto' THEN 'abierta'
          ELSE 'cerrada' END)::estado_garantia_venta,
    NULLIF(TRIM(p_payload->>'motivo'),''),
    CASE WHEN v_resolucion = 'devolver_dinero' THEN v_monto ELSE NULL END,
    v_uid
  ) RETURNING id INTO v_garantia_id;

  IF v_resolucion = 'cambiar_pieza' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'items','[]'::jsonb)) LOOP
      v_prod := (v_item->>'producto_id')::UUID;
      v_cant := (v_item->>'cantidad')::INT;
      IF v_cant IS NULL OR v_cant <= 0 THEN
        RAISE EXCEPTION 'Cantidad de ítem debe ser > 0';
      END IF;

      INSERT INTO detalle_garantia_venta (garantia_id, producto_id, sede_id, cantidad)
      VALUES (v_garantia_id, v_prod, v_sede_id, v_cant);

      SELECT COALESCE(cantidad,0) INTO v_stock_ant
        FROM inventario WHERE producto_id=v_prod AND sede_id=v_sede_id
        FOR UPDATE;
      IF v_stock_ant < v_cant THEN
        RAISE EXCEPTION 'Stock insuficiente del producto % (stock=%, requerido=%)',
          v_prod, v_stock_ant, v_cant;
      END IF;
      UPDATE inventario SET cantidad = cantidad - v_cant, ultimo_movimiento = now(), updated_at = now()
       WHERE producto_id=v_prod AND sede_id=v_sede_id;

      INSERT INTO movimientos (
        tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, observaciones
      ) VALUES (
        'garantia_salida', v_prod, v_sede_id, -v_cant,
        v_stock_ant, v_stock_ant - v_cant,
        v_garantia_id, 'garantia_venta', v_uid,
        'Garantía venta: cambio de pieza'
      );

      PERFORM fn_actualizar_estado_stock(v_prod, v_sede_id);
    END LOOP;

  ELSIF v_resolucion = 'arreglar_producto' THEN
    INSERT INTO ordenes_servicio (
      cliente_nombre, cliente_telefono, equipo_descripcion,
      tecnico_id, sede_id, estado, tipo,
      estado_autorizacion, valor_revision, observaciones
    ) VALUES (
      v_cliente_nombre, v_cliente_telefono,
      COALESCE(NULLIF(TRIM(p_payload->>'equipo_descripcion'),''),
               'Reparación por garantía'),
      v_uid, v_sede_id, 'abierta'::estado_orden, 'garantia'::tipo_ot,
      'autorizado', 0,
      'OT generada automáticamente por garantía'
    ) RETURNING id INTO v_ot_reparacion_id;

    UPDATE garantias_venta SET ot_reparacion_id = v_ot_reparacion_id
     WHERE id = v_garantia_id;
  END IF;

  RETURN v_garantia_id;
END $function$;
