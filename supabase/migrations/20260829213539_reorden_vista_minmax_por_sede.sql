-- Min/max por sede, paso 4: la vista de reorden usa el minimo de la SEDE
-- y deja de esconder los productos sin techo.
--
-- Dos cambios:
--
-- 1. `p.stock_minimo` / `p.stock_maximo` -> `i.stock_minimo` / `i.stock_maximo`.
--    Ahora `i.stock_minimo > 0` significa de verdad "esta sede controla este
--    producto", que es lo que la duena queria poder decidir.
--
-- 2. La trampa del maximo: `cantidad_sugerida = GREATEST(max - stock, 0)` y la
--    fila se descartaba si eso daba 0. Con `max = 0` ("sin techo") TODO producto
--    con minimo pero sin maximo alertaba y era imposible pedirlo desde Reorden,
--    y la campana de reposicion tampoco lo contaba. Ahora, sin techo, el
--    objetivo de reposicion es el minimo por `minmax_factor_max` (3 por
--    defecto). Reponer justo hasta el minimo no sirve: la comparacion es <=, asi
--    que volveria a quedar en "Bajo" el mismo dia.
CREATE OR REPLACE VIEW public.v_sugerencias_reorden AS
WITH cfg AS (
  SELECT COALESCE((SELECT valor FROM parametros WHERE clave = 'minmax_factor_max'), 3)
         AS factor_max
),
filas AS (
  SELECT p.id AS producto_id, p.referencia, p.nombre, p.categoria,
         p.clasificacion, p.clasificacion_global, p.vendible, p.costo_promedio,
         i.sede_id, s.nombre AS sede_nombre, i.estado_stock,
         i.stock_minimo, i.stock_maximo,
         CASE WHEN p.vendible THEN i.cantidad ELSE i.cantidad_insumo END AS existencias,
         CASE WHEN i.stock_maximo > 0 THEN i.stock_maximo
              ELSE GREATEST(1, (i.stock_minimo * c.factor_max)::integer)
         END AS objetivo
  FROM productos p
  JOIN inventario i ON i.producto_id = p.id
  JOIN sedes s ON s.id = i.sede_id
  CROSS JOIN cfg c
  WHERE p.activo = true AND s.activa = true AND i.stock_minimo > 0
)
SELECT producto_id,
       referencia,
       nombre,
       categoria,
       clasificacion,
       sede_id,
       sede_nombre,
       existencias AS stock_actual,
       stock_minimo,
       stock_maximo,
       GREATEST(objetivo - existencias, 0) AS cantidad_sugerida,
       costo_promedio,
       GREATEST(objetivo - existencias, 0)::numeric * costo_promedio AS costo_estimado_compra,
       estado_stock,
       vendible,
       clasificacion_global
FROM filas
WHERE existencias <= stock_minimo
  AND GREATEST(objetivo - existencias, 0) > 0
ORDER BY existencias;
