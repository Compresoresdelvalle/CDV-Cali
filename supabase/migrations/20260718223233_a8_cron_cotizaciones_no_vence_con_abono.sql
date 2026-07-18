-- A8 [P2, decision del dueno] El cron de vencimiento no debe vencer cotizaciones que
-- tengan abonos del cliente. Se agrega la exclusion por abonos. Los borradores SIGUEN
-- venciendo (se conserva estado IN ('borrador','enviada')).
CREATE OR REPLACE FUNCTION public.fn_marcar_cotizaciones_vencidas()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_count INTEGER;
BEGIN
  UPDATE cotizaciones
     SET estado = 'vencida', vencida_at = now(), updated_at = now()
   WHERE estado IN ('borrador','enviada')
     AND venta_id IS NULL
     AND fecha + (vigencia_dias || ' days')::INTERVAL < now()
     AND NOT EXISTS (SELECT 1 FROM abonos_cotizacion a WHERE a.cotizacion_id = cotizaciones.id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $function$;
