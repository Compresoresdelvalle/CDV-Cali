-- Cierra los RPC nuevos a `anon`, como el resto del proyecto.
--
-- `REVOKE ... FROM anon` no bastaba: PostgreSQL concede EXECUTE a PUBLIC por
-- defecto al crear una funcion, y `anon` hereda de PUBLIC. Revocarle a `anon`
-- un permiso que en realidad tiene por PUBLIC no hace nada, y
-- has_function_privilege('anon', ...) seguia devolviendo true.
--
-- El resto de RPC del proyecto (fn_registrar_venta, fn_registrar_compra,
-- fn_registrar_pago_cuenta, fn_prestar_herramientas_lote) ya estaban bien; estos
-- cuatro se habian quedado por fuera de la convencion.
--
-- Es defensa en profundidad, no un agujero abierto: sin sesion, auth.uid() es
-- null y las funciones cortan con "Sesion no valida". Pero la regla del
-- proyecto es que la clave anon nunca toca escrituras, y se cumple o no se
-- cumple.

REVOKE ALL ON FUNCTION public.fn_definir_minmax(uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_definir_minmax(uuid, text, integer, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_aplicar_minmax(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_aplicar_minmax(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_sugerir_minmax(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugerir_minmax(integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_recalcular_abc(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_recalcular_abc(integer) TO authenticated;

-- El nucleo del ABC no se llama nunca desde el cliente: solo desde
-- fn_recalcular_abc (que valida Admin) y desde el cron, que corre como
-- `postgres` y por eso no le afecta el revoke.
REVOKE ALL ON FUNCTION public._fn_recalcular_abc_core(integer) FROM PUBLIC, anon, authenticated;
