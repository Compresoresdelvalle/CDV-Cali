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
