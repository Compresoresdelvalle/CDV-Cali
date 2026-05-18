-- QA Campaña — Fase 4 (Ventas + Cotizaciones)
--
-- Hallazgo de seguridad: `descuento_pct` se aceptaba sin límite superior.
-- Un cliente malicioso (o un vendedor con devtools) podía llamar
-- `fn_registrar_venta` / `fn_registrar_cotizacion` con `descuento_pct = 200`
-- y obtener una venta a $0.
--
-- Este CHECK lo bloquea a nivel de motor, sin importar por qué camino se
-- inserte la fila. Verificado: ninguna fila existente viola el rango.

ALTER TABLE ventas
  ADD CONSTRAINT ventas_descuento_pct_rango
  CHECK (descuento_pct >= 0 AND descuento_pct <= 100);

ALTER TABLE cotizaciones
  ADD CONSTRAINT cotizaciones_descuento_pct_rango
  CHECK (descuento_pct >= 0 AND descuento_pct <= 100);
