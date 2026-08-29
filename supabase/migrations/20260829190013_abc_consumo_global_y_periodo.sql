-- ABC de insumos: tres clasificaciones y periodo elegible.
--
-- Problema: el ABC miraba solo ventas de 90 dias y forzaba 'C' a todo lo que
-- no se vendio. Medido en produccion, 209 productos clasificados 'C' consumieron
-- $41.896.595 como insumo en 90 dias, mas que los A y B juntos.
--
-- Ahora hay tres respuestas a tres preguntas distintas:
--   clasificacion          -> que me deja plata        (ventas)
--   clasificacion_consumo  -> que se me acaba siempre  (ensambles + OT)
--   clasificacion_global   -> que no me puede faltar   (la que guia compras)
--
-- OJO con el consumo: las reversas (quitar un repuesto de una OT, devolver un
-- insumo de un ensamble) NO usan el tipo original. Los triggers
-- trg_ensamble_detalle_devolver y trg_orden_revertir_repuesto escriben
-- tipo='devolucion' POSITIVO con referencia_tipo en ('ensamble','orden_servicio').
-- Con sum(abs(cantidad)) un repuesto puesto y quitado contaria como consumido
-- para siempre. Por eso se usa sum(-cantidad): el consumo es negativo, la
-- reversa positiva, y se restan solas. Las devoluciones de cliente
-- (referencia_tipo='devolucion') quedan fuera a proposito.

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS clasificacion_consumo clasificacion_abc,
  ADD COLUMN IF NOT EXISTS clasificacion_global  clasificacion_abc;

COMMENT ON COLUMN public.productos.clasificacion_consumo IS
  'ABC por consumo como insumo (ensambles + OT), valorado a costo_promedio actual.';
COMMENT ON COLUMN public.productos.clasificacion_global IS
  'ABC combinado (ventas + consumo en pesos). Es la que guia Reorden y las compras.';

-- El periodo entra como parametro. CREATE OR REPLACE con un argumento nuevo NO
-- reemplaza: crea una sobrecarga, y entonces la llamada sin argumentos del cron
-- (`select public._fn_recalcular_abc_core()`) queda ambigua y falla con
-- "function is not unique". Hay que soltar las versiones viejas primero.
DROP FUNCTION IF EXISTS public.fn_recalcular_abc();
DROP FUNCTION IF EXISTS public._fn_recalcular_abc_core();

CREATE FUNCTION public._fn_recalcular_abc_core(p_dias integer DEFAULT 90)
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
      AND ( m.tipo IN ('ensamble_consumo', 'orden_consumo')
         OR (m.tipo = 'devolucion'
             AND m.referencia_tipo IN ('ensamble', 'orden_servicio')) )
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

CREATE FUNCTION public.fn_recalcular_abc(p_dias integer DEFAULT 90)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_rol text;
BEGIN
  SELECT rol::text INTO v_rol FROM usuarios WHERE id = auth.uid();
  IF v_rol IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Solo Admin puede recalcular clasificacion ABC';
  END IF;
  PERFORM public._fn_recalcular_abc_core(p_dias);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_recalcular_abc(integer) FROM anon;
REVOKE ALL ON FUNCTION public._fn_recalcular_abc_core(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_recalcular_abc(integer) TO authenticated;
