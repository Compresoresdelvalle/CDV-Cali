-- Reorden prioriza por el ABC combinado (ventas + consumo como insumo).
--
-- La vista ya devolvia `p.clasificacion`, que es el ABC de VENTAS. Para decidir
-- que se compra primero, la pregunta correcta no es "que me deja plata" sino
-- "que no me puede faltar": ahi entran los cabezotes, tanques y motores que casi
-- no se venden sueltos pero se consumen en cada ensamble.
--
-- Se agrega `clasificacion_global` al final SIN tocar `clasificacion`: cambiarle
-- el significado a una columna existente es peor que agregar una nueva, porque
-- rompe en silencio a quien ya la lea.
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
    p.vendible,
    p.clasificacion_global
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
