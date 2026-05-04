-- ============================================================================
-- Fase 9 — Configuración General (cuentas bancarias, parámetros, checklist)
-- Aplicada vía MCP el 2026-05-03
-- ============================================================================

-- 1) cuentas_bancarias
CREATE TABLE IF NOT EXISTS cuentas_bancarias (
  id          BIGSERIAL PRIMARY KEY,
  banco       TEXT NOT NULL CHECK (length(trim(banco)) > 0),
  tipo        TEXT NOT NULL CHECK (tipo IN ('Ahorros','Corriente','Digital')),
  numero      TEXT NOT NULL CHECK (length(trim(numero)) > 0),
  titular     TEXT,
  marca_iva   TEXT CHECK (marca_iva IN ('con_iva','sin_iva') OR marca_iva IS NULL),
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (banco, numero)
);
CREATE INDEX IF NOT EXISTS ix_cuentas_bancarias_activo ON cuentas_bancarias(activo);

-- 2) checklist_componentes
CREATE TABLE IF NOT EXISTS checklist_componentes (
  id          BIGSERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL UNIQUE CHECK (length(trim(nombre)) > 0),
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  orden       INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_checklist_componentes_activo ON checklist_componentes(activo);

-- 3) parametros_sistema
CREATE TABLE IF NOT EXISTS parametros_sistema (
  key         TEXT PRIMARY KEY CHECK (length(trim(key)) > 0),
  value       TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('int','decimal','text','bool')),
  descripcion TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES usuarios(id)
);

-- 4) Trigger updated_at acotado
CREATE OR REPLACE FUNCTION fn_set_updated_at_config()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS tg_cuentas_bancarias_updated ON cuentas_bancarias;
CREATE TRIGGER tg_cuentas_bancarias_updated BEFORE UPDATE ON cuentas_bancarias
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at_config();
DROP TRIGGER IF EXISTS tg_checklist_componentes_updated ON checklist_componentes;
CREATE TRIGGER tg_checklist_componentes_updated BEFORE UPDATE ON checklist_componentes
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at_config();
DROP TRIGGER IF EXISTS tg_parametros_sistema_updated ON parametros_sistema;
CREATE TRIGGER tg_parametros_sistema_updated BEFORE UPDATE ON parametros_sistema
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at_config();

-- 5) RPC fn_get_parametro
CREATE OR REPLACE FUNCTION fn_get_parametro(p_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp STABLE AS $$
DECLARE v_value TEXT;
BEGIN
  SELECT value INTO v_value FROM parametros_sistema WHERE key = p_key;
  RETURN v_value;
END; $$;
REVOKE EXECUTE ON FUNCTION fn_get_parametro(TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION fn_get_parametro(TEXT) TO authenticated;

-- 6) RLS
ALTER TABLE cuentas_bancarias     ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_componentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE parametros_sistema    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_cuentas_bancarias"     ON cuentas_bancarias     FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_checklist_componentes" ON checklist_componentes FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_parametros_sistema"    ON parametros_sistema    FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin_write_cuentas_bancarias" ON cuentas_bancarias
  FOR ALL TO authenticated
  USING ((SELECT get_my_rol()) = 'Admin')
  WITH CHECK ((SELECT get_my_rol()) = 'Admin');
CREATE POLICY "admin_write_checklist_componentes" ON checklist_componentes
  FOR ALL TO authenticated
  USING ((SELECT get_my_rol()) = 'Admin')
  WITH CHECK ((SELECT get_my_rol()) = 'Admin');
CREATE POLICY "admin_write_parametros_sistema" ON parametros_sistema
  FOR ALL TO authenticated
  USING ((SELECT get_my_rol()) = 'Admin')
  WITH CHECK ((SELECT get_my_rol()) = 'Admin');

GRANT SELECT, INSERT, UPDATE, DELETE
  ON cuentas_bancarias, checklist_componentes, parametros_sistema TO authenticated;
GRANT USAGE, SELECT
  ON SEQUENCE cuentas_bancarias_id_seq, checklist_componentes_id_seq TO authenticated;

-- 7) Seeds idempotentes
INSERT INTO cuentas_bancarias (banco, tipo, numero, titular, marca_iva) VALUES
  ('Bancolombia',     'Ahorros',   'PLACEHOLDER-BCOL',  'Compresores del Valle S.A.S.', NULL),
  ('Davivienda',      'Corriente', 'PLACEHOLDER-DAV',   'Compresores del Valle S.A.S.', NULL),
  ('Nequi',           'Digital',   'PLACEHOLDER-NEQUI', 'Compresores del Valle S.A.S.', NULL),
  ('Banco de Bogotá', 'Ahorros',   'PLACEHOLDER-BBOG',  'Compresores del Valle S.A.S.', NULL)
ON CONFLICT (banco, numero) DO NOTHING;

INSERT INTO checklist_componentes (nombre, orden) VALUES
  ('Compresor',1),('Cabezote',2),('Motor',3),('Automático',4),
  ('Manómetro',5),('V. cheque',6),('V. seguridad',7),('Llave bola 1/2',8),
  ('Llave bola 1/4',9),('Llave de bola 3/8',10),('Correa',11),('Polea',12),
  ('Filtros',13),('Unidad mantenimiento',14),('Filtro trampa',15),('Tubo de carga',16),
  ('Arrancador',17),('Desfogue',18),('Motor quemado',19),('Tanque roto',20),
  ('Engrasadora',21),('Grapadora',22),('Pistola de impacto',23),('Guarda polea',24)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO parametros_sistema (key, value, tipo, descripcion) VALUES
  ('iva_pct',                  '19','int','Porcentaje de IVA en ventas/cotizaciones'),
  ('validez_cotizacion_dias',  '15','int','Días de validez por defecto de cotización'),
  ('dias_alerta_ot_abandonada','30','int','Días sin movimiento para marcar OT abandonada'),
  ('dias_garantia_venta',      '90','int','Días de garantía estándar en ventas'),
  ('dias_conteo_ciclico',      '15','int','Frecuencia (días) del conteo cíclico')
ON CONFLICT (key) DO NOTHING;
