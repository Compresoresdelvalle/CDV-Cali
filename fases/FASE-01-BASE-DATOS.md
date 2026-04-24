# FASE 1: BASE DE DATOS COMPLETA EN SUPABASE

## Qué instalar en Claude Code

```bash
npx claude-code-templates@latest \
  --agent database/supabase-schema-architect \
  --command database/supabase-schema-sync \
  --command database/supabase-type-generator \
  --yes
```

## Qué decirle a Claude Code

```
Lee CLAUDE.md y fases/FASE-01-BASE-DATOS.md. Luego lee referencias/ESQUEMA-DB-COMPLETO.sql y ejecútalo completo en Supabase usando el MCP de Supabase. Después aplica las RLS policies y crea los datos semilla mínimos. NO insertes muchos datos — solo lo necesario para probar: 4 sedes, 6 usuarios, 8 productos de ejemplo y su inventario.
```

## Pasos

### PASO 1: Crear 6 usuarios en Supabase Auth (MANUAL)

Esto se hace desde el Dashboard de Supabase > Authentication > Users > Add User:

| Email                    | Password (PIN) |
| ------------------------ | -------------- |
| carlos@compresores.local | 0001           |
| pedro@compresores.local  | 1234           |
| maria@compresores.local  | 5678           |
| juan@compresores.local   | 9012           |
| ana@compresores.local    | 3456           |
| luis@compresores.local   | 7890           |

**IMPORTANTE:** Anotar el UUID que genera Supabase para cada usuario. Se necesitan para el PASO 3.

### PASO 2: Ejecutar SQL completo

Ejecutar el archivo `referencias/ESQUEMA-DB-COMPLETO.sql` en Supabase SQL Editor.
Esto crea: 19 tablas + índices + tipos enum + views + tabla de conteos.

### PASO 3: Insertar datos semilla mínimos

