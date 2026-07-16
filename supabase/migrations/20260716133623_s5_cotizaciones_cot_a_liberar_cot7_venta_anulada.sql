-- COT-A data fix: cotización #7 quedó bloqueada porque su venta #51 fue anulada
-- sin limpiar cotizaciones.venta_id. Se libera para permitir su reconversión.
UPDATE cotizaciones SET venta_id = NULL, updated_at = now()
 WHERE id = '88172d3e-9d9e-4d6e-9477-ba344ed7a2cf'
   AND venta_id = 'a780f82e-de84-4270-85f4-624c24603802';
