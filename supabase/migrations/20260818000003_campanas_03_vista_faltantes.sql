-- Campanas del header, parte 3: lo que esa sede sí vende y hoy está en cero.
-- Cubre el punto ciego de v_sugerencias_reorden: 2.792 SKUs no tienen
-- stock_minimo configurado, así que esa vista es ciega a ellos. Esta mide
-- plata que se deja de vender, no cumplimiento de un parámetro.

CREATE OR REPLACE VIEW public.v_faltantes_con_demanda
WITH (security_invoker = true) AS
WITH demanda AS (
  SELECT v.sede_id,
         dv.producto_id,
         count(DISTINCT v.id)::int AS ventas_90d,
         sum(dv.cantidad)::int     AS unidades_90d,
         max(v.created_at)         AS ultima_venta
    FROM detalle_venta dv
    JOIN ventas v ON v.id = dv.venta_id
   WHERE v.created_at > now() - interval '90 days'
     AND NOT v.anulada
     AND dv.producto_id IS NOT NULL   -- las líneas de servicio no llevan producto
   GROUP BY 1, 2
)
SELECT i.producto_id,
       p.referencia,
       p.nombre,
       p.clasificacion,
       i.sede_id,
       s.nombre AS sede_nombre,
       d.ventas_90d,
       d.unidades_90d,
       d.ultima_venta
  FROM inventario i
  JOIN productos p ON p.id = i.producto_id
  JOIN demanda   d ON d.producto_id = i.producto_id AND d.sede_id = i.sede_id
  LEFT JOIN sedes s ON s.id = i.sede_id
 WHERE p.activo
   AND i.cantidad = 0;

COMMENT ON VIEW public.v_faltantes_con_demanda IS
  'Productos en cero en una sede que esa misma sede vendió en los últimos 90 días. Segunda pestaña del botón de Reposición.';
