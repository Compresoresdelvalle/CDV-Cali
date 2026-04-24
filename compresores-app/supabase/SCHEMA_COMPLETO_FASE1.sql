-- ============================================================
-- FASE 1 - PASO 1: Extensiones, ENUMs y tablas base
-- Compresores del Valle S.A.S.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE rol_usuario AS ENUM ('Admin', 'Bodeguero', 'Vendedor', 'Tecnico');
CREATE TYPE estado_stock AS ENUM ('OK', 'Bajo', 'Agotado', 'Sobrestock');
CREATE TYPE estado_traspaso AS ENUM ('borrador', 'picking', 'verificado', 'en_transito', 'recibido', 'con_diferencia');
CREATE TYPE estado_orden AS ENUM ('abierta', 'en_proceso', 'esperando_repuesto', 'completada', 'entregada');
CREATE TYPE estado_cotizacion AS ENUM ('borrador', 'enviada', 'aprobada', 'rechazada', 'vencida');
CREATE TYPE estado_devolucion AS ENUM ('pendiente', 'aprobada', 'rechazada', 'procesada');
CREATE TYPE tipo_movimiento AS ENUM ('venta', 'compra', 'traspaso_salida', 'traspaso_entrada', 'ajuste', 'ensamble_consumo', 'ensamble_produccion', 'devolucion', 'orden_consumo', 'conteo_ajuste');
CREATE TYPE estado_herramienta AS ENUM ('disponible', 'prestada', 'en_mantenimiento', 'extraviada');
CREATE TYPE estado_prestamo AS ENUM ('activo', 'devuelto', 'vencido');
CREATE TYPE clasificacion_abc AS ENUM ('A', 'B', 'C');

