-- H1: la guarda anti-lockout vivia solo en un trigger BEFORE ... FOR EACH ROW,
-- cuyo SELECT count(*) no ve los cambios del mismo comando (multi-fila) ni los de
-- transacciones concurrentes en READ COMMITTED. Se agrega un CONSTRAINT TRIGGER
-- DEFERRABLE INITIALLY DEFERRED que recuenta al final de la transaccion, serializado
-- con un advisory lock para que dos transacciones no puedan intercalarse.
-- La logica del trigger BEFORE existente (no cambiar tu propio rol, no desactivarte
-- a ti mismo, restricciones para no-Admin) se conserva intacta.

CREATE OR REPLACE FUNCTION public.trg_usuarios_admin_minimo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- Serializa cualquier transaccion que toque el rol/estado de un Admin.
  PERFORM pg_advisory_xact_lock(hashtext('usuarios_admin_minimo'));

  IF (SELECT count(*) FROM public.usuarios WHERE rol = 'Admin' AND activo = true) = 0 THEN
    RAISE EXCEPTION 'No puedes dejar el sistema sin ningun Admin activo';
  END IF;

  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_usuarios_admin_minimo_upd ON public.usuarios;
CREATE CONSTRAINT TRIGGER trg_usuarios_admin_minimo_upd
AFTER UPDATE ON public.usuarios
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (OLD.rol IS DISTINCT FROM NEW.rol OR OLD.activo IS DISTINCT FROM NEW.activo)
EXECUTE FUNCTION public.trg_usuarios_admin_minimo();

DROP TRIGGER IF EXISTS trg_usuarios_admin_minimo_del ON public.usuarios;
CREATE CONSTRAINT TRIGGER trg_usuarios_admin_minimo_del
AFTER DELETE ON public.usuarios
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.trg_usuarios_admin_minimo();
