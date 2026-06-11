-- MEDIO (auditoría 2026-06-09):
--  M13(a) Abonos de OT canceladas se contaban como ingreso de servicios en el cierre
--         (_fn_cierre_totales: v_servicios global, por_sede.servicios, por_metodo)
--         y en el dashboard (fn_dashboard_kpis.ingresos_servicios_mes). fn_cancelar_orden
--         no anula los abonos y las agregaciones no filtraban o.estado.
--  M13(c) fn_alertas_rotacion no excluía ventas anuladas en el conteo de rotación
--         (a diferencia de fn_top_productos / fn_recalcular_abc).
--
-- Fix: filtrar o.estado <> 'cancelada' en TODAS las agregaciones de servicios del
-- cierre y del dashboard, y AND v.anulada = false en fn_alertas_rotacion.

-- (1) fn_alertas_rotacion: excluir ventas anuladas -------------------------------
create or replace function public.fn_alertas_rotacion(p_dias integer default 30, p_sede text default null::text)
 returns table(categoria text, producto_id uuid, nombre text, codigo_interno text, ventas_periodo integer, stock_actual integer, sede_id text)
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE v_desde TIMESTAMPTZ := now() - (p_dias || ' days')::INTERVAL;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;
  IF get_my_rol() <> 'Admin' THEN
    RAISE EXCEPTION 'Solo Admin puede consultar alertas de rotación';
  END IF;

  RETURN QUERY
  WITH ventas_periodo AS (
    SELECT dv.producto_id,
           SUM(dv.cantidad)::INT AS unidades,
           v.sede_id
      FROM detalle_venta dv
      JOIN ventas v ON v.id = dv.venta_id
     WHERE v.fecha >= v_desde
       AND v.anulada = false
       AND (p_sede IS NULL OR v.sede_id = p_sede)
     GROUP BY dv.producto_id, v.sede_id
  ),
  stock_actual AS (
    SELECT i.producto_id, i.sede_id, i.cantidad::INT AS stock
      FROM inventario i
     WHERE (p_sede IS NULL OR i.sede_id = p_sede)
  ),
  consolidado AS (
    SELECT s.producto_id, p.nombre, p.codigo_interno,
           s.sede_id, s.stock,
           COALESCE(vp.unidades, 0) AS ventas
      FROM stock_actual s
      JOIN productos p ON p.id = s.producto_id AND p.activo = TRUE
      LEFT JOIN ventas_periodo vp ON vp.producto_id = s.producto_id AND vp.sede_id = s.sede_id
  ),
  ranked AS (
    SELECT *,
      ROW_NUMBER() OVER (ORDER BY ventas DESC, stock DESC) AS rk_alta,
      ROW_NUMBER() OVER (ORDER BY ventas ASC, stock DESC)  AS rk_baja
      FROM consolidado
  )
  SELECT 'sobre_stock'::TEXT, r.producto_id, r.nombre, r.codigo_interno,
         r.ventas, r.stock, r.sede_id
    FROM ranked r WHERE r.ventas = 0 AND r.stock > 0
   UNION ALL
  SELECT 'mayor_rotacion'::TEXT, r.producto_id, r.nombre, r.codigo_interno,
         r.ventas, r.stock, r.sede_id
    FROM ranked r WHERE r.rk_alta <= 10 AND r.ventas > 0
   UNION ALL
  SELECT 'menor_rotacion'::TEXT, r.producto_id, r.nombre, r.codigo_interno,
         r.ventas, r.stock, r.sede_id
    FROM ranked r WHERE r.rk_baja <= 10 AND r.stock > 0 AND r.ventas > 0
  ORDER BY 1, 5 DESC;
END $function$;

-- (2) _fn_cierre_totales: excluir abonos de OT canceladas en servicios -----------
create or replace function public._fn_cierre_totales(p_desde date, p_hasta date)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_productos  NUMERIC := 0;
  v_servicios  NUMERIC := 0;
  v_egresos    NUMERIC := 0;
  v_cv INTEGER := 0;
  v_ca INTEGER := 0;
  v_cc INTEGER := 0;
  v_por_sede   JSONB;
  v_por_metodo JSONB;
