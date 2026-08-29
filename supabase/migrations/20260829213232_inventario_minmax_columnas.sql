-- Min/max por sede, paso 1: las columnas viven en `inventario`.
--
-- Hasta hoy `stock_minimo` y `stock_maximo` estaban en `productos`: un solo
-- valor para las cuatro sedes. Una sede que no maneja un producto alertaba
-- igual que la que lo vende todos los dias.
--
-- El default 0 es deliberado: una fila nueva entra CALLADA. Un producto que
-- llega por primera vez a una sede no debe gritar; una alerta falsa entrena a
-- la gente a ignorar las alertas.
ALTER TABLE public.inventario
  ADD COLUMN IF NOT EXISTS stock_minimo INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_maximo INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.inventario.stock_minimo IS
  'Minimo de esta sede. 0 = la sede no maneja el producto: no genera alerta.';
COMMENT ON COLUMN public.inventario.stock_maximo IS
  'Maximo de esta sede. 0 = sin techo: nunca marca Sobrestock.';

-- Copia del valor global a TODAS las sedes del producto, que es la traduccion
-- honesta de lo que significaba antes. Luego se ajusta sede por sede.
-- Va ANTES de las restricciones para que estas validen el dato ya migrado.
UPDATE public.inventario i SET
  stock_minimo = COALESCE(p.stock_minimo, 0),
  stock_maximo = COALESCE(p.stock_maximo, 0)
FROM public.productos p
WHERE p.id = i.producto_id
  AND (COALESCE(p.stock_minimo, 0) > 0 OR COALESCE(p.stock_maximo, 0) > 0);

ALTER TABLE public.inventario
  DROP CONSTRAINT IF EXISTS inventario_minmax_no_negativo,
  ADD CONSTRAINT inventario_minmax_no_negativo
    CHECK (stock_minimo >= 0 AND stock_maximo >= 0);

-- Impide el estado imposible min=5/max=3, que dejaria la fila siendo "Bajo" y
-- "Sobrestock" a la vez. max=0 se permite: significa "sin techo".
ALTER TABLE public.inventario
  DROP CONSTRAINT IF EXISTS inventario_max_mayor_que_min,
  ADD CONSTRAINT inventario_max_mayor_que_min
    CHECK (stock_maximo = 0 OR stock_maximo >= stock_minimo);

-- Bitacora. Ahora que las vendedoras y bodega pueden configurar su sede, si las
-- alertas de un producto se apagan tiene que poder saberse quien las apago.
-- Espejo de `productos_precio_costo_log`, que hace lo mismo con los precios.
CREATE TABLE IF NOT EXISTS public.inventario_minmax_log (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id  uuid NOT NULL REFERENCES public.productos(id),
  sede_id      text NOT NULL REFERENCES public.sedes(id),
  min_anterior integer,
  max_anterior integer,
  min_nuevo    integer NOT NULL,
  max_nuevo    integer NOT NULL,
  usuario_id   uuid,
  fecha        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_minmax_log_producto_sede
  ON public.inventario_minmax_log (producto_id, sede_id, fecha DESC);

ALTER TABLE public.inventario_minmax_log ENABLE ROW LEVEL SECURITY;

-- Lectura para todos los autenticados (es informacion de configuracion, no
-- sensible). La escritura NO tiene politica: solo entra por el RPC
-- SECURITY DEFINER, igual que el resto de escrituras de inventario.
DROP POLICY IF EXISTS minmax_log_select ON public.inventario_minmax_log;
CREATE POLICY minmax_log_select ON public.inventario_minmax_log
  FOR SELECT TO authenticated USING (true);

-- Perilla para el asistente: la demanda de una sede incluye lo que despacha por
-- traspaso. Sin esto, BODEGA (32.943 unidades despachadas contra 16 vendidas en
-- 90 dias) recibiria "minimo 1" en todo el catalogo.
INSERT INTO public.parametros (clave, valor, descripcion)
VALUES ('minmax_incluir_traspasos', 1,
        'Contar traspasos de salida como demanda de la sede (1 = si, 0 = no)')
ON CONFLICT (clave) DO NOTHING;
