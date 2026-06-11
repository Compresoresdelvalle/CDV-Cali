-- MEDIO (auditoría 2026-06-09, M8): la máquina de estados en_proceso→terminado→
-- completado no estaba protegida en BD. ens_update solo exige completado=false y
-- actor válido (no exige terminado=true), y trg_ensamble_stock dispara la producción
-- con la sola condición OLD.completado=false→NEW.completado=true, sin mirar
-- NEW.terminado. El control "primero el técnico marca terminado, luego se completa"
-- vivía solo en el frontend (puedeCompletar = terminado && !completado), así que por
-- API un creador/vendedor podía completar saltándose el visto bueno del técnico.
--
-- Fix: trigger BEFORE UPDATE que rechaza completar (false→true) si terminado=false.

create or replace function public.trg_ensamble_terminado_antes_completar()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
BEGIN
  IF NEW.completado = true
     AND COALESCE(OLD.completado, false) = false
     AND COALESCE(NEW.terminado, false) = false THEN
    RAISE EXCEPTION 'No se puede completar un ensamble que el técnico aún no marcó como terminado';
  END IF;
  RETURN NEW;
END;
$function$;

drop trigger if exists trg_before_update_ensamble_completar on public.ensambles;
create trigger trg_before_update_ensamble_completar
  before update on public.ensambles
  for each row
  execute function public.trg_ensamble_terminado_antes_completar();
