-- ============================================================
-- FASE 1 - PASO 4: RLS Policies
-- Compresores del Valle S.A.S.
-- ============================================================

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

-- Tablas de referencia: lectura para todos los autenticados
CREATE POLICY "auth_read_sedes"       ON sedes       FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_ubicaciones" ON ubicaciones  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_productos"   ON productos    FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_bom"         ON recetas_bom  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_usuarios"    ON usuarios     FOR SELECT TO authenticated USING (true);

-- Inventario: Vendedor solo su sede, Admin/Bodeguero todo
CREATE POLICY "inv_select" ON inventario FOR SELECT TO authenticated
  USING (get_my_rol() IN ('Admin','Bodeguero') OR sede_id = get_my_sede_id());
CREATE POLICY "inv_modify" ON inventario FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Bodeguero'));

-- Ventas
CREATE POLICY "ventas_select" ON ventas FOR SELECT TO authenticated
  USING (get_my_rol() = 'Admin' OR sede_id = get_my_sede_id());
CREATE POLICY "ventas_insert" ON ventas FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() IN ('Admin','Vendedor'));
CREATE POLICY "dv_select" ON detalle_venta FOR SELECT TO authenticated USING (true);
CREATE POLICY "dv_insert" ON detalle_venta FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() IN ('Admin','Vendedor'));

-- Compras
CREATE POLICY "compras_all" ON compras FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Bodeguero'));
CREATE POLICY "dc_all" ON detalle_compra FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Bodeguero'));

-- Traspasos
CREATE POLICY "trasp_all" ON traspasos FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Bodeguero'));
CREATE POLICY "trasp_read" ON traspasos FOR SELECT TO authenticated
  USING (get_my_rol() = 'Vendedor' AND (sede_origen_id = get_my_sede_id() OR sede_destino_id = get_my_sede_id()));
CREATE POLICY "dt_all" ON detalle_traspaso FOR ALL TO authenticated USING (true);

-- Ordenes
CREATE POLICY "ord_all" ON ordenes_servicio FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Tecnico'));
CREATE POLICY "do_all" ON detalle_orden FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Tecnico'));

-- Cotizaciones
CREATE POLICY "cot_all" ON cotizaciones FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Vendedor'));
CREATE POLICY "dcot_all" ON detalle_cotizacion FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Vendedor'));

-- Ensambles
CREATE POLICY "ens_all" ON ensambles FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Bodeguero','Tecnico'));
CREATE POLICY "de_all" ON detalle_ensamble FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Bodeguero','Tecnico'));

-- Herramientas
CREATE POLICY "herr_all" ON herramientas_prestamo FOR ALL TO authenticated USING (true);

-- Devoluciones
CREATE POLICY "dev_all" ON devoluciones FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Bodeguero'));

-- Movimientos: append-only
CREATE POLICY "mov_select" ON movimientos FOR SELECT TO authenticated USING (true);
CREATE POLICY "mov_insert" ON movimientos FOR INSERT TO authenticated WITH CHECK (true);

-- Conteos
CREATE POLICY "cont_all" ON conteos FOR ALL TO authenticated
  USING (get_my_rol() IN ('Admin','Bodeguero'));

-- Productos: solo Admin modifica
CREATE POLICY "prod_modify" ON productos FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "prod_update" ON productos FOR UPDATE TO authenticated
  USING (get_my_rol() = 'Admin');
