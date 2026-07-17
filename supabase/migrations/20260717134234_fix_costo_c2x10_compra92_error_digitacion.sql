-- Corrección puntual del costo_promedio de C2X10 (CABLE ENCAUCHETADO 2X10).
--
-- Historia verificada:
--   * Compra #92 (2026-06-17, recibida por Admin Maritza): 50 uds x $11.451,50.
--     Fue un error de digitación 100x. Subió el costo de $109,60 -> $443,19
--     (queda el rastro en productos_precio_costo_log).
--   * La compra #92 se canceló, pero fn_cancelar_compra NO revirtió el costo
--     (usa un ponderado histórico con coalesce que se queda contaminado por la
--      propia compra cancelada cuando no hay otras compras recibidas).
--   * Se recapturó como la compra #106 (2026-06-18): 5.000 uds x $114,52. Su
--     actualización de costo se perdió por el bug del guard (la recibió un no-Admin,
--     corregido en 20260717035828_s8_fix_costo_guard_compras).
--
-- El costo correcto está acotado entre $109,60 (previo) y $114,52 (compra real).
-- Decisión del dueño: fijarlo en 114,52 (el costo de la compra real #106).
--
-- Se hace con UPDATE directo (no fn_editar_costo_producto, que exige auth.uid()
-- no nulo). El trigger trg_productos_log_precio_costo registra el cambio en
-- productos_precio_costo_log con usuario_id = NULL: es una corrección de sistema
-- fuera de banda, no la hizo un usuario, y así queda dicho en el rastro.

update productos
   set costo_promedio = 114.52,
       updated_at = now()
 where referencia = 'C2X10'
   and costo_promedio = 443.19;
