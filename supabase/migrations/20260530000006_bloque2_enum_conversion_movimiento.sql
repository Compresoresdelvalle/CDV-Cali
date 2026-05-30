-- ============================================================================
-- Bloque 2 — A2: nuevos valores del enum tipo_movimiento para auditar las
-- conversiones de stock venta <-> insumo.
-- DEBE ir en su PROPIA migración (transacción aislada): un valor de enum recién
-- agregado no se puede USAR en la misma transacción que lo crea. A3 (funciones
-- que insertan estos movimientos) va en una migración posterior.
-- ============================================================================

ALTER TYPE public.tipo_movimiento ADD VALUE IF NOT EXISTS 'conversion_a_insumo';
ALTER TYPE public.tipo_movimiento ADD VALUE IF NOT EXISTS 'conversion_a_venta';
