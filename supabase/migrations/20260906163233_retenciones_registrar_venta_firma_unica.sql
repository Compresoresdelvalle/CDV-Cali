-- Dos arreglos a la migracion anterior, los dos criticos.
--
-- 1. CREATE OR REPLACE con parametros nuevos NO reemplaza: crea una funcion
--    DISTINTA. Quedaron dos fn_registrar_venta, la de 12 y la de 15 argumentos,
--    y con las dos vivas PostgREST no sabe cual llamar: cada venta desde la app
--    habria fallado por ambiguedad. Se borra la vieja. Los llamados que solo
--    mandan los 12 parametros siguen sirviendo, porque los tres nuevos tienen
--    DEFAULT 0.
--
-- 2. La funcion nueva nacio con EXECUTE para PUBLIC (el grant por defecto de
--    Postgres), asi que `anon` podia registrar ventas. Es SECURITY DEFINER: se
--    salta la RLS. La vieja tenia anon = false y hay que dejar la nueva igual.
--    Ya paso lo mismo con las funciones de base gravable: en toda funcion nueva
--    hay que revocar PUBLIC *y* anon, y volver a conceder a authenticated.
DROP FUNCTION public.fn_registrar_venta(
  text, text, text, text, numeric, text, jsonb, numeric, text, numeric, numeric, jsonb);

REVOKE EXECUTE ON FUNCTION public.fn_registrar_venta(
  text, text, text, text, numeric, text, jsonb, numeric, text, numeric, numeric, jsonb,
  numeric, numeric, numeric) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_registrar_venta(
  text, text, text, text, numeric, text, jsonb, numeric, text, numeric, numeric, jsonb,
  numeric, numeric, numeric) TO authenticated, service_role;
