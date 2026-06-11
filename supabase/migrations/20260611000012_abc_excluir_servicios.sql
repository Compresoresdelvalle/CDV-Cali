-- BUG (sweep 2026-06-11) — fn_recalcular_abc tenía DOS defectos:
--
-- (A) Mismo estilo que la anulación con servicios: agrega detalle_venta por producto_id,
--     pero las líneas de servicio tienen producto_id = NULL.
--       1) La sentencia que degrada a 'C' los productos sin ventas usa
--          `WHERE id NOT IN (SELECT dv.producto_id FROM detalle_venta ...)`. En cuanto hay
--          UNA venta de servicio en la ventana, ese subquery devuelve un NULL y, por la
--          semántica SQL, `id NOT IN (..., NULL)` NUNCA es verdadero → degrada CERO
--          productos (inerte y silencioso). Verificado: con 3 servicios en 90d, la vieja
--          lógica degradaba 0 y la nueva 1854.
--       2) El denominador de pct_acum incluía el subtotal de servicios, sesgando el ABC.
--     Fix: excluir las líneas de servicio (producto_id IS NOT NULL) de ambas agregaciones
--     y alinear el segundo subquery con v.anulada = false.
--
-- (B) Defecto pre-existente independiente: la columna productos.clasificacion es el enum
--     clasificacion_abc, pero el primer UPDATE asignaba `CASE ... END` (tipo text) sin
--     cast → la función SIEMPRE abortaba con "column clasificacion is of type
--     clasificacion_abc but expression is of type text". Es decir, la recalculación ABC
--     nunca funcionó. Fix: castear el CASE (y el literal 'C') a ::clasificacion_abc.

create or replace function public.fn_recalcular_abc()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE v_rol TEXT;
BEGIN
  SELECT rol::TEXT INTO v_rol FROM usuarios WHERE id = auth.uid();
  IF v_rol IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Solo Admin puede recalcular clasificación ABC';
  END IF;

  WITH ventas_90d AS (
    SELECT dv.producto_id, SUM(dv.subtotal) AS total_vendido
    FROM detalle_venta dv JOIN ventas v ON v.id = dv.venta_id
    WHERE v.fecha >= now() - INTERVAL '90 days' AND v.anulada = false
      AND dv.producto_id IS NOT NULL
    GROUP BY dv.producto_id
  ),
  ranked AS (
    SELECT producto_id, total_vendido,
      SUM(total_vendido) OVER (ORDER BY total_vendido DESC) /
      NULLIF(SUM(total_vendido) OVER (), 0) * 100 AS pct_acum
    FROM ventas_90d
  )
  UPDATE productos SET
    clasificacion = (CASE
      WHEN r.pct_acum <= 80 THEN 'A'
      WHEN r.pct_acum <= 95 THEN 'B'
      ELSE 'C'
    END)::clasificacion_abc, updated_at = now()
  FROM ranked r WHERE productos.id = r.producto_id;

  UPDATE productos SET clasificacion = 'C'::clasificacion_abc, updated_at = now()
  WHERE id NOT IN (
    SELECT dv.producto_id FROM detalle_venta dv
    JOIN ventas v ON v.id = dv.venta_id
    WHERE v.fecha >= now() - INTERVAL '90 days' AND v.anulada = false
      AND dv.producto_id IS NOT NULL
  ) AND activo = true;
END; $function$;
