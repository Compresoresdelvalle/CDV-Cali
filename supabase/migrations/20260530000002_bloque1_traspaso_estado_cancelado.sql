-- ============================================================================
-- Bloque 1 — #5 Cancelar traspaso (parte 2a: valor de enum)
-- ADVERTENCIA: ALTER TYPE ... ADD VALUE debe ir en su PROPIA transacción y el
-- nuevo valor no puede usarse hasta que esa transacción haga COMMIT. Por eso
-- esta migración está SEPARADA de la que crea el trigger/función (2b).
-- ============================================================================

ALTER TYPE public.estado_traspaso ADD VALUE IF NOT EXISTS 'cancelado';