BEGIN
  SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO v_productos, v_cv
  FROM ventas
  WHERE anulada = false
    AND (fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta;

  SELECT COALESCE(SUM(a.monto), 0), COUNT(*)
    INTO v_servicios, v_ca
  FROM abonos a
  JOIN ordenes_servicio o ON o.id = a.orden_id
  WHERE (a.fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta
    AND o.estado <> 'cancelada';

  SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO v_egresos, v_cc
  FROM compras
  WHERE (fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta
    AND estado <> 'cancelada';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'sede_id',     d.id,
           'sede_nombre', d.nombre,
           'productos',   d.productos,
           'servicios',   d.servicios,
           'egresos',     d.egresos
         ) ORDER BY d.nombre), '[]'::jsonb)
    INTO v_por_sede
  FROM (
    SELECT se.id, se.nombre,
      COALESCE((SELECT SUM(v.total) FROM ventas v
                WHERE v.sede_id = se.id AND v.anulada = false
                  AND (v.fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta), 0) AS productos,
      COALESCE((SELECT SUM(a.monto) FROM abonos a
                JOIN ordenes_servicio o ON o.id = a.orden_id
                WHERE o.sede_id = se.id
                  AND o.estado <> 'cancelada'
                  AND (a.fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta), 0) AS servicios,
      COALESCE((SELECT SUM(c.total) FROM compras c
                WHERE c.sede_destino_id = se.id
                  AND (c.fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta
                  AND c.estado <> 'cancelada'), 0) AS egresos
    FROM sedes se
    WHERE se.activa = true
  ) d;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'metodo',    m.metodo,
           'productos', m.productos,
           'servicios', m.servicios
         ) ORDER BY m.metodo), '[]'::jsonb)
    INTO v_por_metodo
  FROM (
    SELECT mp.metodo,
      COALESCE((SELECT SUM(v.total) FROM ventas v
                WHERE v.metodo_pago = mp.metodo AND v.anulada = false
                  AND (v.fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta), 0) AS productos,
      COALESCE((SELECT SUM(a.monto) FROM abonos a
                JOIN ordenes_servicio o ON o.id = a.orden_id
                WHERE a.metodo_pago = mp.metodo
                  AND o.estado <> 'cancelada'
                  AND (a.fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta), 0) AS servicios
    FROM (
      SELECT DISTINCT metodo FROM (
        SELECT metodo_pago AS metodo FROM ventas
          WHERE anulada = false
            AND (fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta
        UNION
        SELECT a.metodo_pago FROM abonos a
          JOIN ordenes_servicio o ON o.id = a.orden_id
          WHERE o.estado <> 'cancelada'
            AND (a.fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta
      ) u
      WHERE metodo IS NOT NULL
    ) mp
  ) m;

  RETURN jsonb_build_object(
    'ingresos_productos', v_productos,
    'ingresos_servicios', v_servicios,
    'ingresos_total',     v_productos + v_servicios,
    'egresos',            v_egresos,
    'margen',             v_productos + v_servicios - v_egresos,
    'count_ventas',       v_cv,
    'count_abonos',       v_ca,
    'count_compras',      v_cc,
    'detalle', jsonb_build_object(
      'por_sede',        v_por_sede,
      'por_metodo_pago', v_por_metodo,
      'generado_en',     now(),
      'tz',              'America/Bogota'
    )
  );
END;
$function$;

-- (3) fn_dashboard_kpis: parche quirúrgico (función muy grande) -------------------
-- Añade o.estado <> 'cancelada' a ingresos_servicios_mes sin retipear toda la función.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.fn_dashboard_kpis'::regproc);
  v_new := replace(v_def,
    '(a.fecha AT TIME ZONE ''America/Bogota'')::date >= v_mes_inicio AND (v_rol = ''Admin'' OR o.sede_id = v_sede)',
    '(a.fecha AT TIME ZONE ''America/Bogota'')::date >= v_mes_inicio AND o.estado <> ''cancelada'' AND (v_rol = ''Admin'' OR o.sede_id = v_sede)');
  if v_new = v_def then
    raise exception 'fn_dashboard_kpis: patrón ingresos_servicios_mes no encontrado — abortar';
  end if;
  execute v_new;
end $$;
