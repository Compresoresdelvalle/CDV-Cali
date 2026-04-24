-- ============================================================
-- FASE 1 - PASO 5: Verificación
-- Ejecutar estas queries para confirmar que el esquema quedó correcto
-- ============================================================

-- 1. Inventario con estado de stock
SELECT
  p.referencia,
  p.nombre,
  i.sede_id,
  i.cantidad,
  p.stock_minimo,
  p.stock_maximo,
  i.estado_stock
FROM inventario i
JOIN productos p ON p.id = i.producto_id
ORDER BY p.referencia, i.sede_id;

-- 2. Total de tablas en schema public
SELECT COUNT(*) AS total_tablas
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

-- 3. Estado RLS por tabla
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
