-- ============================================================================
-- Bloque 2 — A1: esquema aditivo para insumos (pool de stock) y ubicación.
-- Aditivo y reversible. No usa valores nuevos de enum (esos van en A2).
--   - inventario.cantidad_insumo: balde de stock reservado para insumo, separado
--     de `cantidad` (= stock de venta). Espeja el tipo/constraint de `cantidad`.
--   - productos.vendible: false = insumo puro, se oculta en Ventas/Cotizaciones.
--   - productos.stand / posicion: ubicación física (STAND 1-8 + POSICIÓN).
--   - tabla stands: catálogo de los 8 stands con su cercanía a la puerta (para
--     que el módulo ABC recomiende el orden más adelante — Bloque 9).
-- ============================================================================

-- Catálogo de stands (layout en U; entrada por el lado corto, fondo arriba).
CREATE TABLE IF NOT EXISTS public.stands (
  numero         SMALLINT PRIMARY KEY CHECK (numero BETWEEN 1 AND 8),
  orden_cercania SMALLINT NOT NULL,   -- 1 = más cerca de la puerta
  lado           TEXT     NOT NULL,
  descripcion    TEXT
);

INSERT INTO public.stands (numero, orden_cercania, lado, descripcion) VALUES
  (1, 1, 'derecha-abajo',   'Junto a la entrada, pared derecha'),
  (8, 1, 'izquierda-abajo', 'Junto a la entrada, pared izquierda'),
  (2, 2, 'derecha-medio',   'Pared derecha, medio'),
  (7, 2, 'izquierda-medio', 'Pared izquierda, medio'),
  (3, 3, 'derecha-arriba',  'Pared derecha, hacia el fondo'),
  (6, 3, 'izquierda-arriba','Pared izquierda, hacia el fondo'),
  (4, 4, 'fondo-derecha',   'Fondo, lado derecho (más lejos)'),
  (5, 4, 'fondo-izquierda', 'Fondo, lado izquierdo (más lejos)')
ON CONFLICT (numero) DO NOTHING;

-- RLS: el catálogo de stands es de solo lectura para usuarios autenticados.
ALTER TABLE public.stands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stands_select ON public.stands;
CREATE POLICY stands_select ON public.stands FOR SELECT TO authenticated USING (true);

-- Pool de insumo en inventario (mismo tipo y check que `cantidad`).
ALTER TABLE public.inventario
  ADD COLUMN IF NOT EXISTS cantidad_insumo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.inventario
  DROP CONSTRAINT IF EXISTS inventario_cantidad_insumo_check;
ALTER TABLE public.inventario
  ADD CONSTRAINT inventario_cantidad_insumo_check CHECK (cantidad_insumo >= 0);

-- Producto: vendible (insumo puro = false) + ubicación física.
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS vendible BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS stand SMALLINT;
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS posicion SMALLINT;

-- FK de stand → stands.numero (nullable: un producto puede no tener ubicación aún).
ALTER TABLE public.productos
  DROP CONSTRAINT IF EXISTS productos_stand_fkey;
ALTER TABLE public.productos
  ADD CONSTRAINT productos_stand_fkey FOREIGN KEY (stand) REFERENCES public.stands(numero);
