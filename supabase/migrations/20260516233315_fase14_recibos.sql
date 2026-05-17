-- ============================================================================
-- Fase 14 — Recibos manuales
-- ============================================================================

-- 1) Tabla recibos
CREATE TABLE IF NOT EXISTS recibos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero SERIAL,
  fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
  sede_id TEXT NOT NULL REFERENCES sedes(id),
  cliente_nombre TEXT NOT NULL CHECK (length(trim(cliente_nombre)) > 0),
  cliente_nit TEXT,
  concepto TEXT NOT NULL CHECK (length(trim(concepto)) > 0),
  cotizacion_id UUID REFERENCES cotizaciones(id),
  orden_id UUID REFERENCES ordenes_servicio(id),
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  iva_pct NUMERIC(5,2) NOT NULL DEFAULT 19 CHECK (iva_pct >= 0 AND iva_pct <= 100),
  total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  abonos_previos NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (abonos_previos >= 0),
  monto_pagado NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monto_pagado >= 0),
  saldo NUMERIC(12,2) NOT NULL DEFAULT 0,
  metodo_pago TEXT NOT NULL CHECK (metodo_pago IN ('efectivo','transferencia','tarjeta','otro')),
  cuenta_bancaria_id BIGINT REFERENCES cuentas_bancarias(id),
  observaciones TEXT,
  recibido_por UUID NOT NULL REFERENCES usuarios(id),
  abono_id BIGINT REFERENCES abonos(id),
  anulado BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_recibos_fecha ON recibos(fecha DESC);
CREATE INDEX IF NOT EXISTS ix_recibos_orden ON recibos(orden_id) WHERE orden_id IS NOT NULL;

