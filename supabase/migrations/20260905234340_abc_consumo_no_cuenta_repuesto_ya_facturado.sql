-- La clasificación COMBINADA contaba dos veces el mismo repuesto de OT.
--
-- Un repuesto que se pone en una orden de trabajo entra por dos puertas: como
-- VENTA (la OT entregada genera una venta con `origen='ot'`, y el repuesto va
-- en su detalle) y como CONSUMO (el movimiento `orden_consumo` que lo descarga
-- del inventario). La combinada suma valor de venta + valor de consumo, así que
-- las mismas unidades pesaban dos veces.
--
-- Con los ensambles NO pasa, y por eso el diseño original tenía sentido: ahí el
-- componente se consume pero no se factura suelto, así que solo entra por
-- consumo. El sesgo es específico de los repuestos de OT.
--
-- Medido sobre 90 días: de 595 consumos de OT, 527 eran de órdenes ya
-- facturadas y en 526 de ellos el repuesto estaba en el detalle de la venta.
-- Al corregirlo, 18 de 2.070 productos cambian de clase. Cuatro dejan de ser A
-- (FLAPPER 2080, NIPLE ACERO 1/4, BIELA 2065-3065, FILTRO AIRE TORNILLO): su
-- consumo era 100% repuesto ya facturado, así que estaban compitiendo con el
-- doble de peso contra los productos de mostrador.
--
-- La condición se aplica por PRODUCTO y no solo por orden: hay un caso donde la
-- OT se facturó pero ese repuesto no quedó en el detalle de la venta, y ahí el
-- consumo sí debe contar porque no está representado en ninguna venta.
--
-- Las devoluciones de repuestos de OT llevan el mismo filtro. Son la reversa de
-- un `orden_consumo`: excluir el consumo y dejar su reversa restando dejaría un
-- descuento sin base (14 movimientos en el periodo).
--
-- Lo que NO cambia: la clasificación por ventas y la de consumo puro siguen
-- exactamente igual. Solo se corrige la combinada, que es la que usan Reorden y
-- el filtro ABC de Mínimos.
CREATE OR REPLACE FUNCTION public._fn_recalcular_abc_core(p_dias integer DEFAULT 90)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dias integer := COALESCE(p_dias, 90);
BEGIN
  IF v_dias < 1 OR v_dias > 3650 THEN
    RAISE EXCEPTION 'El periodo debe estar entre 1 y 3650 dias (recibido: %). Elige mes, trimestre o ano.', v_dias;
  END IF;

  WITH ventas_periodo AS (
    SELECT dv.producto_id, sum(dv.subtotal)::numeric AS valor
    FROM detalle_venta dv
    JOIN ventas v ON v.id = dv.venta_id
    WHERE v.fecha >= now() - (v_dias || ' days')::interval
      AND v.anulada = false
      AND v.origen IN ('directa', 'ot')
      AND dv.producto_id IS NOT NULL
    GROUP BY 1
  ),
  consumo_periodo AS (
    SELECT m.producto_id, sum(-m.cantidad)::numeric AS uds
    FROM movimientos m
    WHERE m.fecha >= now() - (v_dias || ' days')::interval
      AND m.producto_id IS NOT NULL
      AND ( m.tipo = 'ensamble_consumo'
         OR (m.tipo = 'devolucion' AND m.referencia_tipo = 'ensamble')
         -- Repuestos de OT: solo cuentan si NO quedaron facturados en la venta
         -- de esa misma orden. Si ya se cobraron, su peso vive en el valor de
         -- venta y sumarlos aqui seria contarlos dos veces.
         OR ( m.tipo IN ('orden_consumo', 'devolucion')
              AND m.referencia_tipo = 'orden_servicio'
              AND NOT EXISTS (
                    SELECT 1
                    FROM ordenes_servicio o
                    JOIN detalle_venta dv ON dv.venta_id = o.venta_id
                    WHERE o.id = m.referencia_id
                      AND dv.producto_id = m.producto_id) ) )
    GROUP BY 1
    HAVING sum(-m.cantidad) > 0
  ),
  base AS (
    SELECT p.id AS producto_id,
           COALESCE(vp.valor, 0) AS v_venta,
           COALESCE(cp.uds, 0) * COALESCE(p.costo_promedio, 0) AS v_consumo
    FROM productos p
    LEFT JOIN ventas_periodo  vp ON vp.producto_id = p.id
    LEFT JOIN consumo_periodo cp ON cp.producto_id = p.id
    WHERE p.activo = true
  ),
  calc AS (
    SELECT producto_id, v_venta, v_consumo, (v_venta + v_consumo) AS v_total,
      sum(v_venta) OVER (ORDER BY v_venta DESC)
        / nullif(sum(v_venta) OVER (), 0) * 100 AS pct_venta,
      sum(v_consumo) OVER (ORDER BY v_consumo DESC)
        / nullif(sum(v_consumo) OVER (), 0) * 100 AS pct_consumo,
      sum(v_venta + v_consumo) OVER (ORDER BY (v_venta + v_consumo) DESC)
        / nullif(sum(v_venta + v_consumo) OVER (), 0) * 100 AS pct_global
    FROM base
  ),
  letras AS (
    SELECT producto_id,
      (CASE WHEN v_venta   <= 0        THEN 'C'
            WHEN pct_venta   <= 80     THEN 'A'
            WHEN pct_venta   <= 95     THEN 'B'
            ELSE 'C' END)::clasificacion_abc AS abc_venta,
      (CASE WHEN v_consumo <= 0        THEN 'C'
            WHEN pct_consumo <= 80     THEN 'A'
            WHEN pct_consumo <= 95     THEN 'B'
            ELSE 'C' END)::clasificacion_abc AS abc_consumo,
      -- La global NO fuerza 'C' por no venderse: ahi esta el arreglo del sesgo.
      (CASE WHEN v_total   <= 0        THEN 'C'
            WHEN pct_global  <= 80     THEN 'A'
            WHEN pct_global  <= 95     THEN 'B'
            ELSE 'C' END)::clasificacion_abc AS abc_global
    FROM calc
  )
  UPDATE productos p SET
    clasificacion         = l.abc_venta,
    clasificacion_consumo = l.abc_consumo,
    clasificacion_global  = l.abc_global,
    updated_at            = now()
  FROM letras l
  WHERE p.id = l.producto_id
    AND (p.clasificacion         IS DISTINCT FROM l.abc_venta
      OR p.clasificacion_consumo IS DISTINCT FROM l.abc_consumo
      OR p.clasificacion_global  IS DISTINCT FROM l.abc_global);
END;
$function$;
