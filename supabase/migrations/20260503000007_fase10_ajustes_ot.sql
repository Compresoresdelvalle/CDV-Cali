-- ============================================================================
-- Fase 10 — Ajustes Órdenes de Trabajo (OT)
-- Aplicada vía MCP el 2026-05-03
--
-- Step 1 (ALTER TYPE estado_orden ADD VALUE 'pendiente_recogida') aplicado
-- en la migration ANTERIOR para evitar el error de PG: el nuevo valor del
-- enum no se puede usar en la misma transacción donde se agrega.
-- ============================================================================

-- 1) Agregar valor al enum (en migration separada — referencia)
-- ALTER TYPE estado_orden ADD VALUE IF NOT EXISTS 'pendiente_recogida' AFTER 'completada';

-- 2) Columnas nuevas en ordenes_servicio
ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS estado_autorizacion TEXT
    CHECK (estado_autorizacion IN ('pendiente','autorizado','no_autorizado'))
    DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS valor_revision NUMERIC(12,2)
    CHECK (valor_revision IS NULL OR valor_revision >= 0),
  ADD COLUMN IF NOT EXISTS fecha_alerta_30_dias TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pendiente_recogida_at TIMESTAMPTZ;

-- 3) ot_checklist (M2M con catálogo de F9)
CREATE TABLE IF NOT EXISTS ot_checklist (
  id            BIGSERIAL PRIMARY KEY,
  orden_id      UUID NOT NULL REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  componente_id BIGINT NOT NULL REFERENCES checklist_componentes(id) ON DELETE RESTRICT,
  marcado       BOOLEAN NOT NULL DEFAULT false,
  observacion   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (orden_id, componente_id)
);
CREATE INDEX IF NOT EXISTS ix_ot_checklist_orden ON ot_checklist(orden_id);

-- 4) abonos
CREATE TABLE IF NOT EXISTS abonos (
  id             BIGSERIAL PRIMARY KEY,
  orden_id       UUID NOT NULL REFERENCES ordenes_servicio(id) ON DELETE RESTRICT,
  fecha          TIMESTAMPTZ NOT NULL DEFAULT now(),
  monto          NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  metodo_pago    TEXT NOT NULL CHECK (metodo_pago IN ('efectivo','transferencia','tarjeta','otro')),
  observaciones  TEXT,
  registrado_por UUID NOT NULL REFERENCES usuarios(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_abonos_orden ON abonos(orden_id);
CREATE INDEX IF NOT EXISTS ix_abonos_fecha ON abonos(fecha DESC);

-- 5) Vínculo OT → Cotización
ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS ot_id UUID REFERENCES ordenes_servicio(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_cotizaciones_ot ON cotizaciones(ot_id);

-- 6) RLS
ALTER TABLE ot_checklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE abonos       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ot_checklist_rw" ON ot_checklist;
CREATE POLICY "ot_checklist_rw" ON ot_checklist FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ordenes_servicio o
     WHERE o.id = ot_checklist.orden_id
       AND ((SELECT get_my_rol()) = 'Admin' OR o.sede_id = (SELECT get_my_sede_id()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM ordenes_servicio o
     WHERE o.id = ot_checklist.orden_id
       AND ((SELECT get_my_rol()) = 'Admin' OR o.sede_id = (SELECT get_my_sede_id()))
  ));

DROP POLICY IF EXISTS "abonos_read" ON abonos;
CREATE POLICY "abonos_read" ON abonos FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ordenes_servicio o
     WHERE o.id = abonos.orden_id
       AND ((SELECT get_my_rol()) = 'Admin' OR o.sede_id = (SELECT get_my_sede_id()))
  ));

