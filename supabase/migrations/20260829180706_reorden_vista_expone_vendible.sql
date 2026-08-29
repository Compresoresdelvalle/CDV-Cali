-- Reorden -> Compras: la vista expone `vendible`.
--
-- `v_sugerencias_reorden` usaba `p.vendible` por dentro (para decidir si el
-- stock relevante es `cantidad` o `cantidad_insumo`) pero no lo devolvia. Al
-- precargar el carrito de Nueva compra desde Reorden hace falta, porque el
-- carrito elige el destino con la misma regla que `agregarAlCarrito`:
-- un producto no vendible entra como insumo, no como stock de venta.
--
-- Sin esta columna, los 32 insumos del catalogo comprados desde Reorden
-- sumarian a `cantidad` en vez de `cantidad_insumo` y habria que convertirlos
-- a mano despues.
--
-- Cambio aditivo: la columna va al final, el resto de la vista queda igual.
CREATE OR REPLACE VIEW public.v_sugerencias_reorden AS
 SELECT p.id AS producto_id,
    p.referencia,
    p.nombre,
    p.categoria,
    p.clasificacion,
    i.sede_id,
    s.nombre AS sede_nombre,
        CASE
            WHEN p.vendible THEN i.cantidad
            ELSE i.cantidad_insumo
        END AS stock_actual,
    p.stock_minimo,
    p.stock_maximo,
    GREATEST(p.stock_maximo -
        CASE
            WHEN p.vendible THEN i.cantidad
            ELSE i.cantidad_insumo
        END, 0) AS cantidad_sugerida,
    p.costo_promedio,
    GREATEST(p.stock_maximo -
        CASE
            WHEN p.vendible THEN i.cantidad
            ELSE i.cantidad_insumo
        END, 0)::numeric * p.costo_promedio AS costo_estimado_compra,
    i.estado_stock,
    p.vendible
   FROM productos p
     JOIN inventario i ON i.producto_id = p.id
     JOIN sedes s ON s.id = i.sede_id
  WHERE p.activo = true AND s.activa = true AND p.stock_minimo > 0 AND
        CASE
            WHEN p.vendible THEN i.cantidad
            ELSE i.cantidad_insumo
        END <= p.stock_minimo AND GREATEST(p.stock_maximo -
        CASE
            WHEN p.vendible THEN i.cantidad
            ELSE i.cantidad_insumo
        END, 0) > 0
  ORDER BY (
        CASE
            WHEN p.vendible THEN i.cantidad
            ELSE i.cantidad_insumo
        END);
