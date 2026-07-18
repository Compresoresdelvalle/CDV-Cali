-- TAREA A (P0): Blindar garantias_venta y detalle_garantia_venta.
-- Hoy tenian GRANT INSERT/UPDATE/DELETE/TRUNCATE para authenticated y anon,
-- permitiendo a un Vendedor crear/cerrar/borrar garantias por REST saltandose
-- fn_abrir_garantia_venta / fn_anular_garantia_venta.
-- Se replica el patron ya vigente en garantias_compra: se quitan los GRANT de
-- escritura (queda SELECT). Las policies de escritura (garventa_insert/update/delete,
-- detgarventa_insert/update/delete) se DEJAN intactas pero quedan INERTES: una
-- policy RLS es inalcanzable sin el GRANT de tabla. Esto espeja exactamente a
-- garantias_compra, que conserva sus policies garcompra_* sin GRANT.
-- Toda escritura pasa por las RPC SECURITY DEFINER (owner=postgres), no afectadas.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.garantias_venta        FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.detalle_garantia_venta FROM authenticated, anon;
