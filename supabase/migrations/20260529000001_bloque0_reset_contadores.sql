-- =====================================================================
-- BLOQUE 0 #1 — Reset de contadores de secuencia
-- Fecha: 2026-05-29
--
-- Las secuencias quedaron infladas tras borrar los datos de prueba (la
-- numeración no se reseteó). Este script renumera los documentos REALES
-- existentes empezando en 1 (por orden cronológico) y deja cada secuencia
-- lista para continuar desde el siguiente número.
--
-- Seguro: las tablas se relacionan por id (uuid), no por numero. Cambiar
-- numero NO rompe ninguna relación. Reversible con:
--   supabase/backups/20260529_bloque0_reset_contadores_RESTORE.sql
--
-- Alcance: ventas, cotizaciones, compras, traspasos, ordenes_servicio,
-- devoluciones, ensambles, recibos.
--
-- EXCLUIDO: cierres. La tabla cierres es INMUTABLE por diseño contable
-- (trigger trg_no_modify_cierre bloquea UPDATE, igual que movimientos).
-- Su único registro queda en #8 y su secuencia continúa en #9.
-- =====================================================================

-- ---------- RENUMERAR DOCUMENTOS EXISTENTES (1..N por fecha) ----------

WITH ord AS (
  SELECT id, row_number() OVER (ORDER BY created_at, numero) AS rn FROM ventas
)
UPDATE ventas v SET numero = ord.rn FROM ord WHERE v.id = ord.id;

WITH ord AS (
  SELECT id, row_number() OVER (ORDER BY created_at, numero) AS rn FROM cotizaciones
)
UPDATE cotizaciones c SET numero = ord.rn FROM ord WHERE c.id = ord.id;

WITH ord AS (
  SELECT id, row_number() OVER (ORDER BY created_at, numero) AS rn FROM compras
)
UPDATE compras c SET numero = ord.rn FROM ord WHERE c.id = ord.id;

WITH ord AS (
  SELECT id, row_number() OVER (ORDER BY created_at, numero) AS rn FROM traspasos
)
UPDATE traspasos t SET numero = ord.rn FROM ord WHERE t.id = ord.id;

WITH ord AS (
  SELECT id, row_number() OVER (ORDER BY created_at, numero) AS rn FROM ordenes_servicio
)
UPDATE ordenes_servicio o SET numero = ord.rn FROM ord WHERE o.id = ord.id;

WITH ord AS (
  SELECT id, row_number() OVER (ORDER BY created_at, numero) AS rn FROM devoluciones
)
UPDATE devoluciones d SET numero = ord.rn FROM ord WHERE d.id = ord.id;

-- ---------- RESETEAR SECUENCIAS ----------
-- Con datos: setval(seq, N, true) -> el próximo nextval() devuelve N+1.
-- Sin datos: setval(seq, 1, false) -> el próximo nextval() devuelve 1.

SELECT setval('ventas_numero_seq',          (SELECT COUNT(*) FROM ventas),           true);
SELECT setval('cotizaciones_numero_seq',    (SELECT COUNT(*) FROM cotizaciones),     true);
SELECT setval('compras_numero_seq',         (SELECT COUNT(*) FROM compras),          true);
SELECT setval('traspasos_numero_seq',       (SELECT COUNT(*) FROM traspasos),        true);
SELECT setval('ordenes_servicio_numero_seq',(SELECT COUNT(*) FROM ordenes_servicio), true);
SELECT setval('devoluciones_numero_seq',    (SELECT COUNT(*) FROM devoluciones),     true);
SELECT setval('ensambles_numero_seq',       1, false);
SELECT setval('recibos_numero_seq',         1, false);
-- cierres_numero_seq: NO se toca (queda en 8, próximo cierre #9).
