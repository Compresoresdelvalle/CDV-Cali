-- A2 [P1] Anti-lockout de Admin en trg_usuarios_inmutables.
-- Agrega dos guardas que aplican a TODOS (incluido Admin) ANTES del atajo Admin:
--   (a) nadie cambia su propio rol; (b) no dejar el sistema con 0 Admins activos.
-- Conserva el resto del comportamiento (no autodesactivarse; restriccion no-Admin).
CREATE OR REPLACE FUNCTION public.trg_usuarios_inmutables()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_rol_actor TEXT;
BEGIN
  IF NEW.activo = false
     AND COALESCE(OLD.activo, true) = true
     AND NEW.id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes desactivar tu propio usuario (evita el lockout del panel)';
  END IF;

  -- Guarda (a): nadie puede cambiar su propio rol (aplica tambien a Admin).
  IF NEW.rol IS DISTINCT FROM OLD.rol AND NEW.id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes cambiar tu propio rol';
  END IF;

  -- Guarda (b): no dejar el sistema sin ningun Admin activo (aplica tambien a Admin).
  IF (OLD.rol = 'Admin' AND (NEW.rol IS DISTINCT FROM 'Admin' OR NEW.activo = false))
     AND (SELECT count(*) FROM usuarios WHERE rol = 'Admin' AND activo = true AND id <> OLD.id) = 0 THEN
    RAISE EXCEPTION 'No puedes dejar el sistema sin ningun Admin activo';
  END IF;

  SELECT rol::TEXT INTO v_rol_actor FROM usuarios WHERE id = auth.uid();
  IF v_rol_actor = 'Admin' THEN
    RETURN NEW;
  END IF;
  IF NEW.rol IS DISTINCT FROM OLD.rol
     OR NEW.sede_id IS DISTINCT FROM OLD.sede_id
     OR NEW.activo IS DISTINCT FROM OLD.activo
     OR NEW.puede_descuento_alto IS DISTINCT FROM OLD.puede_descuento_alto THEN
    RAISE EXCEPTION 'No tienes permiso para modificar rol, sede, estado activo o permiso de descuento';
  END IF;
  RETURN NEW;
END;
$function$;
