-- Vista para la pantalla de minimos: TODAS las combinaciones producto x sede,
-- existan o no en `inventario`.
--
-- Resuelve dos problemas de la pantalla `/ops/minimos`:
--
-- 1. No se podian configurar productos que la sede aun no tiene. La pantalla
--    partia de `inventario`, y hay 2.640 combinaciones producto x sede sin fila
--    (de 8.248 posibles). Justo el caso que `fn_definir_minmax` contempla con su
--    INSERT ... ON CONFLICT: L3 quiere que un filtro que hoy no tiene aparezca en
--    reposicion, pero no habia forma de llegar a el ni buscandolo.
--
-- 2. El listado salia ordenado por `producto_id`, o sea por UUID: orden
--    pseudoaleatorio, 40 paginas por sede, imposible retomar donde se quedo.
--    Con `referencia` como columna de primer nivel ya se puede ordenar y buscar
--    sin depender de una tabla embebida (PostgREST no ordena filas padre por
--    columnas del embed).
--
-- Una fila sin inventario se presenta con cantidad 0 y estado 'Agotado', que es
-- la verdad fisica; como su minimo es 0, no genera alerta.
--
-- security_invoker: la vista se evalua con los permisos de quien consulta, igual
-- que `v_faltantes_con_demanda`. La RLS de `inventario` es USING (true), asi que
-- no limita por sede sola: el filtro por sede va explicito en la consulta y la
-- ESCRITURA la sigue validando `fn_definir_minmax` contra el rol.
--
-- Rendimiento verificado con EXPLAIN ANALYZE: filtrando por sede y ordenando por
-- referencia, 10 ms. El planificador resuelve la sede por indice y deja el
-- CROSS JOIN en una sola fila de `sedes`.
CREATE OR REPLACE VIEW public.v_minmax_sede
WITH (security_invoker = true) AS
SELECT
  p.id                                    AS producto_id,
  p.referencia,
  p.nombre,
  p.categoria,
  p.vendible,
  s.id                                    AS sede_id,
  s.nombre                                AS sede_nombre,
  COALESCE(i.cantidad, 0)                 AS cantidad,
  COALESCE(i.cantidad_insumo, 0)          AS cantidad_insumo,
  COALESCE(i.stock_minimo, 0)             AS stock_minimo,
  COALESCE(i.stock_maximo, 0)             AS stock_maximo,
  COALESCE(i.estado_stock, 'Agotado'::estado_stock) AS estado_stock,
  (i.id IS NOT NULL)                      AS tiene_inventario
FROM productos p
CROSS JOIN sedes s
LEFT JOIN inventario i
       ON i.producto_id = p.id AND i.sede_id = s.id
WHERE p.activo = true AND s.activa = true;

GRANT SELECT ON public.v_minmax_sede TO authenticated;
