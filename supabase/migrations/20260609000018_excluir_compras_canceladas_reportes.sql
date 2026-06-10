-- ALTO (auditoría 2026-06-09): los egresos del cierre y el KPI compras_mes
-- sumaban compras CANCELADAS, inflando egresos y subestimando el margen (las
-- ventas ya filtran anulada=false, pero las compras canceladas no tenían
-- tratamiento equivalente). Descuadre real reproducible.
--
-- Fix: agregar `estado <> 'cancelada'` a las 3 agregaciones de compras:
--   _fn_cierre_totales -> v_egresos y por_sede.egresos
--   fn_dashboard_kpis  -> compras_mes
-- (estado es NOT NULL; enum: completada/devolucion_garantia/cancelada. Solo se
--  excluye 'cancelada': una compra cancelada no representó egreso de caja.)

CREATE OR REPLACE FUNCTION public._fn_cierre_totales(p_desde date, p_hasta date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  SELECT COALESCE(SUM(monto), 0), COUNT(*)
    INTO v_servicios, v_ca
  FROM abonos
  WHERE (fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta;

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
                WHERE a.metodo_pago = mp.metodo
                  AND (a.fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta), 0) AS servicios
    FROM (
      SELECT DISTINCT metodo FROM (
        SELECT metodo_pago AS metodo FROM ventas
          WHERE anulada = false
            AND (fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta
        UNION
        SELECT metodo_pago FROM abonos
          WHERE (fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta
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

CREATE OR REPLACE FUNCTION public.fn_dashboard_kpis()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT; v_sede TEXT;
  v_result JSONB;
  v_hoy           DATE := (now() AT TIME ZONE 'America/Bogota')::date;
  v_semana_inicio DATE := date_trunc('week',  (now() AT TIME ZONE 'America/Bogota'))::date;
  v_mes_inicio    DATE := date_trunc('month', (now() AT TIME ZONE 'America/Bogota'))::date;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'no_session'); END IF;
  SELECT rol::TEXT, sede_id INTO v_rol, v_sede FROM usuarios WHERE id = v_uid;
  SELECT jsonb_build_object(
    'ventas_hoy', (SELECT COALESCE(SUM(total),0) FROM ventas WHERE (fecha AT TIME ZONE 'America/Bogota')::date = v_hoy AND anulada = false AND (v_rol = 'Admin' OR sede_id = v_sede)),
    'ventas_ayer', (SELECT COALESCE(SUM(total),0) FROM ventas WHERE (fecha AT TIME ZONE 'America/Bogota')::date = v_hoy - 1 AND anulada = false AND (v_rol = 'Admin' OR sede_id = v_sede)),
    'ventas_semana', (SELECT COALESCE(SUM(total),0) FROM ventas WHERE (fecha AT TIME ZONE 'America/Bogota')::date >= v_semana_inicio AND anulada = false AND (v_rol = 'Admin' OR sede_id = v_sede)),
    'ventas_mes', (SELECT COALESCE(SUM(total),0) FROM ventas WHERE (fecha AT TIME ZONE 'America/Bogota')::date >= v_mes_inicio AND anulada = false AND (v_rol = 'Admin' OR sede_id = v_sede)),
    'ticket_promedio_mes', (SELECT COALESCE(AVG(total),0)::INTEGER FROM ventas WHERE (fecha AT TIME ZONE 'America/Bogota')::date >= v_mes_inicio AND anulada = false AND (v_rol = 'Admin' OR sede_id = v_sede)),
    'compras_mes', (SELECT COALESCE(SUM(total),0) FROM compras WHERE (fecha AT TIME ZONE 'America/Bogota')::date >= v_mes_inicio AND estado <> 'cancelada' AND (v_rol = 'Admin' OR sede_destino_id = v_sede)),
    'ingresos_servicios_mes', (SELECT COALESCE(SUM(a.monto),0) FROM abonos a JOIN ordenes_servicio o ON o.id = a.orden_id WHERE (a.fecha AT TIME ZONE 'America/Bogota')::date >= v_mes_inicio AND (v_rol = 'Admin' OR o.sede_id = v_sede)),
    'total_productos_activos', (SELECT COUNT(*) FROM productos WHERE activo = true),
    'valor_inventario', (SELECT COALESCE(SUM(i.cantidad * p.costo_promedio),0)::BIGINT FROM inventario i JOIN productos p ON p.id = i.producto_id WHERE (v_rol = 'Admin' OR i.sede_id = v_sede)),
    'stock_bajo_count', (SELECT COUNT(*) FROM inventario WHERE estado_stock = 'Bajo' AND (v_rol = 'Admin' OR sede_id = v_sede)),
    'stock_agotado_count', (SELECT COUNT(*) FROM inventario WHERE estado_stock = 'Agotado' AND (v_rol = 'Admin' OR sede_id = v_sede)),
    'alertas_count', (SELECT COUNT(*) FROM inventario WHERE estado_stock IN ('Bajo','Agotado') AND (v_rol = 'Admin' OR sede_id = v_sede)),
    'ordenes_abiertas', (SELECT COUNT(*) FROM ordenes_servicio WHERE estado IN ('abierta','en_proceso','esperando_repuesto') AND (v_rol = 'Admin' OR sede_id = v_sede)),
    'cotizaciones_vigentes', (SELECT COUNT(*) FROM cotizaciones WHERE estado IN ('borrador','enviada','aprobada') AND (v_rol = 'Admin' OR sede_id = v_sede)),
    'traspasos_en_transito', (SELECT COUNT(*) FROM traspasos WHERE estado IN ('en_transito','picking','verificado') AND (v_rol = 'Admin' OR sede_origen_id = v_sede OR sede_destino_id = v_sede)),
    'herramientas_prestadas', (SELECT COUNT(*) FROM herramientas_prestamo WHERE estado = 'prestada' AND (v_rol = 'Admin' OR sede_id = v_sede)),
    'ensambles_pendientes', (SELECT COUNT(*) FROM ensambles WHERE completado = false AND (v_rol = 'Admin' OR sede_id = v_sede)),
    'alertas', (SELECT COALESCE(jsonb_agg(a ORDER BY a->>'severity' DESC), '[]'::jsonb) FROM (SELECT jsonb_build_object('inventario_id', i.id, 'message', p.nombre || ' (' || i.cantidad || ' uds) — ' || s.nombre, 'severity', CASE i.estado_stock WHEN 'Agotado' THEN 'danger' ELSE 'warning' END) AS a FROM inventario i JOIN productos p ON p.id = i.producto_id JOIN sedes s ON s.id = i.sede_id WHERE i.estado_stock IN ('Bajo','Agotado') AND (v_rol = 'Admin' OR i.sede_id = v_sede) ORDER BY i.estado_stock DESC, i.cantidad ASC LIMIT 10) sub),
    'actividad_reciente', (SELECT COALESCE(jsonb_agg(act ORDER BY act->>'created_at' DESC), '[]'::jsonb) FROM (
      SELECT jsonb_build_object('id', m.id, 'action', CASE m.tipo
        WHEN 'venta' THEN 'Venta — ' || COALESCE(p.nombre, '?')
        WHEN 'compra' THEN 'Compra — ' || COALESCE(p.nombre, '?')
        WHEN 'traspaso_salida' THEN 'Traspaso salida — ' || COALESCE(p.nombre, '?')
        WHEN 'traspaso_entrada' THEN 'Traspaso entrada — ' || COALESCE(p.nombre, '?')
        WHEN 'devolucion' THEN 'Devolución — ' || COALESCE(p.nombre, '?')
        WHEN 'ajuste' THEN 'Ajuste — ' || COALESCE(p.nombre, '?')
        WHEN 'orden_consumo' THEN 'Orden — ' || COALESCE(p.nombre, '?')
        WHEN 'ensamble_consumo' THEN 'Ensamble (consumo) — ' || COALESCE(p.nombre, '?')
        WHEN 'ensamble_produccion' THEN 'Ensamble (producción) — ' || COALESCE(p.nombre, '?')
        WHEN 'conteo_ajuste' THEN 'Conteo — ' || COALESCE(p.nombre, '?')
        ELSE m.tipo || ' — ' || COALESCE(p.nombre, '?') END,
        'user', COALESCE(u.nombre, '(sistema)'),
        'type', m.tipo, 'cantidad', m.cantidad, 'created_at', m.created_at
      ) AS act
      FROM movimientos m
      LEFT JOIN productos p ON p.id = m.producto_id
      LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE (v_rol = 'Admin' OR m.sede_id = v_sede)
      ORDER BY m.created_at DESC LIMIT 15
    ) sub),
    'tendencia_7d', (SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'fecha')::date), '[]'::jsonb) FROM (SELECT jsonb_build_object('fecha', d::date, 'total', COALESCE(SUM(v.total), 0)) AS t FROM generate_series(v_hoy - 6, v_hoy, '1 day'::interval) d LEFT JOIN ventas v ON (v.fecha AT TIME ZONE 'America/Bogota')::date = d::date AND v.anulada = false AND (v_rol = 'Admin' OR v.sede_id = v_sede) GROUP BY d) sub),
    'ventas_por_sede', (SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'total')::numeric DESC), '[]'::jsonb) FROM (SELECT jsonb_build_object('sede', s.nombre, 'total', COALESCE(SUM(v.total), 0)) AS t FROM sedes s LEFT JOIN ventas v ON v.sede_id = s.id AND (v.fecha AT TIME ZONE 'America/Bogota')::date >= v_mes_inicio AND v.anulada = false WHERE s.activa = true AND (v_rol = 'Admin' OR s.id = v_sede) GROUP BY s.id, s.nombre) sub),
    'top5_productos_mes', (SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'unidades')::int DESC), '[]'::jsonb) FROM (SELECT jsonb_build_object('producto_id', p.id, 'nombre', p.nombre, 'referencia', p.referencia, 'unidades', SUM(dv.cantidad), 'total', SUM(dv.subtotal)) AS t FROM detalle_venta dv JOIN ventas v ON v.id = dv.venta_id JOIN productos p ON p.id = dv.producto_id WHERE (v.fecha AT TIME ZONE 'America/Bogota')::date >= v_mes_inicio AND v.anulada = false AND (v_rol = 'Admin' OR v.sede_id = v_sede) GROUP BY p.id, p.nombre, p.referencia ORDER BY SUM(dv.cantidad) DESC LIMIT 5) sub)
  ) INTO v_result;
  RETURN v_result;
END; $function$;
