-- ============================================================================
-- Fix F13 — fn_abrir_garantia_venta: cast explícito del CASE a enum
-- ============================================================================
-- BUG encontrado en pruebas de workflow (sesión 2026-05-16):
--   El INSERT a garantias_venta usaba inline:
--     CASE WHEN v_resolucion='arreglar_producto' THEN 'abierta' ELSE 'cerrada' END
--   El CASE resuelve a `text`; la columna `estado` es `estado_garantia_venta`.
--   Postgres NO castea text→enum en una expresión SQL inline dentro de VALUES,
--   por lo que TODA apertura de garantía de venta fallaba con:
--     "column estado is of type estado_garantia_venta but expression is text"
--
--   No se detectó antes porque:
--     - El E2E F7 solo abría el modal, no confirmaba la creación.
--     - Los stress tests B1-B12 hacían INSERT directo, sin pasar por la RPC.
--
-- FIX: castear el CASE explícitamente con ::estado_garantia_venta.
-- (fn_abrir_garantia_compra NO tiene el bug porque asigna el CASE a una
--  variable plpgsql tipada, y plpgsql sí castea en la asignación.)
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_abrir_garantia_venta(p_payload JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT;
  v_garantia_id UUID;
  v_venta RECORD; v_orden RECORD;
  v_anchor_fecha TIMESTAMPTZ;
  v_dias_garantia INT;
  v_sede_id TEXT; v_cliente_nombre TEXT; v_cliente_telefono TEXT;
  v_item JSONB; v_resolucion resolucion_garantia_venta;
  v_ot_reparacion_id UUID;
  v_prod UUID; v_cant INT; v_stock_ant INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT INTO v_rol FROM usuarios WHERE id = v_uid;
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
  ELSE
    RAISE EXCEPTION 'Debes especificar venta_id u orden_servicio_id';
  END IF;

  v_dias_garantia := COALESCE(fn_get_parametro('dias_garantia_venta')::INT, 90);
  IF (now() - v_anchor_fecha) > make_interval(days := v_dias_garantia) THEN
    RAISE EXCEPTION 'Garantía vencida (anchor: %, vigencia: % días)',
      v_anchor_fecha, v_dias_garantia;
  END IF;

  INSERT INTO garantias_venta (
    venta_id, orden_servicio_id, resolucion, estado, motivo,
    monto_devuelto, registrado_por
  ) VALUES (
    NULLIF(p_payload->>'venta_id','')::UUID,
    NULLIF(p_payload->>'orden_servicio_id','')::UUID,
    v_resolucion,
    (CASE WHEN v_resolucion = 'arreglar_producto' THEN 'abierta'
          ELSE 'cerrada' END)::estado_garantia_venta,  -- FIX: cast explícito
    NULLIF(TRIM(p_payload->>'motivo'),''),
    CASE WHEN v_resolucion = 'devolver_dinero'
         THEN COALESCE((p_payload->>'monto_devuelto')::NUMERIC, 0)
         ELSE NULL END,
    v_uid
  ) RETURNING id INTO v_garantia_id;

  IF v_resolucion = 'cambiar_pieza' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'items','[]'::jsonb)) LOOP
      v_prod := (v_item->>'producto_id')::UUID;
      v_cant := (v_item->>'cantidad')::INT;

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
END $$;
