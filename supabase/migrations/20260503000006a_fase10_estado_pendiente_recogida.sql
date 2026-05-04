-- ============================================================================
-- Fase 10 — Step 1 aislado: agregar 'pendiente_recogida' al enum estado_orden
-- Aplicada vía MCP el 2026-05-03
--
-- Razón de migration separada: ALTER TYPE ADD VALUE no puede compartir
-- transacción con DML que use el nuevo valor (limitación de Postgres).
-- El resto de Fase 10 va en 20260503000007_fase10_ajustes_ot.sql
-- ============================================================================

ALTER TYPE estado_orden ADD VALUE IF NOT EXISTS 'pendiente_recogida' AFTER 'completada';
