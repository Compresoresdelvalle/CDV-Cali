-- QA Campaña — Fase 1 (Base de datos): hardening de seguridad
--
-- Corrige hallazgos del linter de seguridad de Supabase (get_advisors):
--  1. Vistas SECURITY DEFINER → security_invoker (respetan la RLS del usuario).
--  2. Funciones con search_path mutable → search_path fijo.
--  3. Funciones sin validación de auth expuestas al rol anon → REVOKE de anon.
--
-- No incluye: la consolidación de políticas RLS solapadas, los índices de FK,
-- ni el REVOKE masivo de anon en RPCs que ya validan auth.uid() — esos quedan
-- en el backlog (requieren análisis de blast-radius por dependencias de RLS).

-- ── 1. Vistas: SECURITY DEFINER → security_invoker ──────────────────────
-- Estas vistas aplicaban los permisos del creador, saltándose la RLS del
-- usuario que consulta. security_invoker hace que respeten la RLS del caller.
ALTER VIEW public.v_conteo_ciclico SET (security_invoker = true);
ALTER VIEW public.v_producto_ultimo_proveedor SET (security_invoker = true);

-- ── 2. search_path fijo en funciones SECURITY DEFINER ───────────────────
-- Un search_path mutable permite secuestrar la resolución de objetos.
ALTER FUNCTION public.trg_no_modify_cierre() SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_prevent_delete() SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_orden_validar_transicion() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_set_updated_at_config() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_set_updated_by_auth() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_validate_parametro_value() SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_orden_validar_anticipo() SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_cotizacion_validar_transicion() SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_compra_recibida_upsert_proveedor() SET search_path = public, pg_temp;

-- ── 3. Cerrar acceso anon a funciones sin validación de auth ────────────
-- fn_alertas_rotacion y fn_marcar_cotizaciones_vencidas NO validan auth.uid()
-- internamente y eran ejecutables por el rol anon (sin sesión). Las demás
-- RPCs de escritura sí validan auth.uid() (verificado) — quedan en backlog.
REVOKE EXECUTE ON FUNCTION public.fn_alertas_rotacion(integer, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_alertas_rotacion(integer, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_marcar_cotizaciones_vencidas() FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_marcar_cotizaciones_vencidas() TO authenticated;
