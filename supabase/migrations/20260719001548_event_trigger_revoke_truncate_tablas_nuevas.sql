-- H2: pg_default_acl tiene una entrada con owner supabase_admin para tablas en public
-- que todavia concede TRUNCATE (privilegio 'D') a anon y authenticated. Cualquier tabla
-- creada por una ruta que corra como supabase_admin (dashboard/pg-meta, extensiones)
-- nace con TRUNCATE abierto, reabriendo el hueco que cerramos.
--
-- No podemos corregir el default privilege: ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
-- falla con "permission denied to change default privileges" porque corremos como postgres.
-- Control compensatorio: event trigger que revoca TRUNCATE sobre cada tabla recien creada
-- en public. El REVOKE va envuelto en un bloque de excepcion para que un fallo NUNCA pueda
-- abortar un CREATE TABLE legitimo.

CREATE OR REPLACE FUNCTION public.et_revoke_truncate_nuevas_tablas()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT object_identity
      FROM pg_event_trigger_ddl_commands()
     WHERE command_tag = 'CREATE TABLE'
       AND schema_name = 'public'
  LOOP
    BEGIN
      EXECUTE format('REVOKE TRUNCATE ON TABLE %s FROM anon, authenticated', r.object_identity);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'No se pudo revocar TRUNCATE en %: %', r.object_identity, SQLERRM;
    END;
  END LOOP;
END;
$fn$;

DROP EVENT TRIGGER IF EXISTS et_revoke_truncate_nuevas_tablas;
CREATE EVENT TRIGGER et_revoke_truncate_nuevas_tablas
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE')
  EXECUTE FUNCTION public.et_revoke_truncate_nuevas_tablas();
