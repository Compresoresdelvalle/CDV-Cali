-- La pantalla de Mínimos no podía filtrar por ABC porque la vista no exponía la
-- clasificación. Con 2.070 productos por sede, poder ir directo a los A —los
-- que no pueden faltar— es la diferencia entre configurar lo importante y
-- perderse en la lista.
--
-- `clase_abc` es una sola columna ya resuelta, no las dos crudas, para que el
-- filtro sea un `eq` simple desde PostgREST y para no repetir en el frontend la
-- regla de cuál manda. Es la misma que usa Reorden (`claseReorden`): manda la
-- COMBINADA (ventas + consumo como insumo), porque aquí la pregunta tampoco es
-- "qué deja plata" sino "qué no me puede faltar" — un cabezote casi no se vende
-- suelto pero se consume en cada ensamble. Cae a la de ventas solo como red de
-- seguridad: un producto recién creado no tiene combinada hasta el siguiente
-- recálculo (8 de 2.070 hoy).
--
-- Va al final: CREATE OR REPLACE VIEW solo admite columnas nuevas al final, no
-- intercaladas.
--
-- Se conserva `security_invoker=true`: sin él la vista correría con los
-- permisos del dueño y se saltaría la RLS de inventario.
CREATE OR REPLACE VIEW public.v_minmax_sede
WITH (security_invoker = true) AS
SELECT p.id AS producto_id,
    p.referencia,
    p.nombre,
    p.categoria,
    p.vendible,
    s.id AS sede_id,
    s.nombre AS sede_nombre,
    COALESCE(i.cantidad, 0) AS cantidad,
    COALESCE(i.cantidad_insumo, 0) AS cantidad_insumo,
    COALESCE(i.stock_minimo, 0) AS stock_minimo,
    COALESCE(i.stock_maximo, 0) AS stock_maximo,
    COALESCE(i.estado_stock, 'Agotado'::estado_stock) AS estado_stock,
    i.id IS NOT NULL AS tiene_inventario,
    COALESCE(p.clasificacion_global, p.clasificacion)::text AS clase_abc
   FROM productos p
     CROSS JOIN sedes s
     LEFT JOIN inventario i ON i.producto_id = p.id AND i.sede_id = s.id
  WHERE p.activo = true AND s.activa = true;

COMMENT ON VIEW public.v_minmax_sede IS
  'Todos los productos activos cruzados con todas las sedes activas, para configurar minimos y maximos incluso donde nunca ha habido inventario. clase_abc es la combinada (clasificacion_global) con respaldo en la de ventas.';
