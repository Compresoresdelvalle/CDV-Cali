-- Restaurar la postura de permisos original de fn_convertir_cotizacion:
-- el DROP+CREATE dejó EXECUTE a PUBLIC/anon (default de Postgres/Supabase para
-- funciones nuevas). Aunque la función está protegida (auth.uid() null -> excepción),
-- se restringe a los roles que la usaban antes: authenticated y service_role.
REVOKE EXECUTE ON FUNCTION public.fn_convertir_cotizacion(uuid, text, text) FROM PUBLIC, anon;