-- 2) detalle_recibo (opcional — solo cuando se crea desde cotización)
CREATE TABLE IF NOT EXISTS detalle_recibo (
  id BIGSERIAL PRIMARY KEY,
  recibo_id UUID NOT NULL REFERENCES recibos(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  cantidad NUMERIC(12,2) NOT NULL DEFAULT 1,
  precio_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_detalle_recibo ON detalle_recibo(recibo_id);

-- 3) RLS
ALTER TABLE recibos ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_recibo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recibos_rw" ON recibos FOR ALL TO authenticated
  USING (
    (SELECT get_my_rol()) IN ('Admin','Vendedor')
    AND ((SELECT get_my_rol()) = 'Admin' OR sede_id = (SELECT get_my_sede_id()))
  )
  WITH CHECK (
    (SELECT get_my_rol()) IN ('Admin','Vendedor')
    AND ((SELECT get_my_rol()) = 'Admin' OR sede_id = (SELECT get_my_sede_id()))
  );

CREATE POLICY "detalle_recibo_rw" ON detalle_recibo FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM recibos r WHERE r.id = detalle_recibo.recibo_id
      AND ((SELECT get_my_rol()) = 'Admin' OR r.sede_id = (SELECT get_my_sede_id()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM recibos r WHERE r.id = detalle_recibo.recibo_id
      AND ((SELECT get_my_rol()) = 'Admin' OR r.sede_id = (SELECT get_my_sede_id()))
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON recibos, detalle_recibo TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE recibos_numero_seq, detalle_recibo_id_seq TO authenticated;

-- 4) RPC: registrar recibo (+ abono opcional)
CREATE OR REPLACE FUNCTION fn_registrar_recibo(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT; v_sede TEXT;
  v_recibo_id UUID; v_numero INT;
  v_orden_id UUID;
  v_monto_pagado NUMERIC;
  v_crear_abono BOOLEAN;
  v_metodo TEXT;
  v_abono_id BIGINT;
  v_item JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT, sede_id INTO v_rol, v_sede FROM usuarios WHERE id = v_uid;
  IF v_rol NOT IN ('Admin','Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para crear recibos';
  END IF;

  IF COALESCE(TRIM(p_payload->>'cliente_nombre'),'') = '' THEN
    RAISE EXCEPTION 'El nombre del cliente es obligatorio';
  END IF;
  IF COALESCE(TRIM(p_payload->>'concepto'),'') = '' THEN
    RAISE EXCEPTION 'El concepto es obligatorio';
  END IF;

  v_orden_id := NULLIF(p_payload->>'orden_id','')::UUID;
  v_monto_pagado := COALESCE((p_payload->>'monto_pagado')::NUMERIC, 0);
  v_crear_abono := COALESCE((p_payload->>'crear_abono')::BOOLEAN, false);
  v_metodo := COALESCE(p_payload->>'metodo_pago', 'efectivo');

  INSERT INTO recibos (
    sede_id, cliente_nombre, cliente_nit, concepto,
    cotizacion_id, orden_id, subtotal, iva_pct, total,
    abonos_previos, monto_pagado, saldo, metodo_pago,
    cuenta_bancaria_id, observaciones, recibido_por
  ) VALUES (
    COALESCE(NULLIF(p_payload->>'sede_id',''), v_sede),
    p_payload->>'cliente_nombre',
    NULLIF(TRIM(p_payload->>'cliente_nit'),''),
    p_payload->>'concepto',
    NULLIF(p_payload->>'cotizacion_id','')::UUID,
    v_orden_id,
    COALESCE((p_payload->>'subtotal')::NUMERIC, 0),
    COALESCE((p_payload->>'iva_pct')::NUMERIC, 19),
    COALESCE((p_payload->>'total')::NUMERIC, 0),
    COALESCE((p_payload->>'abonos_previos')::NUMERIC, 0),
    v_monto_pagado,
    COALESCE((p_payload->>'saldo')::NUMERIC, 0),
    v_metodo,
    NULLIF(p_payload->>'cuenta_bancaria_id','')::BIGINT,
    NULLIF(TRIM(p_payload->>'observaciones'),''),
    v_uid
  ) RETURNING id, numero INTO v_recibo_id, v_numero;

  -- Items opcionales (desde cotización)
  IF p_payload ? 'items' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
      INSERT INTO detalle_recibo (recibo_id, descripcion, cantidad, precio_unitario, subtotal)
      VALUES (
        v_recibo_id,
        v_item->>'descripcion',
        COALESCE((v_item->>'cantidad')::NUMERIC, 1),
        COALESCE((v_item->>'precio_unitario')::NUMERIC, 0),
        COALESCE((v_item->>'subtotal')::NUMERIC, 0)
      );
    END LOOP;
  END IF;

  -- Abono automático en la OT vinculada
  IF v_orden_id IS NOT NULL AND v_monto_pagado > 0 AND v_crear_abono THEN
    INSERT INTO abonos (orden_id, monto, metodo_pago, observaciones, registrado_por)
    VALUES (v_orden_id, v_monto_pagado, v_metodo,
            'Generado por recibo #' || v_numero, v_uid)
    RETURNING id INTO v_abono_id;
    UPDATE recibos SET abono_id = v_abono_id WHERE id = v_recibo_id;
  END IF;

  RETURN jsonb_build_object('recibo_id', v_recibo_id, 'numero', v_numero);
END $$;

REVOKE EXECUTE ON FUNCTION fn_registrar_recibo(JSONB) FROM anon, public;
GRANT EXECUTE ON FUNCTION fn_registrar_recibo(JSONB) TO authenticated;

-- 5) RPC: anular recibo (revierte el abono si lo creó)
CREATE OR REPLACE FUNCTION fn_anular_recibo(p_recibo_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT;
  v_recibo RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol NOT IN ('Admin','Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para anular recibos';
  END IF;

  SELECT * INTO v_recibo FROM recibos WHERE id = p_recibo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recibo no encontrado'; END IF;
  IF v_recibo.anulado THEN RAISE EXCEPTION 'El recibo ya está anulado'; END IF;

  -- Marcar anulado y limpiar la referencia al abono en el mismo UPDATE,
  -- para no violar el FK recibos_abono_id_fkey al borrar el abono.
  UPDATE recibos SET anulado = true, abono_id = NULL WHERE id = p_recibo_id;

  -- Si el recibo generó un abono en una OT, revertirlo
  IF v_recibo.abono_id IS NOT NULL THEN
    DELETE FROM abonos WHERE id = v_recibo.abono_id;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION fn_anular_recibo(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION fn_anular_recibo(UUID) TO authenticated;
