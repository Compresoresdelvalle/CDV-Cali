-- QA Campaña — Fase 8 (Dashboard Admin + Gestión)
--
-- Hallazgo F8-02: `trg_usuarios_inmutables` hace `RETURN NEW` inmediato cuando
-- el actor es Admin, sin chequear la auto-desactivación. Un Admin podía poner
-- `activo=false` sobre su propia fila (vía el modal de edición de Usuarios o
-- la API REST directa) — si es el único Admin, deja el panel sin acceso.
-- La UI lo bloqueaba en `toggleActivo` pero NO en el modal `guardar()`.
--
-- Fix: chequear la auto-desactivación ANTES del early-return de Admin, de modo
-- que aplique a todos los roles (incluido Admin). Server-side, robusto.

CREATE OR REPLACE FUNCTION public.trg_usuarios_inmutables()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_rol_actor TEXT;
BEGIN
  -- Anti-lockout: nadie (ni un Admin) puede desactivar su propio usuario.
  IF NEW.activo = false
     AND COALESCE(OLD.activo, true) = true
     AND NEW.id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes desactivar tu propio usuario (evita el lockout del panel)';
  END IF;

  SELECT rol::TEXT INTO v_rol_actor FROM usuarios WHERE id = auth.uid();
  IF v_rol_actor = 'Admin' THEN
    RETURN NEW;  -- Admin puede cambiar todo lo demás
  END IF;
  IF NEW.rol IS DISTINCT FROM OLD.rol
     OR NEW.sede_id IS DISTINCT FROM OLD.sede_id
     OR NEW.activo IS DISTINCT FROM OLD.activo THEN
    RAISE EXCEPTION 'No tienes permiso para modificar rol, sede o estado activo';
  END IF;
  RETURN NEW;
END;
$function$;
