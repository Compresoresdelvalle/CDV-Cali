-- Corrige costo_promedio de 6 productos cuyo UPDATE de costo fue revertido en silencio
-- por el guard `productos_costo_guard` al recibir la compra siendo el usuario no-Admin.
--
-- Solo se tocan productos con CERTEZA MATEMÁTICA, no estimación: aquellos cuyo
-- stock global previo a la recepción era 0. En ese caso la fórmula del trigger
-- `trg_compra_sumar_stock` colapsa a `costo_promedio := costo_unitario`, sin
-- depender del stock. Verificado por producto:
--   * aparece en UNA sola línea de detalle_compra en toda la historia
--   * esa compra tiene recibida = true
--   * no existe NINGÚN movimiento anterior a esa compra
--   * SUM(movimientos.cantidad) == stock global actual (movimientos explican el inventario)
--   * sin ediciones manuales previas en productos_precio_costo_log
--
-- El trigger `trg_productos_log_precio_costo` registra el cambio automáticamente
-- en productos_precio_costo_log (usuario_id NULL = corrección de sistema).
-- Sin redondeo: todos los costo_unitario ya son pesos COP enteros.

UPDATE productos p
   SET costo_promedio = dc.costo_unitario,
       updated_at = now()
  FROM detalle_compra dc
  JOIN compras c ON c.id = dc.compra_id
 WHERE dc.producto_id = p.id
   AND c.recibida = true
   AND p.referencia IN ('F75ECO','R1218','C25AM','31A1/2','31A24','61A28')
   AND NOT EXISTS (
     SELECT 1 FROM movimientos m
      WHERE m.producto_id = p.id
        AND m.fecha < (SELECT MIN(m2.fecha) FROM movimientos m2
                        WHERE m2.producto_id = p.id AND m2.tipo = 'compra')
   );