```sql
-- Las sedes ya se insertaron en el SQL principal (están en ESQUEMA-DB-COMPLETO.sql)

-- Perfiles de usuario (usar los UUIDs reales del PASO 1)
INSERT INTO usuarios (id, nombre, pin, rol, sede_id, puede_descuento_alto) VALUES
  ('UUID-DE-CARLOS', 'Carlos Dueño', '0001', 'Admin', 'BOD-PRINCIPAL', true),
  ('UUID-DE-PEDRO', 'Pedro Bodeguero', '1234', 'Bodeguero', 'BOD-PRINCIPAL', false),
  ('UUID-DE-MARIA', 'María Vendedora', '5678', 'Vendedor', 'ALM-01', false),
  ('UUID-DE-JUAN', 'Juan Vendedor', '9012', 'Vendedor', 'ALM-02', false),
  ('UUID-DE-ANA', 'Ana Vendedora', '3456', 'Vendedor', 'ALM-03', false),
  ('UUID-DE-LUIS', 'Luis Técnico', '7890', 'Tecnico', 'BOD-PRINCIPAL', false);

-- Ubicaciones mínimas
INSERT INTO ubicaciones (id, sede_id, pasillo, estante, nivel, descripcion) VALUES
  ('BOD-A1-01', 'BOD-PRINCIPAL', 'A', '1', '01', 'Compresores pequeños'),
  ('BOD-A1-02', 'BOD-PRINCIPAL', 'A', '1', '02', 'Compresores medianos'),
  ('BOD-B1-01', 'BOD-PRINCIPAL', 'B', '1', '01', 'Filtros y repuestos'),
  ('BOD-B2-01', 'BOD-PRINCIPAL', 'B', '2', '01', 'Aceites y lubricantes'),
  ('ALM01-A1-01', 'ALM-01', 'A', '1', '01', 'Exhibición principal');

-- 8 productos de prueba (pocos datos, lo mínimo para probar)
INSERT INTO productos (referencia, nombre, categoria, marca, precio_venta, costo_promedio, stock_minimo, stock_maximo) VALUES
  ('CMP-2HP-24', 'Compresor Pistón 2HP 24L', 'Compresor', 'Campbell', 1850000, 1200000, 2, 8),
  ('CMP-3HP-50', 'Compresor Pistón 3HP 50L', 'Compresor', 'Campbell', 2800000, 1900000, 1, 5),
  ('FA-2236', 'Filtro Aire P/N 2236', 'Parte', 'Genérico', 45000, 22000, 5, 20),
  ('AC-15W40-G', 'Aceite 15W40 x Galón', 'Insumo', 'Mobil', 120000, 75000, 3, 10),
  ('MG-AP-10', 'Manguera Alta Presión 10m', 'Accesorio', 'Parker', 280000, 160000, 5, 15),
  ('VS-1/4', 'Válvula Seguridad 1/4"', 'Parte', 'Genérico', 65000, 32000, 4, 12),
  ('KP-3HP', 'Kit Pistón Compresor 3HP', 'Kit', 'Campbell', 320000, 180000, 3, 8),
  ('MN-150', 'Manómetro 0-150 PSI', 'Parte', 'Winters', 38000, 18000, 3, 10);

-- Inventario inicial (solo en BOD-PRINCIPAL y ALM-01 para probar)
INSERT INTO inventario (producto_id, sede_id, cantidad, ubicacion_id) VALUES
  ((SELECT id FROM productos WHERE referencia='CMP-2HP-24'), 'BOD-PRINCIPAL', 4, 'BOD-A1-01'),
  ((SELECT id FROM productos WHERE referencia='CMP-3HP-50'), 'BOD-PRINCIPAL', 2, 'BOD-A1-02'),
  ((SELECT id FROM productos WHERE referencia='FA-2236'), 'BOD-PRINCIPAL', 15, 'BOD-B1-01'),
  ((SELECT id FROM productos WHERE referencia='FA-2236'), 'ALM-01', 1, 'ALM01-A1-01'),
  ((SELECT id FROM productos WHERE referencia='AC-15W40-G'), 'BOD-PRINCIPAL', 6, 'BOD-B2-01'),
  ((SELECT id FROM productos WHERE referencia='AC-15W40-G'), 'ALM-01', 0, NULL),
  ((SELECT id FROM productos WHERE referencia='MG-AP-10'), 'BOD-PRINCIPAL', 12, 'BOD-B1-01'),
  ((SELECT id FROM productos WHERE referencia='VS-1/4'), 'ALM-01', 3, 'ALM01-A1-01'),
  ((SELECT id FROM productos WHERE referencia='KP-3HP'), 'BOD-PRINCIPAL', 2, 'BOD-B1-01'),
  ((SELECT id FROM productos WHERE referencia='MN-150'), 'BOD-PRINCIPAL', 7, 'BOD-B1-01');
```

### PASO 4: Ejecutar triggers

Ejecutar todo el SQL de la sección de Triggers del plan (está en `referencias/ESQUEMA-DB-COMPLETO.sql` después de las tablas).

### PASO 5: Aplicar RLS

