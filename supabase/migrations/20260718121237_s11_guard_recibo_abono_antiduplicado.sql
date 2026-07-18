-- S11 verificación adversarial: guard suave anti-duplicado en fn_registrar_recibo.
-- Hallazgo P2: crear_abono insertaba un abono en la OT sin verificar duplicado;
-- el default OFF del frontend era la única barrera contra el doble conteo del cierre.
-- Guard: si ya existe un abono idéntico (misma OT, mismo monto, mismo método)
-- creado en los últimos 10 minutos, NO se vuelve a insertar. Montos/métodos
-- distintos SÍ pasan (dos pagos reales iguales back-to-back siguen permitidos).
CREATE OR REPLACE FUNCTION public.fn_registrar_recibo(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT; v_my_sede TEXT; v_sede TEXT;
  v_recibo_id UUID; v_numero INT;
  v_orden_id UUID; v_cot_id UUID;
  v_monto_pagado NUMERIC;
  v_crear_abono BOOLEAN;
  v_metodo TEXT;
  v_abono_id BIGINT;
  v_abono_omitido BOOLEAN := false;
  v_item JSONB;
  v_iva NUMERIC;
  v_subtotal NUMERIC := 0;
  v_total NUMERIC;
  v_abonos_previos NUMERIC := 0;
  v_saldo NUMERIC;
  v_has_items BOOLEAN;
  v_item_cant NUMERIC;
  v_item_precio NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT, sede_id INTO v_rol, v_my_sede FROM usuarios WHERE id = v_uid;
  IF v_rol NOT IN ('Admin','Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para crear recibos';
  END IF;

  IF COALESCE(TRIM(p_payload->>'cliente_nombre'),'') = '' THEN
    RAISE EXCEPTION 'El nombre del cliente es obligatorio';
  END IF;
  IF COALESCE(TRIM(p_payload->>'concepto'),'') = '' THEN
    RAISE EXCEPTION 'El concepto es obligatorio';
  END IF;

  -- Sede server-authoritative: un no-Admin solo puede crear en su sede.
  v_sede := COALESCE(NULLIF(p_payload->>'sede_id',''), v_my_sede);
  IF v_rol <> 'Admin' AND v_sede IS DISTINCT FROM v_my_sede THEN
    RAISE EXCEPTION 'No puedes crear recibos en una sede distinta a la tuya';
  END IF;

  v_orden_id := NULLIF(p_payload->>'orden_id','')::UUID;
  v_cot_id   := NULLIF(p_payload->>'cotizacion_id','')::UUID;
  v_monto_pagado := COALESCE((p_payload->>'monto_pagado')::NUMERIC, 0);
  v_crear_abono := COALESCE((p_payload->>'crear_abono')::BOOLEAN, false);
  v_metodo := COALESCE(p_payload->>'metodo_pago', 'efectivo');

  IF v_monto_pagado < 0 THEN
    RAISE EXCEPTION 'El monto pagado no puede ser negativo';
  END IF;

  -- Pertenencia de sede de la OT y la cotización vinculadas.
  IF v_orden_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM ordenes_servicio
      WHERE id = v_orden_id AND (v_rol = 'Admin' OR sede_id = v_my_sede)
    ) THEN
      RAISE EXCEPTION 'La OT vinculada no existe o es de otra sede';
    END IF;
  END IF;
  IF v_cot_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM cotizaciones
      WHERE id = v_cot_id AND (v_rol = 'Admin' OR sede_id = v_my_sede)
    ) THEN
      RAISE EXCEPTION 'La cotización vinculada no existe o es de otra sede';
    END IF;
  END IF;

  -- IVA configurable pero acotado.
  v_iva := COALESCE((p_payload->>'iva_pct')::NUMERIC, 19);
  IF v_iva < 0 OR v_iva > 100 THEN
    RAISE EXCEPTION 'El IVA debe estar entre 0 y 100';
  END IF;

  -- Subtotal server-authoritative: con ítems = suma cantidad*precio_unitario;
  -- sin ítems es un recibo de texto libre y se acepta el monto manual.
  v_has_items := (p_payload ? 'items')
    AND jsonb_typeof(p_payload->'items') = 'array'
    AND jsonb_array_length(p_payload->'items') > 0;

  IF v_has_items THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
      v_item_cant   := COALESCE((v_item->>'cantidad')::NUMERIC, 1);
      v_item_precio := COALESCE((v_item->>'precio_unitario')::NUMERIC, 0);
      v_subtotal := v_subtotal + v_item_cant * v_item_precio;
    END LOOP;
  ELSE
    v_subtotal := COALESCE((p_payload->>'subtotal')::NUMERIC, 0);
  END IF;
  IF v_subtotal < 0 THEN
    RAISE EXCEPTION 'El subtotal no puede ser negativo';
  END IF;

  v_total := v_subtotal * (1 + v_iva / 100);

  -- Abonos previos server-authoritative: suma real de la OT.
  IF v_orden_id IS NOT NULL THEN
    SELECT COALESCE(SUM(monto), 0) INTO v_abonos_previos
      FROM abonos WHERE orden_id = v_orden_id;
  END IF;

  v_saldo := v_total - v_abonos_previos - v_monto_pagado;

  INSERT INTO recibos (
    sede_id, cliente_nombre, cliente_nit, concepto,
    cotizacion_id, orden_id, subtotal, iva_pct, total,
    abonos_previos, monto_pagado, saldo, metodo_pago,
    cuenta_bancaria_id, observaciones, recibido_por
  ) VALUES (
    v_sede,
    p_payload->>'cliente_nombre',
    NULLIF(TRIM(p_payload->>'cliente_nit'),''),
    p_payload->>'concepto',
    v_cot_id, v_orden_id,
    v_subtotal, v_iva, v_total,
    v_abonos_previos, v_monto_pagado, v_saldo,
    v_metodo,
    NULLIF(p_payload->>'cuenta_bancaria_id','')::BIGINT,
    NULLIF(TRIM(p_payload->>'observaciones'),''),
    v_uid
  ) RETURNING id, numero INTO v_recibo_id, v_numero;

  -- Ítems (desde cotización): subtotal de línea recalculado.
  IF v_has_items THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
      v_item_cant   := COALESCE((v_item->>'cantidad')::NUMERIC, 1);
      v_item_precio := COALESCE((v_item->>'precio_unitario')::NUMERIC, 0);
      INSERT INTO detalle_recibo (recibo_id, descripcion, cantidad, precio_unitario, subtotal)
      VALUES (
        v_recibo_id,
        v_item->>'descripcion',
        v_item_cant, v_item_precio,
        v_item_cant * v_item_precio
      );
    END LOOP;
  END IF;

  -- Abono automático en la OT vinculada, con guard suave anti-duplicado.
  -- Si ya existe un abono idéntico (misma OT, mismo monto, mismo método)
  -- creado en los últimos 10 minutos, NO se vuelve a insertar: el default
  -- OFF del frontend deja de ser la única barrera contra el doble conteo.
  IF v_orden_id IS NOT NULL AND v_monto_pagado > 0 AND v_crear_abono THEN
    IF EXISTS (
      SELECT 1 FROM abonos
      WHERE orden_id = v_orden_id
        AND monto = v_monto_pagado
        AND metodo_pago = v_metodo
        AND created_at >= now() - INTERVAL '10 minutes'
    ) THEN
      v_abono_omitido := true;
    ELSE
      INSERT INTO abonos (orden_id, monto, metodo_pago, observaciones, registrado_por)
      VALUES (v_orden_id, v_monto_pagado, v_metodo,
              'Generado por recibo #' || v_numero, v_uid)
      RETURNING id INTO v_abono_id;
      UPDATE recibos SET abono_id = v_abono_id WHERE id = v_recibo_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'recibo_id', v_recibo_id,
    'numero', v_numero,
    'abono_omitido', v_abono_omitido
  );
END $function$;
