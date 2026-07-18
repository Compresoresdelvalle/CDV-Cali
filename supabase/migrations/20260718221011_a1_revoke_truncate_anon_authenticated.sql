-- A1 [P1] Revocar TRUNCATE global de anon/authenticated + default privileges futuros.
-- TRUNCATE no dispara triggers de fila ni pasa por RLS: burla el candado append-only
-- de movimientos y borraria el libro de auditoria sin rastro. Ningun flujo legitimo
-- usa TRUNCATE (las RPC son SECURITY DEFINER). Riesgo: cero.
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
-- Tablas futuras creadas por el rol dueno de las migraciones (postgres):
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated;
