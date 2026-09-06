-- Los advisors marcaron las tres funciones con search_path mutable. Sin fijarlo,
-- quien las llama podria anteponer un esquema propio y hacer que `round` o la
-- llamada anidada resuelvan a otra cosa. En funciones que deciden cuanta plata
-- se retiene eso no se deja abierto.
--
-- search_path vacio y todo calificado: pg_catalog se busca siempre de forma
-- implicita, asi que `round`, `least`, `greatest` y `coalesce` siguen
-- resolviendo, y la llamada anidada ya venia con `public.` delante.
--
-- Se usa ALTER y no CREATE OR REPLACE a proposito: Postgres bloquea reemplazar
-- una funcion de la que dependen columnas generadas, y estas tres ya sostienen
-- las ocho de `ventas` y `ordenes_servicio`. ALTER ... SET no toca el cuerpo,
-- asi que los valores ya almacenados siguen siendo los mismos. Verificado: los
-- tres calculos directos y las columnas generadas de una venta y una OT dan
-- exactamente lo mismo despues del cambio.
ALTER FUNCTION public._fn_base_retencion_venta(numeric, numeric, numeric) SET search_path = '';
ALTER FUNCTION public._fn_iva_venta(numeric, numeric, numeric, numeric) SET search_path = '';
ALTER FUNCTION public._fn_base_retencion_ot(text, numeric, numeric, numeric, numeric) SET search_path = '';
