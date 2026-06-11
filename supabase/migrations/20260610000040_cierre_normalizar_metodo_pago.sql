-- MEDIO (auditoría 2026-06-09, M13b): el desglose por_metodo_pago del cierre se
-- fragmentaba por inconsistencia de mayúsculas/minúsculas: en la BD coexisten
-- 'efectivo'/'Efectivo', 'tarjeta'/'Tarjeta', etc., y v_por_metodo agrupaba por el
-- valor crudo → el mismo método aparecía como dos líneas en el arqueo de caja.
--
-- Fix: agrupar por lower(metodo_pago) (fusiona variantes) y devolver la clave en
-- minúscula, que es la que mapea METODO_LABELS en el frontend (se le agrega 'crédito').
-- No se normalizan los datos históricos a propósito: 'Crédito' es un valor centinela
-- usado en muchos WHERE (metodo_pago='Crédito'); aquí solo se normaliza el AGRUPAMIENTO
-- del reporte, sin tocar las filas. El resto de _fn_cierre_totales queda igual que en
-- la migración 20260610000029.

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

  -- por_metodo: normalizado por lower(metodo) para no fragmentar el arqueo.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'metodo',    m.metodo,
           'productos', m.productos,
           'servicios', m.servicios
         ) ORDER BY m.metodo), '[]'::jsonb)
    INTO v_por_metodo
  FROM (
    SELECT lower(t.metodo) AS metodo,
           SUM(t.productos) AS productos,
           SUM(t.servicios) AS servicios
    FROM (
      SELECT v.metodo_pago AS metodo, v.total AS productos, 0::numeric AS servicios
        FROM ventas v
       WHERE v.anulada = false
         AND (v.fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta
      UNION ALL
      SELECT a.metodo_pago, 0::numeric, a.monto
        FROM abonos a
        JOIN ordenes_servicio o ON o.id = a.orden_id
       WHERE o.estado <> 'cancelada'
         AND (a.fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta
    ) t
    WHERE t.metodo IS NOT NULL
    GROUP BY lower(t.metodo)
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
