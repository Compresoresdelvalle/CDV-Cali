-- S8 Ensambles: blindaje REST. Toda escritura pasa por las RPCs SECURITY DEFINER
-- (fn_crear_ensamble / fn_ensamble_receta / fn_ensamble_estado / fn_eliminar_ensamble).
-- SELECT se conserva (las policies ens_select / de_select siguen aplicando por RLS).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.ensambles FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.detalle_ensamble FROM authenticated, anon;
