-- A6 [P2] Endurecer fn_validate_parametro_value: la validacion de rango solo corria
-- dentro de IF tipo='int'. Ahora cubre 'int' y 'decimal' por igual (sobre value::numeric)
-- y valida 'bool' contra ('true','false'). No cambia valores existentes (tabla vacia hoy).
CREATE OR REPLACE FUNCTION public.fn_validate_parametro_value()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_num NUMERIC;
BEGIN
  IF NEW.tipo IN ('int','decimal') THEN
    IF NEW.tipo = 'int' THEN
      BEGIN v_num := NEW.value::int;
      EXCEPTION WHEN others THEN RAISE EXCEPTION 'value de % no es entero válido', NEW.key;
      END;
    ELSE
      BEGIN v_num := NEW.value::numeric;
      EXCEPTION WHEN others THEN RAISE EXCEPTION 'value de % no es decimal válido', NEW.key;
      END;
    END IF;
    -- bounds por key (aplican a int y decimal por igual)
    IF NEW.key = 'iva_pct' AND (v_num < 0 OR v_num > 100) THEN
      RAISE EXCEPTION 'iva_pct debe estar entre 0 y 100 (recibido %)', v_num;
    ELSIF NEW.key LIKE 'dias_%' AND (v_num <= 0 OR v_num > 3650) THEN
      RAISE EXCEPTION '% debe estar entre 1 y 3650 días (recibido %)', NEW.key, v_num;
    ELSIF NEW.key = 'validez_cotizacion_dias' AND (v_num <= 0 OR v_num > 365) THEN
      RAISE EXCEPTION 'validez_cotizacion_dias debe estar entre 1 y 365 (recibido %)', v_num;
    END IF;
  ELSIF NEW.tipo = 'bool' THEN
    IF NEW.value NOT IN ('true','false') THEN
      RAISE EXCEPTION 'value de % debe ser true o false (recibido %)', NEW.key, NEW.value;
    END IF;
  END IF;
  RETURN NEW;
END; $function$;
