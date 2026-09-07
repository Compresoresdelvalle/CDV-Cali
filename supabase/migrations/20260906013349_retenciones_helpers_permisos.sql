-- Los REVOKE de la migracion anterior no quitaron nada: el EXECUTE de `anon`
-- no venia de un grant directo sino del grant por defecto a PUBLIC que Postgres
-- le pone a toda funcion nueva. Revocar solo el rol deja el de PUBLIC intacto y
-- has_function_privilege('anon', ...) sigue diciendo true.
--
-- Hay que revocar los DOS y volver a conceder explicitamente a quien si lo
-- necesita. `authenticated` lo necesita de verdad: las expresiones de las
-- columnas generadas se evaluan con los privilegios de quien hace el INSERT o
-- el UPDATE, y quien registra una venta es `authenticated`.
REVOKE EXECUTE ON FUNCTION public._fn_base_retencion_venta(numeric, numeric, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._fn_iva_venta(numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._fn_base_retencion_ot(text, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public._fn_base_retencion_venta(numeric, numeric, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._fn_iva_venta(numeric, numeric, numeric, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._fn_base_retencion_ot(text, numeric, numeric, numeric, numeric) TO authenticated, service_role;
