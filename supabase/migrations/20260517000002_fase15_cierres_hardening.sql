-- Fase 15 — Hardening de Cierres (correcciones de revisión de código)
--
-- 1. Constraint de exclusión: garantiza a nivel de motor que dos cierres
--    nunca cubran rangos solapados (refuerza el chequeo de fn_generar_cierre).
-- 2. REVOKE explícito de _fn_cierre_totales para el rol authenticated
--    (defensa en profundidad: la función es interna y no valida rol).
-- 3. fn_dashboard_kpis: consistencia de zona horaria — los servicios usan
--    la misma convención (mes UTC) que ventas/compras del dashboard, y se
--    elimina la clave ingresos_servicios_hoy que no consume el frontend.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Constraint de exclusión anti-solapamiento de rangos
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE cierres
  ADD CONSTRAINT cierres_no_solapamiento
  EXCLUDE USING gist (daterange(fecha_desde, fecha_hasta, '[]') WITH &&);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Cerrar acceso directo a la función interna _fn_cierre_totales
-- ─────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION _fn_cierre_totales(DATE, DATE) FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3. fn_dashboard_kpis — consistencia de TZ en servicios + quitar key sin uso
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_dashboard_kpis()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid UUID := auth.uid(); v_rol TEXT; v_sede TEXT; v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'no_session'); END IF;
  SELECT rol::TEXT, sede_id INTO v_rol, v_sede FROM usuarios WHERE id = v_uid;
  SELECT jsonb_build_object(
    'ventas_hoy', (SELECT COALESCE(SUM(total),0) FROM ventas WHERE fecha::date = CURRENT_DATE AND anulada = false AND (v_rol = 'Admin' OR sede_id = v_sede)),
    'ventas_ayer', (SELECT COALESCE(SUM(total),0) FROM ventas WHERE fecha::date = CURRENT_DATE - 1 AND anulada = false AND (v_rol = 'Admin' OR sede_id = v_sede)),
    'ventas_semana', (SELECT COALESCE(SUM(total),0) FROM ventas WHERE fecha >= date_trunc('week', CURRENT_DATE) AND anulada = false AND (v_rol = 'Admin' OR sede_id = v_sede)),
    'ventas_mes', (SELECT COALESCE(SUM(total),0) FROM ventas WHERE fecha >= date_trunc('month', CURRENT_DATE) AND anulada = false AND (v_rol = 'Admin' OR sede_id = v_sede)),
    'ticket_promedio_mes', (SELECT COALESCE(AVG(total),0)::INTEGER FROM ventas WHERE fecha >= date_trunc('month', CURRENT_DATE) AND anulada = false AND (v_rol = 'Admin' OR sede_id = v_sede)),
    'compras_mes', (SELECT COALESCE(SUM(total),0) FROM compras WHERE fecha >= date_trunc('month', CURRENT_DATE) AND (v_rol = 'Admin' OR sede_destino_id = v_sede)),
    -- Servicios del mes: misma convención (mes UTC) que ventas_mes/compras_mes
    -- para que el dashboard sea internamente consistente. Los cierres oficiales
    -- (módulo Cierres) sí usan el día hábil America/Bogota.
    'ingresos_servicios_mes', (SELECT COALESCE(SUM(a.monto),0) FROM abonos a JOIN ordenes_servicio o ON o.id = a.orden_id WHERE a.fecha >= date_trunc('month', CURRENT_DATE) AND (v_rol = 'Admin' OR o.sede_id = v_sede)),
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
    'tendencia_7d', (SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'fecha')::date), '[]'::jsonb) FROM (SELECT jsonb_build_object('fecha', d::date, 'total', COALESCE(SUM(v.total), 0)) AS t FROM generate_series(CURRENT_DATE - 6, CURRENT_DATE, '1 day'::interval) d LEFT JOIN ventas v ON v.fecha >= d AND v.fecha < d + INTERVAL '1 day' AND v.anulada = false AND (v_rol = 'Admin' OR v.sede_id = v_sede) GROUP BY d) sub),
    'ventas_por_sede', (SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'total')::numeric DESC), '[]'::jsonb) FROM (SELECT jsonb_build_object('sede', s.nombre, 'total', COALESCE(SUM(v.total), 0)) AS t FROM sedes s LEFT JOIN ventas v ON v.sede_id = s.id AND v.fecha >= date_trunc('month', CURRENT_DATE) AND v.anulada = false WHERE s.activa = true AND (v_rol = 'Admin' OR s.id = v_sede) GROUP BY s.id, s.nombre) sub),
    'top5_productos_mes', (SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'unidades')::int DESC), '[]'::jsonb) FROM (SELECT jsonb_build_object('producto_id', p.id, 'nombre', p.nombre, 'referencia', p.referencia, 'unidades', SUM(dv.cantidad), 'total', SUM(dv.subtotal)) AS t FROM detalle_venta dv JOIN ventas v ON v.id = dv.venta_id JOIN productos p ON p.id = dv.producto_id WHERE v.fecha >= date_trunc('month', CURRENT_DATE) AND v.anulada = false AND (v_rol = 'Admin' OR v.sede_id = v_sede) GROUP BY p.id, p.nombre, p.referencia ORDER BY SUM(dv.cantidad) DESC LIMIT 5) sub)
  ) INTO v_result;
  RETURN v_result;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.fn_dashboard_kpis() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_dashboard_kpis() TO authenticated;
