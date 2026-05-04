-- ============================================================================
-- Fase 10 fix: trigger anti-anticipo robusto
-- Aplicada vía MCP el 2026-05-04
--
-- Bug encontrado: si la OT pasaba primero a en_proceso (con autorización
-- pendiente), luego cambiaban autorización a 'autorizado', el trigger
-- original NO se disparaba porque solo validaba OLD.estado='abierta'.
-- Esto evadía la regla del cliente §2.5: "OT autorizada requiere anticipo".
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_orden_validar_anticipo()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_total NUMERIC;
BEGIN
  -- Aplica si la OT termina en estado de trabajo activo (no 'abierta') y autorizada
  IF NEW.estado_autorizacion = 'autorizado'
     AND NEW.estado IN ('en_proceso','esperando_repuesto','completada')
  THEN
    -- Solo evaluamos si el cambio actual nos lleva a este combo peligroso
    IF (OLD.estado IS DISTINCT FROM NEW.estado)
       OR (OLD.estado_autorizacion IS DISTINCT FROM NEW.estado_autorizacion)
    THEN
      SELECT COALESCE(SUM(monto),0) INTO v_total
        FROM abonos WHERE orden_id = NEW.id;
      IF v_total = 0 THEN
        RAISE EXCEPTION 'OT autorizada con trabajo iniciado requiere al menos un anticipo registrado';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
