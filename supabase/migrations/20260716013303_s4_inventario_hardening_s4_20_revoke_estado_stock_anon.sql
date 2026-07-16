-- S4-20: quitar EXECUTE de fn_actualizar_estado_stock a anon y PUBLIC (dejar authenticated/service_role)
REVOKE EXECUTE ON FUNCTION public.fn_actualizar_estado_stock(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_actualizar_estado_stock(uuid, text) FROM PUBLIC;
