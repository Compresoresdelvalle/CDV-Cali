-- S6-07 (fix de verificación adversarial): productos_proveedores conservaba
-- TRUNCATE para authenticated. RLS NO aplica a TRUNCATE → cualquier usuario
-- autenticado podía vaciar la tabla completa (el histórico de último costo/
-- última compra por proveedor) pese a que RLS bloquea su INSERT/UPDATE/DELETE.
REVOKE TRUNCATE ON public.productos_proveedores FROM authenticated;
