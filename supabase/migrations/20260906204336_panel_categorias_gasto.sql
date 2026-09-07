-- Categorias de gasto: lo que hace posible calcular un Resultado.
--
-- Hoy `es_caja_menor` es el cajon donde cae toda la plata que sale y no es
-- mercancia: 465 movimientos y 111.085.942,81 en 90 dias, ninguno con items.
-- Ahi estan mezcladas tres cosas distintas, y con el concepto en texto libre y
-- revuelto ('NOMIN', 'NOMINAS', 'NOM E' son todos nomina escritos diferente):
--
--   1. gastos de verdad (nomina, arriendo) -> restan del resultado
--   2. abonos a proveedores -> NO son gasto: pagan mercancia que ya esta
--      contada dentro del costo de lo vendido. Restarlos seria contar dos veces.
--   3. traslados entre cuentas ('BANCOS') -> no son ni gasto ni ingreso
--
-- `afecta_resultado` es lo que separa el 1 del 2 y el 3. Sin esa distincion,
-- cualquier Resultado que se calcule esta mal por construccion.
--
-- Verificado: 465 egresos por 111.085.942,81 antes y despues, identico.
CREATE TABLE public.categorias_gasto (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre            text NOT NULL UNIQUE,
  afecta_resultado  boolean NOT NULL DEFAULT true,
  descripcion       text,
  activa            boolean NOT NULL DEFAULT true,
  orden             int NOT NULL DEFAULT 100,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.categorias_gasto.afecta_resultado IS
  'false = la salida de plata no es un gasto del periodo (abono a proveedor, traslado entre cuentas). Restarla del resultado seria contarla dos veces.';

INSERT INTO public.categorias_gasto (nombre, afecta_resultado, descripcion, orden) VALUES
  ('Nómina',                 true,  'Sueldos, prestaciones y pagos al personal', 10),
  ('Arriendo',               true,  'Arriendo de locales y bodega', 20),
  ('Servicios públicos',     true,  'Energía, agua, internet, teléfono', 30),
  ('Transporte',             true,  'Fletes, mensajería, combustible', 40),
  ('Mantenimiento',          true,  'Reparaciones y mantenimiento de la operación', 50),
  ('Impuestos y bancos',     true,  'Impuestos, comisiones y gastos bancarios', 60),
  ('Otros gastos',           true,  'Gasto real que no cabe en las demás', 90),
  ('Abono a proveedor',      false, 'Paga mercancía ya contada en el costo de lo vendido: NO es gasto del periodo', 100),
  ('Traslado entre cuentas', false, 'Mover plata de un lado a otro: no es ni gasto ni ingreso', 110);

ALTER TABLE public.compras
  ADD COLUMN categoria_gasto_id bigint REFERENCES public.categorias_gasto(id);

COMMENT ON COLUMN public.compras.categoria_gasto_id IS
  'Solo para egresos puros (es_caja_menor). Una compra de mercancia no lleva categoria de gasto: su plata ya vive en el costo de lo vendido.';

CREATE INDEX idx_compras_categoria_gasto
  ON public.compras (categoria_gasto_id)
  WHERE es_caja_menor = true;

-- Para la bandeja de clasificacion, que lista lo pendiente por fecha.
CREATE INDEX idx_compras_egresos_sin_clasificar
  ON public.compras (fecha DESC)
  WHERE es_caja_menor = true AND categoria_gasto_id IS NULL;

ALTER TABLE public.categorias_gasto ENABLE ROW LEVEL SECURITY;

-- Cualquiera autenticado lee (la pantalla de compras muestra la categoria al
-- registrar un egreso); solo Admin toca el catalogo.
CREATE POLICY categorias_gasto_select ON public.categorias_gasto
  FOR SELECT TO authenticated USING (true);
CREATE POLICY categorias_gasto_admin ON public.categorias_gasto
  FOR ALL TO authenticated
  USING ((SELECT get_my_rol()) = 'Admin')
  WITH CHECK ((SELECT get_my_rol()) = 'Admin');
