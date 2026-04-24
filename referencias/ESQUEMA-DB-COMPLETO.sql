

-- ============================================================
-- EXTENSIONES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TIPOS ENUMERADOS
-- ============================================================
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

-- ============================================================
-- 1. SEDES
-- ============================================================
CREATE TABLE sedes (
  id          TEXT PRIMARY KEY,                -- 'BOD-PRINCIPAL', 'ALM-01', etc.
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

-- ============================================================
-- 2. USUARIOS
-- ============================================================
CREATE TABLE usuarios (
  id          UUID PRIMARY KEY REFERENCES auth.users(id),  -- V2: enlazado con Supabase Auth
  nombre      TEXT NOT NULL,
  pin         TEXT NOT NULL,                       -- V2: solo referencia visual (auth usa password)
  rol         rol_usuario NOT NULL,
  sede_id     TEXT NOT NULL REFERENCES sedes(id),
  puede_descuento_alto BOOLEAN DEFAULT false,
  activo      BOOLEAN DEFAULT true,
  ultimo_login TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_pin UNIQUE (pin)
);

-- Índice para login rápido
CREATE INDEX idx_usuarios_activo ON usuarios(activo) WHERE activo = true;

-- V2: Funciones helper para RLS (usadas en todas las policies)
CREATE OR REPLACE FUNCTION get_my_rol()
RETURNS TEXT AS $$
  SELECT rol::TEXT FROM usuarios WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_my_sede_id()
RETURNS TEXT AS $$
  SELECT sede_id FROM usuarios WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- 3. UBICACIONES (slots de bodega/almacén)
-- ============================================================
CREATE TABLE ubicaciones (
  id          TEXT PRIMARY KEY,                -- 'BOD-A1-01', 'ALM01-B2-03'
  sede_id     TEXT NOT NULL REFERENCES sedes(id),
  pasillo     TEXT,
  estante     TEXT,
  nivel       TEXT,
  descripcion TEXT,
  activa      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ubicaciones_sede ON ubicaciones(sede_id);

-- ============================================================
-- 4. PRODUCTOS (catálogo maestro)
-- ============================================================
CREATE TABLE productos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referencia      TEXT NOT NULL UNIQUE,         -- 'CMP-2HP-24' (código humano + QR)
  nombre          TEXT NOT NULL,
  categoria       TEXT NOT NULL,                -- 'Compresor', 'Parte', 'Insumo', 'Kit', 'Accesorio'
  subcategoria    TEXT,
  marca           TEXT,
  modelo          TEXT,
  unidad_medida   TEXT DEFAULT 'unidad',        -- 'unidad', 'litro', 'metro', 'galón'
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
-- Para búsqueda fuzzy (requiere: CREATE EXTENSION IF NOT EXISTS pg_trgm;)
-- CREATE INDEX idx_productos_nombre_trgm ON productos USING gin(nombre gin_trgm_ops);

-- ============================================================
-- 5. INVENTARIO (stock por producto + sede)
-- ============================================================
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

  UNIQUE(producto_id, sede_id)                 -- Clave compuesta: 1 fila por producto+sede
);

-- Índices críticos para rendimiento
CREATE INDEX idx_inventario_sede ON inventario(sede_id);
CREATE INDEX idx_inventario_producto ON inventario(producto_id);
CREATE INDEX idx_inventario_estado ON inventario(estado_stock);
CREATE INDEX idx_inventario_sede_estado ON inventario(sede_id, estado_stock);
CREATE INDEX idx_inventario_producto_sede ON inventario(producto_id, sede_id);

-- ============================================================
-- 6. VENTAS (encabezado)
-- ============================================================
CREATE TABLE ventas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero          SERIAL,                       -- VTA-0001, VTA-0002...
  fecha           TIMESTAMPTZ DEFAULT now(),
  vendedor_id     UUID NOT NULL REFERENCES usuarios(id),
  sede_id         TEXT NOT NULL REFERENCES sedes(id),
  cliente_nombre  TEXT,
  cliente_nit     TEXT,
  subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
  descuento_pct   NUMERIC(5,2) DEFAULT 0 CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
  iva_pct         NUMERIC(5,2) DEFAULT 19,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  metodo_pago     TEXT DEFAULT 'efectivo',       -- 'efectivo', 'transferencia', 'credito'
  observaciones   TEXT,
  anulada         BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ventas_fecha ON ventas(fecha DESC);
CREATE INDEX idx_ventas_sede ON ventas(sede_id);
CREATE INDEX idx_ventas_vendedor ON ventas(vendedor_id);

-- ============================================================
-- 7. DETALLE_VENTA
-- ============================================================
CREATE TABLE detalle_venta (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venta_id        UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12,2) NOT NULL,
  costo_unitario  NUMERIC(12,2) NOT NULL DEFAULT 0,  -- snapshot del costo al momento
  subtotal        NUMERIC(12,2) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_detalle_venta_venta ON detalle_venta(venta_id);
CREATE INDEX idx_detalle_venta_producto ON detalle_venta(producto_id);

-- ============================================================
-- 8. COMPRAS (encabezado)
-- ============================================================
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
  recibida        BOOLEAN DEFAULT false,          -- false = pedido, true = recibida
  fecha_recepcion TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_compras_fecha ON compras(fecha DESC);
CREATE INDEX idx_compras_sede ON compras(sede_destino_id);

-- ============================================================
-- 9. DETALLE_COMPRA
-- ============================================================
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

-- ============================================================
-- 10. TRASPASOS (incluye flujo de picking)
-- ============================================================
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

-- ============================================================
-- 11. DETALLE_TRASPASO
-- ============================================================
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

-- ============================================================
-- 12. ORDENES_SERVICIO
-- ============================================================
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

-- ============================================================
-- 13. DETALLE_ORDEN (repuestos usados)
-- ============================================================
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

-- ============================================================
-- 14. COTIZACIONES
-- ============================================================
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

-- ============================================================
-- 15. DETALLE_COTIZACION
-- ============================================================
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

-- ============================================================
-- 16. ENSAMBLES
-- ============================================================
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

-- ============================================================
-- 17. DETALLE_ENSAMBLE (componentes consumidos)
-- ============================================================
CREATE TABLE detalle_ensamble (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ensamble_id     UUID NOT NULL REFERENCES ensambles(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  costo_unitario  NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_detalle_ensamble_ensamble ON detalle_ensamble(ensamble_id);

-- ============================================================
-- 18. RECETAS_BOM (Bill of Materials)
-- ============================================================
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

-- ============================================================
-- 19. HERRAMIENTAS_PRESTAMO
-- ============================================================
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

-- ============================================================
-- 20. DEVOLUCIONES
-- ============================================================
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

-- ============================================================
-- 21. MOVIMIENTOS (log de auditoría — append-only)
-- ============================================================
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

-- ============================================================
-- VIEWS CALCULADAS
-- ============================================================

-- Vista: productos que necesitan reorden
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

-- Vista: conteo cíclico (próximos a contar)
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

-- Tabla auxiliar para conteos realizados
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



## 4.1 TRIGGER 1: Actualizar stock al registrar venta
```sql
CREATE OR REPLACE FUNCTION trg_venta_descontar_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inv RECORD;
  v_venta RECORD;
BEGIN
  SELECT sede_id, vendedor_id INTO v_venta FROM ventas WHERE id = NEW.venta_id;

  SELECT id, cantidad INTO v_inv
  FROM inventario
  WHERE producto_id = NEW.producto_id AND sede_id = v_venta.sede_id
  FOR UPDATE;  -- Lock para concurrencia

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
END;
$$;

CREATE TRIGGER trg_after_insert_detalle_venta
  AFTER INSERT ON detalle_venta
  FOR EACH ROW EXECUTE FUNCTION trg_venta_descontar_stock();
```

## 4.2 TRIGGER 2: Stock al recibir compra
```sql
CREATE OR REPLACE FUNCTION trg_compra_sumar_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_compra RECORD;
  v_det RECORD;
  v_stock_ant INTEGER;
BEGIN
  IF NEW.recibida = true AND (OLD.recibida = false OR OLD.recibida IS NULL) THEN
    SELECT sede_destino_id, registrado_por INTO v_compra FROM compras WHERE id = NEW.id;

    FOR v_det IN SELECT * FROM detalle_compra WHERE compra_id = NEW.id LOOP
      -- Obtener stock anterior
      SELECT COALESCE(cantidad, 0) INTO v_stock_ant
      FROM inventario WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id;

      -- Upsert inventario
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

      -- Actualizar costo promedio ponderado
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
END;
$$;

CREATE TRIGGER trg_after_update_compra_recibida
  AFTER UPDATE OF recibida ON compras
  FOR EACH ROW EXECUTE FUNCTION trg_compra_sumar_stock();
```

## 4.3 TRIGGER 3: Traspaso salida (en_transito)
```sql
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
```

## 4.4 TRIGGER 4: Traspaso entrada (recibido)
```sql
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
```

## 4.5 FUNCIÓN 5: Actualizar estado de stock
```sql
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
```

## 4.6 TRIGGER 6: Ensamble — consumir componentes y producir
```sql
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
```

## 4.7 TRIGGER 7: Devolución — reingresar stock
```sql
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
```

## 4.8 TRIGGER 8: Orden servicio — descontar repuestos
```sql
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
```

## 4.9 TRIGGER 9: Recalcular totales de venta
```sql
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
```

## 4.10 FUNCIÓN 10: Clasificación ABC (cron semanal)
```sql
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
```

## 4.11 Protección contra DELETE
```sql
CREATE OR REPLACE FUNCTION trg_prevent_delete()
RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'DELETE no permitido. Use soft delete.'; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_no_delete_inventario BEFORE DELETE ON inventario
  FOR EACH ROW EXECUTE FUNCTION trg_prevent_delete();
CREATE TRIGGER trg_no_delete_movimientos BEFORE DELETE ON movimientos
  FOR EACH ROW EXECUTE FUNCTION trg_prevent_delete();
```