```sql
-- Habilitar RLS en todas las tablas
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE sedes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ubicaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventario ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_venta ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_compra ENABLE ROW LEVEL SECURITY;
ALTER TABLE traspasos ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_traspaso ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes_servicio ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_orden ENABLE ROW LEVEL SECURITY;
ALTER TABLE cotizaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_cotizacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE ensambles ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_ensamble ENABLE ROW LEVEL SECURITY;
ALTER TABLE recetas_bom ENABLE ROW LEVEL SECURITY;
ALTER TABLE herramientas_prestamo ENABLE ROW LEVEL SECURITY;
ALTER TABLE devoluciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE conteos ENABLE ROW LEVEL SECURITY;

-- Lectura para todos los autenticados en tablas de referencia
CREATE POLICY "auth_read" ON sedes FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON ubicaciones FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON productos FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON recetas_bom FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON usuarios FOR SELECT TO authenticated USING (true);

-- Inventario: Vendedor solo su sede, Admin/Bodeguero todo
CREATE POLICY "inv_select" ON inventario FOR SELECT TO authenticated
  USING (get_my_rol() IN ('Admin','Bodeguero') OR sede_id = get_my_sede_id());
CREATE POLICY "inv_modify" ON inventario FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Bodeguero'));

-- Ventas: Admin ve todo, Vendedor su sede
CREATE POLICY "ventas_select" ON ventas FOR SELECT TO authenticated
  USING (get_my_rol() = 'Admin' OR sede_id = get_my_sede_id());
CREATE POLICY "ventas_insert" ON ventas FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() IN ('Admin','Vendedor'));
CREATE POLICY "dv_select" ON detalle_venta FOR SELECT TO authenticated USING (true);
CREATE POLICY "dv_insert" ON detalle_venta FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() IN ('Admin','Vendedor'));

-- Compras: Admin y Bodeguero
CREATE POLICY "compras_all" ON compras FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Bodeguero'));
CREATE POLICY "dc_all" ON detalle_compra FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Bodeguero'));

-- Traspasos: Admin y Bodeguero full, Vendedor solo lectura de su sede
CREATE POLICY "trasp_all" ON traspasos FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Bodeguero'));
CREATE POLICY "trasp_read" ON traspasos FOR SELECT TO authenticated
  USING (get_my_rol() = 'Vendedor' AND (sede_origen_id = get_my_sede_id() OR sede_destino_id = get_my_sede_id()));
CREATE POLICY "dt_all" ON detalle_traspaso FOR ALL TO authenticated USING (true);

-- Órdenes: Admin y Técnico
CREATE POLICY "ord_all" ON ordenes_servicio FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Tecnico'));
CREATE POLICY "do_all" ON detalle_orden FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Tecnico'));

-- Cotizaciones: Admin y Vendedor
CREATE POLICY "cot_all" ON cotizaciones FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Vendedor'));
CREATE POLICY "dcot_all" ON detalle_cotizacion FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Vendedor'));

-- Ensambles: Admin, Bodeguero, Técnico
CREATE POLICY "ens_all" ON ensambles FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Bodeguero','Tecnico'));
CREATE POLICY "de_all" ON detalle_ensamble FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Bodeguero','Tecnico'));

-- Herramientas: todos
CREATE POLICY "herr_all" ON herramientas_prestamo FOR ALL TO authenticated USING (true);

-- Devoluciones: Admin y Bodeguero
CREATE POLICY "dev_all" ON devoluciones FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Bodeguero'));

-- Movimientos: todos leen, todos insertan (trigger impide update/delete)
CREATE POLICY "mov_select" ON movimientos FOR SELECT TO authenticated USING (true);
CREATE POLICY "mov_insert" ON movimientos FOR INSERT TO authenticated WITH CHECK (true);

-- Conteos: Admin y Bodeguero
CREATE POLICY "cont_all" ON conteos FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Bodeguero'));

-- Productos: solo Admin modifica
CREATE POLICY "prod_modify" ON productos FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "prod_update" ON productos FOR UPDATE TO authenticated
  USING (get_my_rol() = 'Admin');
```

### PASO 6: Verificar con test rápido

```sql
-- Verificar que los triggers funcionan: estado_stock debe calcularse
SELECT p.referencia, i.cantidad, p.stock_minimo, i.estado_stock
FROM inventario i JOIN productos p ON p.id = i.producto_id
ORDER BY p.referencia;
-- FA-2236 en ALM-01 con cantidad=1, stock_minimo=5 → debe decir 'Bajo'
-- AC-15W40-G en ALM-01 con cantidad=0 → debe decir 'Agotado'
```

## Criterios de aceptación

- [ ] Las 19 tablas existen en Supabase
- [ ] Los 6 usuarios existen en Auth Y en tabla usuarios
- [ ] Los 8 productos tienen inventario con estado_stock calculado
- [ ] El trigger de estado_stock funciona (Bajo, Agotado se ven correctamente)
- [ ] RLS está habilitado en todas las tablas
- [ ] Un vendedor autenticado solo ve inventario de su sede
- [ ] `git commit -m "Fase 1: BD completa + triggers + RLS + seed data"`
