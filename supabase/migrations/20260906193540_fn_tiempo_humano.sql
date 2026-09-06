-- `age()` devuelve '00:12:34' y nadie lee la hora asi. Los mensajes que ve un
-- operario en el mostrador dicen "hace 12 minutos".
CREATE OR REPLACE FUNCTION public.fn_tiempo_humano(p_desde timestamptz)
RETURNS text LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN p_desde IS NULL THEN 'un momento'
    WHEN EXTRACT(EPOCH FROM (now() - p_desde)) < 60 THEN 'menos de un minuto'
    WHEN EXTRACT(EPOCH FROM (now() - p_desde)) < 3600
      THEN (EXTRACT(EPOCH FROM (now() - p_desde))/60)::int || ' minuto'
           || CASE WHEN (EXTRACT(EPOCH FROM (now() - p_desde))/60)::int = 1 THEN '' ELSE 's' END
    WHEN EXTRACT(EPOCH FROM (now() - p_desde)) < 86400
      THEN (EXTRACT(EPOCH FROM (now() - p_desde))/3600)::int || ' hora'
           || CASE WHEN (EXTRACT(EPOCH FROM (now() - p_desde))/3600)::int = 1 THEN '' ELSE 's' END
    ELSE (EXTRACT(EPOCH FROM (now() - p_desde))/86400)::int || ' dia'
         || CASE WHEN (EXTRACT(EPOCH FROM (now() - p_desde))/86400)::int = 1 THEN '' ELSE 's' END
  END;
$$;

REVOKE ALL ON FUNCTION public.fn_tiempo_humano(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tiempo_humano(timestamptz) TO authenticated;
