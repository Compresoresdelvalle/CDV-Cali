-- Una tabla de respaldo quedo abierta a la anon key.
--
-- `_minmax_respaldo_20260905` se creo a mano en la sesion de min/max (no hay
-- migracion que la cree) y quedo SIN RLS, con grants de SELECT, INSERT, UPDATE
-- y DELETE para `anon` y `authenticated`. Como toda tabla de `public` sin RLS,
-- PostgREST la expone: cualquiera con la anon key —que viaja dentro del bundle
-- del frontend, o sea que es publica— podia leer, modificar o borrar sus 5.685
-- filas desde afuera de la app.
--
-- NO se borra la tabla: es un respaldo y esa decision no es de este cambio. Se
-- le pone RLS sin ninguna politica, que en Postgres significa "nadie pasa", y
-- se le quitan los grants. Queda accesible solo para `service_role` y para las
-- funciones SECURITY DEFINER, que es lo que corresponde a un respaldo.
--
-- Ojo: el event trigger que revoca TRUNCATE en tablas nuevas no cubre esto,
-- porque el problema no era TRUNCATE sino la ausencia de RLS.
--
-- Verificado despues de aplicar: 0 tablas sin RLS en public, y un usuario
-- `authenticated` recibe "permission denied" al intentar leerla.
ALTER TABLE public._minmax_respaldo_20260905 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public._minmax_respaldo_20260905 FROM anon, authenticated;


-- De paso, la tabla del panel: sus dos politicas ya son solo para
-- `authenticated` (leer todos, escribir solo Admin), asi que `anon` no pasaba.
-- Pero conservaba los grants por defecto de Supabase, y la regla del proyecto es
-- que la anon key NUNCA escribe. Se le quitan para que no dependa de que la
-- politica siga estando.
--
-- Verificado: una vendedora sigue viendo las 9 categorias (las necesita para
-- registrar un egreso) y sigue sin poder crearlas.
REVOKE ALL ON TABLE public.categorias_gasto FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.categorias_gasto TO authenticated;
