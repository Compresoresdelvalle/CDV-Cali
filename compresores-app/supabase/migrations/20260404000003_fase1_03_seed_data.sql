-- ============================================================
-- FASE 1 - PASO 3: Datos semilla
-- Compresores del Valle S.A.S.
-- ============================================================

-- Usuarios (con los UUIDs reales de auth.users)
INSERT INTO usuarios (id, nombre, pin, rol, sede_id, puede_descuento_alto) VALUES
  ('1eea3d55-e287-42a7-8f5c-8d9c8a03d1c3', 'Carlos Dueño',    '0001', 'Admin',     'BOD-PRINCIPAL', true),
  ('1e787dc7-815c-44d1-b6a5-2c894c473c34', 'Pedro Bodeguero', '1234', 'Bodeguero', 'BOD-PRINCIPAL', false),
  ('88ecac37-f3dc-4e11-8d13-1771ecc94a2d', 'María Vendedora', '5678', 'Vendedor',  'ALM-01',        false),
  ('c9c42305-b560-44d9-aa9d-690261defbbc', 'Juan Vendedor',   '9012', 'Vendedor',  'ALM-02',        false),
  ('df7acf2a-f128-4195-af15-f1163fc6f666', 'Ana Vendedora',   '3456', 'Vendedor',  'ALM-03',        false),
  ('602933bd-99af-42cc-9f59-e13b9519f639', 'Luis Técnico',    '7890', 'Tecnico',   'BOD-PRINCIPAL', false);

-- Ubicaciones
INSERT INTO ubicaciones (id, sede_id, pasillo, estante, nivel, descripcion) VALUES
  ('BOD-A1-01',   'BOD-PRINCIPAL', 'A', '1', '01', 'Compresores pequeños'),
  ('BOD-A1-02',   'BOD-PRINCIPAL', 'A', '1', '02', 'Compresores medianos'),
  ('BOD-B1-01',   'BOD-PRINCIPAL', 'B', '1', '01', 'Filtros y repuestos'),
  ('BOD-B2-01',   'BOD-PRINCIPAL', 'B', '2', '01', 'Aceites y lubricantes'),
  ('ALM01-A1-01', 'ALM-01',        'A', '1', '01', 'Exhibición principal');

-- 8 productos de prueba
INSERT INTO productos (referencia, nombre, categoria, marca, precio_venta, costo_promedio, stock_minimo, stock_maximo) VALUES
  ('CMP-2HP-24',  'Compresor Pistón 2HP 24L',   'Compresor',  'Campbell', 1850000, 1200000, 2,  8),
  ('CMP-3HP-50',  'Compresor Pistón 3HP 50L',   'Compresor',  'Campbell', 2800000, 1900000, 1,  5),
  ('FA-2236',     'Filtro Aire P/N 2236',        'Parte',      'Genérico',   45000,   22000, 5, 20),
  ('AC-15W40-G',  'Aceite 15W40 x Galón',        'Insumo',     'Mobil',    120000,   75000, 3, 10),
  ('MG-AP-10',    'Manguera Alta Presión 10m',   'Accesorio',  'Parker',   280000,  160000, 5, 15),
  ('VS-1/4',      'Válvula Seguridad 1/4"',      'Parte',      'Genérico',  65000,   32000, 4, 12),
  ('KP-3HP',      'Kit Pistón Compresor 3HP',    'Kit',        'Campbell', 320000,  180000, 3,  8),
  ('MN-150',      'Manómetro 0-150 PSI',         'Parte',      'Winters',   38000,   18000, 3, 10);

-- Inventario inicial
INSERT INTO inventario (producto_id, sede_id, cantidad, ubicacion_id) VALUES
  ((SELECT id FROM productos WHERE referencia='CMP-2HP-24'), 'BOD-PRINCIPAL', 4,  'BOD-A1-01'),
  ((SELECT id FROM productos WHERE referencia='CMP-3HP-50'), 'BOD-PRINCIPAL', 2,  'BOD-A1-02'),
  ((SELECT id FROM productos WHERE referencia='FA-2236'),    'BOD-PRINCIPAL', 15, 'BOD-B1-01'),
  ((SELECT id FROM productos WHERE referencia='FA-2236'),    'ALM-01',        1,  'ALM01-A1-01'),
  ((SELECT id FROM productos WHERE referencia='AC-15W40-G'), 'BOD-PRINCIPAL', 6,  'BOD-B2-01'),
  ((SELECT id FROM productos WHERE referencia='AC-15W40-G'), 'ALM-01',        0,  NULL),
  ((SELECT id FROM productos WHERE referencia='MG-AP-10'),   'BOD-PRINCIPAL', 12, 'BOD-B1-01'),
  ((SELECT id FROM productos WHERE referencia='VS-1/4'),     'ALM-01',        3,  'ALM01-A1-01'),
  ((SELECT id FROM productos WHERE referencia='KP-3HP'),     'BOD-PRINCIPAL', 2,  'BOD-B1-01'),
  ((SELECT id FROM productos WHERE referencia='MN-150'),     'BOD-PRINCIPAL', 7,  'BOD-B1-01');

-- Recalcular estado_stock para todos los registros de inventario insertados
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT producto_id, sede_id FROM inventario LOOP
    PERFORM fn_actualizar_estado_stock(r.producto_id, r.sede_id);
  END LOOP;
END; $$;