CREATE TABLE sedes (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  direccion   TEXT,
  telefono    TEXT,
  activa      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO sedes (id, nombre) VALUES
  ('BOD-PRINCIPAL', 'Bodega Principal'),
  ('ALM-01', 'Almacén 01'),
  ('ALM-02', 'Almacén 02'),
  ('ALM-03', 'Almacén 03');

CREATE TABLE usuarios (
  id          UUID PRIMARY KEY REFERENCES auth.users(id),
  nombre      TEXT NOT NULL,
  pin         TEXT NOT NULL,
  rol         rol_usuario NOT NULL,
  sede_id     TEXT NOT NULL REFERENCES sedes(id),
  puede_descuento_alto BOOLEAN DEFAULT false,
  activo      BOOLEAN DEFAULT true,
  ultimo_login TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_pin UNIQUE (pin)
);

CREATE INDEX idx_usuarios_activo ON usuarios(activo) WHERE activo = true;

CREATE OR REPLACE FUNCTION get_my_rol()
RETURNS TEXT AS $$
  SELECT rol::TEXT FROM usuarios WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_my_sede_id()
RETURNS TEXT AS $$
  SELECT sede_id FROM usuarios WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE TABLE ubicaciones (
  id          TEXT PRIMARY KEY,
  sede_id     TEXT NOT NULL REFERENCES sedes(id),
  pasillo     TEXT,
  estante     TEXT,
  nivel       TEXT,
  descripcion TEXT,
  activa      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ubicaciones_sede ON ubicaciones(sede_id);

CREATE TABLE productos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referencia      TEXT NOT NULL UNIQUE,
  nombre          TEXT NOT NULL,
  categoria       TEXT NOT NULL,
  subcategoria    TEXT,
  marca           TEXT,
  modelo          TEXT,
  unidad_medida   TEXT DEFAULT 'unidad',
  precio_venta    NUMERIC(12,2) NOT NULL DEFAULT 0,
  costo_promedio  NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_minimo    INTEGER NOT NULL DEFAULT 0,
  stock_maximo    INTEGER NOT NULL DEFAULT 0,
  clasificacion   clasificacion_abc DEFAULT 'C',
  tiene_vencimiento BOOLEAN DEFAULT false,
  descripcion     TEXT,
  imagen_url      TEXT,
  activo          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_productos_referencia ON productos(referencia);
CREATE INDEX idx_productos_categoria ON productos(categoria);
CREATE INDEX idx_productos_activo ON productos(activo) WHERE activo = true;

CREATE TABLE inventario (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id     UUID NOT NULL REFERENCES productos(id),
  sede_id         TEXT NOT NULL REFERENCES sedes(id),
  cantidad        INTEGER NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  ubicacion_id    TEXT REFERENCES ubicaciones(id),
  estado_stock    estado_stock NOT NULL DEFAULT 'OK',
  fecha_vencimiento DATE,
  lote            TEXT,
  ultimo_movimiento TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(producto_id, sede_id)
);

CREATE INDEX idx_inventario_sede ON inventario(sede_id);
CREATE INDEX idx_inventario_producto ON inventario(producto_id);
CREATE INDEX idx_inventario_estado ON inventario(estado_stock);
CREATE INDEX idx_inventario_sede_estado ON inventario(sede_id, estado_stock);
CREATE INDEX idx_inventario_producto_sede ON inventario(producto_id, sede_id);

CREATE TABLE ventas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero          SERIAL,
  fecha           TIMESTAMPTZ DEFAULT now(),
  vendedor_id     UUID NOT NULL REFERENCES usuarios(id),
  sede_id         TEXT NOT NULL REFERENCES sedes(id),
  cliente_nombre  TEXT,
  cliente_nit     TEXT,
  subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
  descuento_pct   NUMERIC(5,2) DEFAULT 0 CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
  iva_pct         NUMERIC(5,2) DEFAULT 19,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  metodo_pago     TEXT DEFAULT 'efectivo',
  observaciones   TEXT,
  anulada         BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ventas_fecha ON ventas(fecha DESC);
CREATE INDEX idx_ventas_sede ON ventas(sede_id);
CREATE INDEX idx_ventas_vendedor ON ventas(vendedor_id);

CREATE TABLE detalle_venta (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venta_id        UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12,2) NOT NULL,
  costo_unitario  NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal        NUMERIC(12,2) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_detalle_venta_venta ON detalle_venta(venta_id);
CREATE INDEX idx_detalle_venta_producto ON detalle_venta(producto_id);

CREATE TABLE compras (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero          SERIAL,
  fecha           TIMESTAMPTZ DEFAULT now(),
  proveedor       TEXT NOT NULL,
  registrado_por  UUID NOT NULL REFERENCES usuarios(id),
  sede_destino_id TEXT NOT NULL REFERENCES sedes(id),
  subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
  iva             NUMERIC(12,2) DEFAULT 0,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  factura_proveedor TEXT,
  observaciones   TEXT,
  recibida        BOOLEAN DEFAULT false,
  fecha_recepcion TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_compras_fecha ON compras(fecha DESC);
CREATE INDEX idx_compras_sede ON compras(sede_destino_id);

CREATE TABLE detalle_compra (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  compra_id       UUID NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  costo_unitario  NUMERIC(12,2) NOT NULL,
  subtotal        NUMERIC(12,2) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_detalle_compra_compra ON detalle_compra(compra_id);

CREATE TABLE traspasos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero          SERIAL,
  fecha           TIMESTAMPTZ DEFAULT now(),
  sede_origen_id  TEXT NOT NULL REFERENCES sedes(id),
  sede_destino_id TEXT NOT NULL REFERENCES sedes(id),
  solicitado_por  UUID NOT NULL REFERENCES usuarios(id),
  verificado_por  UUID REFERENCES usuarios(id),
  recibido_por    UUID REFERENCES usuarios(id),
  estado          estado_traspaso NOT NULL DEFAULT 'borrador',
  bultos          INTEGER,
  observaciones   TEXT,
  fecha_verificacion TIMESTAMPTZ,
  fecha_recepcion    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  CHECK (sede_origen_id != sede_destino_id)
);

CREATE INDEX idx_traspasos_estado ON traspasos(estado);
CREATE INDEX idx_traspasos_origen ON traspasos(sede_origen_id);
CREATE INDEX idx_traspasos_destino ON traspasos(sede_destino_id);

CREATE TABLE detalle_traspaso (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  traspaso_id     UUID NOT NULL REFERENCES traspasos(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id),
  cantidad_solicitada INTEGER NOT NULL CHECK (cantidad_solicitada > 0),
  cantidad_enviada    INTEGER DEFAULT 0,
  cantidad_recibida   INTEGER DEFAULT 0,
  ubicacion_origen_id TEXT REFERENCES ubicaciones(id),
  picking_completado  BOOLEAN DEFAULT false,
  observaciones   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_detalle_traspaso_traspaso ON detalle_traspaso(traspaso_id);

CREATE TABLE ordenes_servicio (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero          SERIAL,
  fecha           TIMESTAMPTZ DEFAULT now(),
  cliente_nombre  TEXT NOT NULL,
  cliente_telefono TEXT,
  equipo_descripcion TEXT NOT NULL,
  equipo_serie    TEXT,
  diagnostico     TEXT,
  trabajo_realizado TEXT,
  tecnico_id      UUID NOT NULL REFERENCES usuarios(id),
  sede_id         TEXT NOT NULL REFERENCES sedes(id),
  estado          estado_orden NOT NULL DEFAULT 'abierta',
  costo_mano_obra NUMERIC(12,2) DEFAULT 0,
  costo_repuestos NUMERIC(12,2) DEFAULT 0,
  total           NUMERIC(12,2) DEFAULT 0,
  fecha_entrega   TIMESTAMPTZ,
  observaciones   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ordenes_estado ON ordenes_servicio(estado);
CREATE INDEX idx_ordenes_tecnico ON ordenes_servicio(tecnico_id);

CREATE TABLE detalle_orden (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  orden_id        UUID NOT NULL REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  costo_unitario  NUMERIC(12,2) NOT NULL,
  subtotal        NUMERIC(12,2) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_detalle_orden_orden ON detalle_orden(orden_id);

CREATE TABLE cotizaciones (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero          SERIAL,
  fecha           TIMESTAMPTZ DEFAULT now(),
  vendedor_id     UUID NOT NULL REFERENCES usuarios(id),
  sede_id         TEXT NOT NULL REFERENCES sedes(id),
  cliente_nombre  TEXT NOT NULL,
  cliente_nit     TEXT,
  cliente_email   TEXT,
  cliente_telefono TEXT,
  subtotal        NUMERIC(12,2) DEFAULT 0,
  descuento_pct   NUMERIC(5,2) DEFAULT 0,
  iva_pct         NUMERIC(5,2) DEFAULT 19,
  total           NUMERIC(12,2) DEFAULT 0,
  estado          estado_cotizacion DEFAULT 'borrador',
  vigencia_dias   INTEGER DEFAULT 30,
  observaciones   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cotizaciones_vendedor ON cotizaciones(vendedor_id);
CREATE INDEX idx_cotizaciones_estado ON cotizaciones(estado);

CREATE TABLE detalle_cotizacion (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cotizacion_id   UUID NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12,2) NOT NULL,
  subtotal        NUMERIC(12,2) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_detalle_cotizacion_cot ON detalle_cotizacion(cotizacion_id);

CREATE TABLE ensambles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero          SERIAL,
  fecha           TIMESTAMPTZ DEFAULT now(),
  producto_resultado_id UUID NOT NULL REFERENCES productos(id),
  cantidad_producida    INTEGER NOT NULL DEFAULT 1,
  realizado_por   UUID NOT NULL REFERENCES usuarios(id),
  sede_id         TEXT NOT NULL REFERENCES sedes(id),
  costo_total     NUMERIC(12,2) DEFAULT 0,
  observaciones   TEXT,
  completado      BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ensambles_producto ON ensambles(producto_resultado_id);

CREATE TABLE detalle_ensamble (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ensamble_id     UUID NOT NULL REFERENCES ensambles(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  costo_unitario  NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_detalle_ensamble_ensamble ON detalle_ensamble(ensamble_id);

CREATE TABLE recetas_bom (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_resultado_id UUID NOT NULL REFERENCES productos(id),
  componente_id   UUID NOT NULL REFERENCES productos(id),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(producto_resultado_id, componente_id),
  CHECK (producto_resultado_id != componente_id)
);

CREATE INDEX idx_bom_producto ON recetas_bom(producto_resultado_id);

CREATE TABLE herramientas_prestamo (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  herramienta_nombre TEXT NOT NULL,
  herramienta_codigo TEXT,
  estado          estado_herramienta DEFAULT 'disponible',
  prestada_a      UUID REFERENCES usuarios(id),
  fecha_prestamo  TIMESTAMPTZ,
  fecha_devolucion_esperada TIMESTAMPTZ,
  fecha_devolucion_real     TIMESTAMPTZ,
  sede_id         TEXT NOT NULL REFERENCES sedes(id),
  observaciones   TEXT,
  estado_prestamo estado_prestamo,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_herramientas_estado ON herramientas_prestamo(estado);

CREATE TABLE devoluciones (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero          SERIAL,
  fecha           TIMESTAMPTZ DEFAULT now(),
  venta_id        UUID REFERENCES ventas(id),
  producto_id     UUID NOT NULL REFERENCES productos(id),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  sede_id         TEXT NOT NULL REFERENCES sedes(id),
  motivo          TEXT NOT NULL,
  estado          estado_devolucion DEFAULT 'pendiente',
  registrado_por  UUID NOT NULL REFERENCES usuarios(id),
  aprobado_por    UUID REFERENCES usuarios(id),
  reingresa_stock BOOLEAN DEFAULT true,
  observaciones   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_devoluciones_estado ON devoluciones(estado);

CREATE TABLE movimientos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fecha           TIMESTAMPTZ DEFAULT now(),
  tipo            tipo_movimiento NOT NULL,
  producto_id     UUID NOT NULL REFERENCES productos(id),
  sede_id         TEXT NOT NULL REFERENCES sedes(id),
  cantidad        INTEGER NOT NULL,
  stock_anterior  INTEGER NOT NULL,
  stock_posterior INTEGER NOT NULL,
  referencia_id   UUID,
  referencia_tipo TEXT,
  usuario_id      UUID NOT NULL REFERENCES usuarios(id),
  observaciones   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_movimientos_fecha ON movimientos(fecha DESC);
CREATE INDEX idx_movimientos_producto ON movimientos(producto_id);
CREATE INDEX idx_movimientos_sede ON movimientos(sede_id);
CREATE INDEX idx_movimientos_tipo ON movimientos(tipo);
CREATE INDEX idx_movimientos_fecha_tipo ON movimientos(fecha, tipo);

CREATE OR REPLACE VIEW v_sugerencias_reorden AS
SELECT
  p.id AS producto_id,
  p.referencia,
  p.nombre,
  p.categoria,
  i.sede_id,
  i.cantidad AS stock_actual,
  p.stock_minimo,
  p.stock_maximo,
  (p.stock_maximo - i.cantidad) AS cantidad_sugerida,
  p.costo_promedio,
  (p.stock_maximo - i.cantidad) * p.costo_promedio AS costo_estimado
FROM inventario i
JOIN productos p ON p.id = i.producto_id
WHERE i.cantidad <= p.stock_minimo
  AND p.activo = true
ORDER BY p.clasificacion ASC, i.cantidad ASC;

CREATE OR REPLACE VIEW v_conteo_ciclico AS
SELECT
  i.id AS inventario_id,
  p.referencia,
  p.nombre,
  p.clasificacion,
  i.sede_id,
  i.cantidad,
  i.ubicacion_id,
  i.ultimo_movimiento,
  CASE p.clasificacion
    WHEN 'A' THEN 7
    WHEN 'B' THEN 15
    WHEN 'C' THEN 30
  END AS frecuencia_dias,
  COALESCE(
    (SELECT MAX(m.fecha) FROM movimientos m
     WHERE m.producto_id = p.id AND m.sede_id = i.sede_id AND m.tipo = 'conteo_ajuste'),
    '2000-01-01'::timestamptz
  ) AS ultimo_conteo
FROM inventario i
JOIN productos p ON p.id = i.producto_id
WHERE p.activo = true
ORDER BY p.clasificacion ASC;

CREATE TABLE conteos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inventario_id   UUID NOT NULL REFERENCES inventario(id),
  producto_id     UUID NOT NULL REFERENCES productos(id),
  sede_id         TEXT NOT NULL REFERENCES sedes(id),
  stock_sistema   INTEGER NOT NULL,
  stock_fisico    INTEGER NOT NULL,
  diferencia      INTEGER GENERATED ALWAYS AS (stock_fisico - stock_sistema) STORED,
  contado_por     UUID NOT NULL REFERENCES usuarios(id),
  aprobado_por    UUID REFERENCES usuarios(id),
  ajuste_aplicado BOOLEAN DEFAULT false,
  fecha           TIMESTAMPTZ DEFAULT now(),
  observaciones   TEXT
);

CREATE INDEX idx_conteos_fecha ON conteos(fecha DESC);
CREATE INDEX idx_conteos_inventario ON conteos(inventario_id);
-- ============================================================
-- FASE 1 - PASO 2: Funciones y Triggers
-- Compresores del Valle S.A.S.
-- ============================================================

-- Función auxiliar de estado de stock (debe ir ANTES de los triggers que la usan)
CREATE OR REPLACE FUNCTION fn_actualizar_estado_stock(p_producto_id UUID, p_sede_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_cantidad INTEGER; v_min INTEGER; v_max INTEGER; v_nuevo estado_stock;
BEGIN
  SELECT i.cantidad, p.stock_minimo, p.stock_maximo
  INTO v_cantidad, v_min, v_max
  FROM inventario i JOIN productos p ON p.id = i.producto_id
  WHERE i.producto_id = p_producto_id AND i.sede_id = p_sede_id;

  v_nuevo := CASE
    WHEN v_cantidad = 0 THEN 'Agotado'
    WHEN v_cantidad <= v_min THEN 'Bajo'
    WHEN v_cantidad > v_max THEN 'Sobrestock'
    ELSE 'OK'
  END;

  UPDATE inventario SET estado_stock = v_nuevo, updated_at = now()
  WHERE producto_id = p_producto_id AND sede_id = p_sede_id;
END; $$;

-- Trigger 1: Venta descuenta stock
CREATE OR REPLACE FUNCTION trg_venta_descontar_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inv RECORD;
  v_venta RECORD;
BEGIN
  SELECT sede_id, vendedor_id INTO v_venta FROM ventas WHERE id = NEW.venta_id;

  SELECT id, cantidad INTO v_inv
  FROM inventario
  WHERE producto_id = NEW.producto_id AND sede_id = v_venta.sede_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no existe en inventario de sede %', v_venta.sede_id;
  END IF;

  IF v_inv.cantidad < NEW.cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente. Disponible: %, Solicitado: %', v_inv.cantidad, NEW.cantidad;
  END IF;

  UPDATE inventario
  SET cantidad = cantidad - NEW.cantidad,
      ultimo_movimiento = now(),
      updated_at = now()
  WHERE id = v_inv.id;

  INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
                          referencia_id, referencia_tipo, usuario_id)
  VALUES ('venta', NEW.producto_id, v_venta.sede_id, -NEW.cantidad,
          v_inv.cantidad, v_inv.cantidad - NEW.cantidad,
          NEW.venta_id, 'venta', v_venta.vendedor_id);

  PERFORM fn_actualizar_estado_stock(NEW.producto_id, v_venta.sede_id);
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_after_insert_detalle_venta
  AFTER INSERT ON detalle_venta
  FOR EACH ROW EXECUTE FUNCTION trg_venta_descontar_stock();

-- Trigger 2: Compra suma stock al recibir
CREATE OR REPLACE FUNCTION trg_compra_sumar_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_compra RECORD;
  v_det RECORD;
  v_stock_ant INTEGER;
BEGIN
  IF NEW.recibida = true AND (OLD.recibida = false OR OLD.recibida IS NULL) THEN
    SELECT sede_destino_id, registrado_por INTO v_compra FROM compras WHERE id = NEW.id;

    FOR v_det IN SELECT * FROM detalle_compra WHERE compra_id = NEW.id LOOP
      SELECT COALESCE(cantidad, 0) INTO v_stock_ant
      FROM inventario WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id;

      INSERT INTO inventario (producto_id, sede_id, cantidad)
      VALUES (v_det.producto_id, v_compra.sede_destino_id, v_det.cantidad)
      ON CONFLICT (producto_id, sede_id)
      DO UPDATE SET
        cantidad = inventario.cantidad + v_det.cantidad,
        ultimo_movimiento = now(), updated_at = now();

      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
                              referencia_id, referencia_tipo, usuario_id)
      VALUES ('compra', v_det.producto_id, v_compra.sede_destino_id, v_det.cantidad,
              COALESCE(v_stock_ant, 0), COALESCE(v_stock_ant, 0) + v_det.cantidad,
              NEW.id, 'compra', v_compra.registrado_por);

      UPDATE productos SET
        costo_promedio = CASE
          WHEN (SELECT SUM(i.cantidad) FROM inventario i WHERE i.producto_id = v_det.producto_id) = 0
          THEN v_det.costo_unitario
          ELSE (costo_promedio * GREATEST(COALESCE(v_stock_ant, 0), 0) + v_det.costo_unitario * v_det.cantidad)
               / NULLIF(COALESCE(v_stock_ant, 0) + v_det.cantidad, 0)
        END,
        updated_at = now()
      WHERE id = v_det.producto_id;

      PERFORM fn_actualizar_estado_stock(v_det.producto_id, v_compra.sede_destino_id);
    END LOOP;

    UPDATE compras SET fecha_recepcion = now() WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_after_update_compra_recibida
  AFTER UPDATE OF recibida ON compras
  FOR EACH ROW EXECUTE FUNCTION trg_compra_sumar_stock();

-- Trigger 3: Traspaso salida
CREATE OR REPLACE FUNCTION trg_traspaso_salida()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_det RECORD; v_cant INTEGER;
BEGIN
  IF NEW.estado = 'en_transito' AND OLD.estado = 'verificado' THEN
    FOR v_det IN SELECT * FROM detalle_traspaso WHERE traspaso_id = NEW.id LOOP
      SELECT cantidad INTO v_cant FROM inventario
      WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_origen_id FOR UPDATE;

      UPDATE inventario SET cantidad = cantidad - v_det.cantidad_enviada,
        ultimo_movimiento = now(), updated_at = now()
      WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_origen_id;

      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id)
      VALUES ('traspaso_salida', v_det.producto_id, NEW.sede_origen_id,
        -v_det.cantidad_enviada, v_cant, v_cant - v_det.cantidad_enviada,
        NEW.id, 'traspaso', NEW.solicitado_por);

      PERFORM fn_actualizar_estado_stock(v_det.producto_id, NEW.sede_origen_id);
    END LOOP;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_after_update_traspaso_salida
  AFTER UPDATE OF estado ON traspasos
  FOR EACH ROW EXECUTE FUNCTION trg_traspaso_salida();

-- Trigger 4: Traspaso entrada
CREATE OR REPLACE FUNCTION trg_traspaso_entrada()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_det RECORD; v_stock_ant INTEGER;
BEGIN
  IF NEW.estado IN ('recibido', 'con_diferencia') AND OLD.estado = 'en_transito' THEN
    FOR v_det IN SELECT * FROM detalle_traspaso WHERE traspaso_id = NEW.id LOOP
      SELECT COALESCE(cantidad, 0) INTO v_stock_ant FROM inventario
      WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_destino_id;

      INSERT INTO inventario (producto_id, sede_id, cantidad)
      VALUES (v_det.producto_id, NEW.sede_destino_id, v_det.cantidad_recibida)
      ON CONFLICT (producto_id, sede_id)
      DO UPDATE SET cantidad = inventario.cantidad + v_det.cantidad_recibida,
        ultimo_movimiento = now(), updated_at = now();

      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id)
      VALUES ('traspaso_entrada', v_det.producto_id, NEW.sede_destino_id,
        v_det.cantidad_recibida, COALESCE(v_stock_ant, 0), COALESCE(v_stock_ant, 0) + v_det.cantidad_recibida,
        NEW.id, 'traspaso', COALESCE(NEW.recibido_por, NEW.solicitado_por));

      PERFORM fn_actualizar_estado_stock(v_det.producto_id, NEW.sede_destino_id);
    END LOOP;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_after_update_traspaso_entrada
  AFTER UPDATE OF estado ON traspasos
  FOR EACH ROW EXECUTE FUNCTION trg_traspaso_entrada();

-- Trigger 5: Ensamble consume componentes y produce
CREATE OR REPLACE FUNCTION trg_ensamble_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_det RECORD; v_cant INTEGER; v_costo NUMERIC := 0;
BEGIN
  IF NEW.completado = true AND (OLD.completado = false OR OLD.completado IS NULL) THEN
    FOR v_det IN SELECT * FROM detalle_ensamble WHERE ensamble_id = NEW.id LOOP
      SELECT cantidad INTO v_cant FROM inventario
      WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_id FOR UPDATE;

      IF v_cant < v_det.cantidad THEN
        RAISE EXCEPTION 'Stock insuficiente de componente para ensamble';
      END IF;

      UPDATE inventario SET cantidad = cantidad - v_det.cantidad,
        ultimo_movimiento = now(), updated_at = now()
      WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_id;

      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id)
      VALUES ('ensamble_consumo', v_det.producto_id, NEW.sede_id,
        -v_det.cantidad, v_cant, v_cant - v_det.cantidad, NEW.id, 'ensamble', NEW.realizado_por);

      v_costo := v_costo + (v_det.costo_unitario * v_det.cantidad);
      PERFORM fn_actualizar_estado_stock(v_det.producto_id, NEW.sede_id);
    END LOOP;

    INSERT INTO inventario (producto_id, sede_id, cantidad)
    VALUES (NEW.producto_resultado_id, NEW.sede_id, NEW.cantidad_producida)
    ON CONFLICT (producto_id, sede_id)
    DO UPDATE SET cantidad = inventario.cantidad + NEW.cantidad_producida,
      ultimo_movimiento = now(), updated_at = now();

    INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id)
    VALUES ('ensamble_produccion', NEW.producto_resultado_id, NEW.sede_id,
      NEW.cantidad_producida, 0, NEW.cantidad_producida, NEW.id, 'ensamble', NEW.realizado_por);

    UPDATE ensambles SET costo_total = v_costo WHERE id = NEW.id;
    PERFORM fn_actualizar_estado_stock(NEW.producto_resultado_id, NEW.sede_id);
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_after_update_ensamble
  AFTER UPDATE OF completado ON ensambles
  FOR EACH ROW EXECUTE FUNCTION trg_ensamble_stock();

-- Trigger 6: Devolución reingresar stock
CREATE OR REPLACE FUNCTION trg_devolucion_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_cant INTEGER;
BEGIN
  IF NEW.estado = 'procesada' AND OLD.estado = 'aprobada' AND NEW.reingresa_stock = true THEN
    SELECT cantidad INTO v_cant FROM inventario
    WHERE producto_id = NEW.producto_id AND sede_id = NEW.sede_id FOR UPDATE;

    UPDATE inventario SET cantidad = cantidad + NEW.cantidad,
      ultimo_movimiento = now(), updated_at = now()
    WHERE producto_id = NEW.producto_id AND sede_id = NEW.sede_id;

    INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id)
    VALUES ('devolucion', NEW.producto_id, NEW.sede_id, NEW.cantidad,
      v_cant, v_cant + NEW.cantidad, NEW.id, 'devolucion', NEW.registrado_por);

    PERFORM fn_actualizar_estado_stock(NEW.producto_id, NEW.sede_id);
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_after_update_devolucion
  AFTER UPDATE OF estado ON devoluciones
  FOR EACH ROW EXECUTE FUNCTION trg_devolucion_stock();

-- Trigger 7: Orden consumir repuesto
CREATE OR REPLACE FUNCTION trg_orden_consumir_repuesto()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_orden RECORD; v_cant INTEGER;
BEGIN
  SELECT tecnico_id, sede_id INTO v_orden FROM ordenes_servicio WHERE id = NEW.orden_id;

  SELECT cantidad INTO v_cant FROM inventario
  WHERE producto_id = NEW.producto_id AND sede_id = v_orden.sede_id FOR UPDATE;

  IF v_cant < NEW.cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente de repuesto para orden de servicio';
  END IF;

  UPDATE inventario SET cantidad = cantidad - NEW.cantidad,
    ultimo_movimiento = now(), updated_at = now()
  WHERE producto_id = NEW.producto_id AND sede_id = v_orden.sede_id;

  INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id)
  VALUES ('orden_consumo', NEW.producto_id, v_orden.sede_id, -NEW.cantidad,
    v_cant, v_cant - NEW.cantidad, NEW.orden_id, 'orden_servicio', v_orden.tecnico_id);

  UPDATE ordenes_servicio SET
    costo_repuestos = (SELECT COALESCE(SUM(subtotal), 0) FROM detalle_orden WHERE orden_id = NEW.orden_id),
    total = costo_mano_obra + (SELECT COALESCE(SUM(subtotal), 0) FROM detalle_orden WHERE orden_id = NEW.orden_id)
  WHERE id = NEW.orden_id;

  PERFORM fn_actualizar_estado_stock(NEW.producto_id, v_orden.sede_id);
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_after_insert_detalle_orden
  AFTER INSERT ON detalle_orden
  FOR EACH ROW EXECUTE FUNCTION trg_orden_consumir_repuesto();

-- Trigger 8: Recalcular totales de venta
CREATE OR REPLACE FUNCTION trg_recalcular_total_venta()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_subtotal NUMERIC(12,2); v_venta RECORD;
BEGIN
  SELECT COALESCE(SUM(subtotal), 0) INTO v_subtotal
  FROM detalle_venta WHERE venta_id = COALESCE(NEW.venta_id, OLD.venta_id);

  SELECT descuento_pct, iva_pct INTO v_venta
  FROM ventas WHERE id = COALESCE(NEW.venta_id, OLD.venta_id);

  UPDATE ventas SET subtotal = v_subtotal,
    total = v_subtotal * (1 - v_venta.descuento_pct / 100) * (1 + v_venta.iva_pct / 100)
  WHERE id = COALESCE(NEW.venta_id, OLD.venta_id);

  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE TRIGGER trg_recalcular_venta
  AFTER INSERT OR DELETE ON detalle_venta
  FOR EACH ROW EXECUTE FUNCTION trg_recalcular_total_venta();

-- Función ABC (cron semanal)
CREATE OR REPLACE FUNCTION fn_recalcular_abc()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  WITH ventas_90d AS (
    SELECT dv.producto_id, SUM(dv.subtotal) AS total_vendido
    FROM detalle_venta dv JOIN ventas v ON v.id = dv.venta_id
    WHERE v.fecha >= now() - INTERVAL '90 days' AND v.anulada = false
    GROUP BY dv.producto_id
  ),
  ranked AS (
    SELECT producto_id, total_vendido,
      SUM(total_vendido) OVER (ORDER BY total_vendido DESC) /
      NULLIF(SUM(total_vendido) OVER (), 0) * 100 AS pct_acum
    FROM ventas_90d
  )
  UPDATE productos SET
    clasificacion = CASE
      WHEN r.pct_acum <= 80 THEN 'A'
      WHEN r.pct_acum <= 95 THEN 'B'
      ELSE 'C'
    END, updated_at = now()
  FROM ranked r WHERE productos.id = r.producto_id;

  UPDATE productos SET clasificacion = 'C', updated_at = now()
  WHERE id NOT IN (
    SELECT DISTINCT dv.producto_id FROM detalle_venta dv
    JOIN ventas v ON v.id = dv.venta_id
    WHERE v.fecha >= now() - INTERVAL '90 days'
  ) AND activo = true;
END; $$;

-- Protección soft-delete
CREATE OR REPLACE FUNCTION trg_prevent_delete()
RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'DELETE no permitido. Use soft delete.'; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_no_delete_inventario BEFORE DELETE ON inventario
  FOR EACH ROW EXECUTE FUNCTION trg_prevent_delete();
CREATE TRIGGER trg_no_delete_movimientos BEFORE DELETE ON movimientos
  FOR EACH ROW EXECUTE FUNCTION trg_prevent_delete();
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
