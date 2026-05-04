-- ============================================================================
-- Fase 9 audit fixes — aplicado vía MCP el 2026-05-03
-- 1) trigger updated_by = auth.uid() en parametros_sistema (anti-spoof)
-- 2) fn_get_parametro: SECURITY INVOKER (RLS ya permite SELECT)
-- 3) CHECK de bounds razonables (validación servidor)
-- ============================================================================

-- 1) Trigger anti-spoof updated_by
CREATE OR REPLACE FUNCTION fn_set_updated_by_auth()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS tg_parametros_sistema_set_updated_by ON parametros_sistema;
CREATE TRIGGER tg_parametros_sistema_set_updated_by
  BEFORE INSERT OR UPDATE ON parametros_sistema
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_by_auth();

-- 2) fn_get_parametro a SECURITY INVOKER (defensa en profundidad — RLS ya cubre)
CREATE OR REPLACE FUNCTION fn_get_parametro(p_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp STABLE AS $$
DECLARE v_value TEXT;
BEGIN
  SELECT value INTO v_value FROM parametros_sistema WHERE key = p_key;
  RETURN v_value;
END; $$;

-- 3) Bounds servidor en parametros_sistema
CREATE OR REPLACE FUNCTION fn_validate_parametro_value()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_int INTEGER;
BEGIN
  IF NEW.tipo = 'int' THEN
    BEGIN v_int := NEW.value::int;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'value de % no es entero válido', NEW.key;
    END;
    IF NEW.key = 'iva_pct' AND (v_int < 0 OR v_int > 100) THEN
      RAISE EXCEPTION 'iva_pct debe estar entre 0 y 100 (recibido %)', v_int;
    ELSIF NEW.key LIKE 'dias_%' AND (v_int <= 0 OR v_int > 3650) THEN
      RAISE EXCEPTION '% debe estar entre 1 y 3650 días (recibido %)', NEW.key, v_int;
    ELSIF NEW.key = 'validez_cotizacion_dias' AND (v_int <= 0 OR v_int > 365) THEN
      RAISE EXCEPTION 'validez_cotizacion_dias debe estar entre 1 y 365 (recibido %)', v_int;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS tg_parametros_sistema_validate ON parametros_sistema;
CREATE TRIGGER tg_parametros_sistema_validate
  BEFORE INSERT OR UPDATE ON parametros_sistema
  FOR EACH ROW EXECUTE FUNCTION fn_validate_parametro_value();
