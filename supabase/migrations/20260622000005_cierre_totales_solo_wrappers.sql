-- ============================================================================
-- Cierres — Hardening (auditoría): _fn_cierre_totales NO debe ser ejecutable
-- directamente por usuarios authenticated. Es un helper SECURITY DEFINER que
-- ahora devuelve detalle financiero granular (cada compra con proveedor/monto,
-- productos, cuentas). Las puertas de Admin viven en fn_preview_cierre y
-- fn_generar_cierre; llamando al helper directo se las saltaría.
-- Como los wrappers son SECURITY DEFINER (corren como owner), revocar el acceso
-- directo de authenticated NO los rompe.
-- ============================================================================

revoke execute on function public._fn_cierre_totales(date, date, text) from public, anon, authenticated;
