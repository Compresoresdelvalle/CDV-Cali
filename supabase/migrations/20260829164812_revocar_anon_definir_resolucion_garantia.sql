-- Supabase concede EXECUTE a `anon` por defecto a toda función nueva en public.
-- REVOKE ... FROM PUBLIC no lo quita, porque el de `anon` es un grant explícito.
-- Regla del proyecto: la anon key NUNCA escribe; solo `authenticated` con JWT.
-- (La función ya rechazaba a un anónimo con 'Usuario no autenticado', pero el
--  endpoint no debe existir siquiera para la anon key.)
REVOKE ALL ON FUNCTION public.fn_definir_resolucion_garantia_compra(uuid, text) FROM anon;
