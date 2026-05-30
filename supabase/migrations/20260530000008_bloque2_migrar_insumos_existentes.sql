-- ============================================================================
-- Bloque 2 — A4: migrar los insumos puros ya existentes (categoria='INSUMOS').
-- Requiere A1 (vendible, cantidad_insumo) ya aplicado.
--   - vendible=false  -> se ocultan de Ventas/Cotizaciones.
--   - su stock de venta pasa al pool de insumo (sin cambio físico de stock; es
--     setup único). El stock total (cantidad+cantidad_insumo) NO cambia.
-- No se registran movimientos: es una reclasificación de baldes, no una entrada
-- ni salida real de stock (y se documenta aquí).
-- ============================================================================

UPDATE public.productos
   SET vendible = false, updated_at = now()
 WHERE categoria = 'INSUMOS' AND vendible = true;

UPDATE public.inventario i
   SET cantidad_insumo = i.cantidad_insumo + i.cantidad,
       cantidad        = 0,
       ultimo_movimiento = now(),
       updated_at = now()
  FROM public.productos p
 WHERE p.id = i.producto_id
   AND p.categoria = 'INSUMOS'
   AND i.cantidad > 0;

-- Recalcular estado_stock (venta) de esos productos tras vaciar `cantidad`.
UPDATE public.inventario i
   SET estado_stock = (CASE
         WHEN i.cantidad = 0 THEN 'Agotado'
         WHEN i.cantidad <= p.stock_minimo THEN 'Bajo'
         WHEN i.cantidad > p.stock_maximo THEN 'Sobrestock'
         ELSE 'OK'
       END)::estado_stock,
       updated_at = now()
  FROM public.productos p
 WHERE p.id = i.producto_id
   AND p.categoria = 'INSUMOS';
