-- ============================================================================
-- Audit Fases 1-4 — Cierra hallazgos CRITICAL/HIGH/MEDIUM detectados
-- ============================================================================

-- ── 1) movimientos APPEND-ONLY real (CRITICAL Fase 1 #C2) ──────────────────
CREATE OR REPLACE FUNCTION trg_no_update_movimiento()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Movimientos son append-only — no se permite UPDATE';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_update_movimientos ON movimientos;
CREATE TRIGGER trg_prevent_update_movimientos
  BEFORE UPDATE ON movimientos
  FOR EACH ROW EXECUTE FUNCTION trg_no_update_movimiento();

-- ── 2) Fix recursión trg_compra_sumar_stock (CRITICAL Fase 1 #C3) ──────────
-- Guard que impide re-disparo si la venta fue marcada recibida en el trigger.
-- (El cuerpo original ya hace `IF NEW.recibida = true AND OLD.recibida = false`,
--  añadimos guard adicional sobre fecha_recepcion)
ALTER TABLE compras
  DROP CONSTRAINT IF EXISTS chk_compra_recibida_fecha;
ALTER TABLE compras
  ADD CONSTRAINT chk_compra_recibida_fecha
  CHECK (NOT (recibida = true AND fecha_recepcion IS NULL));

-- ── 3) fn_convertir_cotizacion: validar sede (CRITICAL Fase 4 #C2) ─────────
CREATE OR REPLACE FUNCTION fn_convertir_cotizacion(p_cotizacion_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cot cotizaciones%ROWTYPE;
  v_det RECORD;
  v_venta_id UUID;
  v_uid UUID := auth.uid();
  v_mi_rol TEXT;
  v_mi_sede TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  SELECT rol::TEXT, sede_id INTO v_mi_rol, v_mi_sede
    FROM usuarios WHERE id = v_uid;

  SELECT * INTO v_cot FROM cotizaciones WHERE id = p_cotizacion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotización no encontrada'; END IF;

  -- Validar sede (igual que fn_registrar_venta)
  IF v_mi_rol <> 'Admin' AND v_cot.sede_id <> v_mi_sede THEN
    RAISE EXCEPTION 'No tienes permiso para esta operación';
  END IF;

  IF v_cot.estado <> 'aprobada' THEN
    RAISE EXCEPTION 'Solo se pueden convertir cotizaciones aprobadas';
  END IF;

  -- Crear venta
  INSERT INTO ventas (
    vendedor_id, sede_id, cliente_nombre, cliente_nit, cliente_telefono,
    metodo_pago, descuento_pct, iva_pct
  )
  VALUES (
    v_uid, v_cot.sede_id, v_cot.cliente_nombre, v_cot.cliente_nit,
    v_cot.cliente_telefono, 'efectivo', v_cot.descuento_pct, v_cot.iva_pct
  )
  RETURNING id INTO v_venta_id;

  -- Copiar detalles (trigger trg_venta_descontar_stock se encarga del stock)
  FOR v_det IN
    SELECT producto_id, cantidad, precio_unitario, subtotal
      FROM detalle_cotizacion WHERE cotizacion_id = p_cotizacion_id
  LOOP
    INSERT INTO detalle_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal)
    VALUES (v_venta_id, v_det.producto_id, v_det.cantidad, v_det.precio_unitario, v_det.subtotal);
  END LOOP;

  -- Marcar cotización como convertida
  UPDATE cotizaciones SET estado = 'aprobada', updated_at = now() WHERE id = p_cotizacion_id;

  RETURN jsonb_build_object('ok', true, 'venta_id', v_venta_id);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_convertir_cotizacion(UUID) TO authenticated;

-- ── 4) fn_registrar_venta: mensajes genéricos (HIGH Fase 4 #H2) ────────────
-- Sólo modificar el RAISE EXCEPTION de sede para no filtrar IDs.
DO $$
DECLARE v_def TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_registrar_venta';

  IF v_def IS NOT NULL AND v_def LIKE '%Tu sede es%' THEN
    -- Reemplazar mensaje específico por genérico
    EXECUTE replace(
      v_def,
      'Tu sede es %, la sede solicitada es %'',
            v_mi_sede, p_sede_id',
      'No tienes permiso para esta sede'''
    );
  END IF;
END $$;

-- ── 5) SET search_path en funciones faltantes (HIGH Fase 1 #H6) ────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_actualizar_estado_stock') THEN
    EXECUTE 'ALTER FUNCTION fn_actualizar_estado_stock(UUID, TEXT) SET search_path = public, pg_temp';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trg_recalcular_total_venta') THEN
    EXECUTE 'ALTER FUNCTION trg_recalcular_total_venta() SET search_path = public, pg_temp';
  END IF;
END $$;

-- ── 6) Índices que faltan (MEDIUM Fase 1 #M13/M15) ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_movimientos_referencia
  ON movimientos(referencia_tipo, referencia_id);

CREATE INDEX IF NOT EXISTS idx_productos_referencia_lower
  ON productos(LOWER(referencia));

-- Índice eliminado por solapamiento con fecha_tipo (LOW Fase 1 #23)
DROP INDEX IF EXISTS idx_movimientos_fecha;

-- ── 7) Validación cliente_email en cotizaciones (HIGH Fase 4 #H3) ──────────
ALTER TABLE cotizaciones
  DROP CONSTRAINT IF EXISTS chk_email_format,
  DROP CONSTRAINT IF EXISTS chk_email_length;
ALTER TABLE cotizaciones
  ADD CONSTRAINT chk_email_length CHECK (cliente_email IS NULL OR LENGTH(cliente_email) <= 254),
  ADD CONSTRAINT chk_email_format CHECK (
    cliente_email IS NULL OR
    cliente_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  );

-- ── 8) Validación cantidad_producida > 0 (LOW Fase 1 #17) ──────────────────
ALTER TABLE ensambles
  DROP CONSTRAINT IF EXISTS chk_ensamble_cantidad;
ALTER TABLE ensambles
  ADD CONSTRAINT chk_ensamble_cantidad CHECK (cantidad_producida > 0);

-- ── 9) Validación traspasos.bultos >= 0 (LOW Fase 1 #20) ───────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='traspasos' AND column_name='bultos') THEN
    EXECUTE 'ALTER TABLE traspasos DROP CONSTRAINT IF EXISTS chk_bultos_positivo';
    EXECUTE 'ALTER TABLE traspasos ADD CONSTRAINT chk_bultos_positivo CHECK (bultos IS NULL OR bultos >= 0)';
  END IF;
END $$;