DROP POLICY IF EXISTS "abonos_write" ON abonos;
CREATE POLICY "abonos_write" ON abonos FOR ALL TO authenticated
  USING (
    (SELECT get_my_rol()) IN ('Admin','Vendedor','Tecnico')
    AND EXISTS (SELECT 1 FROM ordenes_servicio o WHERE o.id = abonos.orden_id
                 AND ((SELECT get_my_rol()) = 'Admin' OR o.sede_id = (SELECT get_my_sede_id())))
  )
  WITH CHECK (
    registrado_por = auth.uid()
    AND (SELECT get_my_rol()) IN ('Admin','Vendedor','Tecnico')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON ot_checklist, abonos TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE ot_checklist_id_seq, abonos_id_seq TO authenticated;

-- 7) Trigger: bloquea iniciar trabajo sin anticipo cuando autorizado
CREATE OR REPLACE FUNCTION trg_orden_validar_anticipo()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_total_abonos NUMERIC;
BEGIN
  IF OLD.estado = 'abierta'
     AND NEW.estado IN ('en_proceso','esperando_repuesto')
     AND NEW.estado_autorizacion = 'autorizado' THEN
    SELECT COALESCE(SUM(monto),0) INTO v_total_abonos
      FROM abonos WHERE orden_id = NEW.id;
    IF v_total_abonos = 0 THEN
      RAISE EXCEPTION 'OT autorizada requiere al menos un anticipo antes de iniciar trabajo';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS tg_orden_validar_anticipo ON ordenes_servicio;
CREATE TRIGGER tg_orden_validar_anticipo BEFORE UPDATE ON ordenes_servicio
  FOR EACH ROW EXECUTE FUNCTION trg_orden_validar_anticipo();

-- 8) Reemplazar trg_orden_validar_transicion para incluir pendiente_recogida
CREATE OR REPLACE FUNCTION trg_orden_validar_transicion()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = NEW.estado THEN RETURN NEW; END IF;
  IF OLD.estado = 'entregada' THEN
    RAISE EXCEPTION 'OT entregada es inmutable';
  END IF;
  IF NOT (
    (OLD.estado = 'abierta' AND NEW.estado IN ('en_proceso','esperando_repuesto'))
    OR (OLD.estado = 'en_proceso' AND NEW.estado IN ('esperando_repuesto','completada'))
    OR (OLD.estado = 'esperando_repuesto' AND NEW.estado IN ('en_proceso','completada'))
    OR (OLD.estado = 'completada' AND NEW.estado IN ('pendiente_recogida','entregada'))
    OR (OLD.estado = 'pendiente_recogida' AND NEW.estado = 'entregada')
  ) THEN
    RAISE EXCEPTION 'Transición ilegal de % a %', OLD.estado, NEW.estado;
  END IF;
  IF NEW.estado = 'pendiente_recogida' AND OLD.estado <> 'pendiente_recogida' THEN
    NEW.pendiente_recogida_at := now();
  END IF;
  RETURN NEW;
END; $$;

-- 9) Sembrar checklist en OTs existentes
INSERT INTO ot_checklist (orden_id, componente_id, marcado)
SELECT o.id, c.id, false
  FROM ordenes_servicio o
  CROSS JOIN checklist_componentes c
 WHERE c.activo = true
ON CONFLICT (orden_id, componente_id) DO NOTHING;

-- 10) RPC total abonos por OT
CREATE OR REPLACE FUNCTION fn_total_abonos_ot(p_orden_id UUID)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(SUM(monto), 0) FROM abonos WHERE orden_id = p_orden_id;
$$;
REVOKE EXECUTE ON FUNCTION fn_total_abonos_ot(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION fn_total_abonos_ot(UUID) TO authenticated;

-- 11) View OTs con alerta 30 días (security_invoker para respetar RLS)
CREATE OR REPLACE VIEW v_ot_alertas_30_dias
WITH (security_invoker = true) AS
SELECT o.*,
       (now() - o.fecha) > make_interval(days := COALESCE(fn_get_parametro('dias_alerta_ot_abandonada')::int, 30)) AS supera_30_dias,
       fn_total_abonos_ot(o.id) AS total_abonado
  FROM ordenes_servicio o
 WHERE o.estado = 'completada'
   AND (now() - o.fecha) > make_interval(days := COALESCE(fn_get_parametro('dias_alerta_ot_abandonada')::int, 30));
GRANT SELECT ON v_ot_alertas_30_dias TO authenticated;
