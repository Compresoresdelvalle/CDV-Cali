-- ============================================================================
-- Fase 8 — Dashboard Admin + KPIs + funciones de gestión
-- ============================================================================

-- ── 1) Extender fn_dashboard_kpis con KPIs adicionales y datos de charts ──

CREATE OR REPLACE FUNCTION fn_dashboard_kpis()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_rol  TEXT;
  v_sede TEXT;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'no_session');
  END IF;
  SELECT rol::TEXT, sede_id INTO v_rol, v_sede FROM usuarios WHERE id = v_uid;

  SELECT jsonb_build_object(
    -- Ventas
    'ventas_hoy', (
      SELECT COALESCE(SUM(total),0) FROM ventas
      WHERE fecha::date = CURRENT_DATE AND anulada = false
        AND (v_rol = 'Admin' OR sede_id = v_sede)
    ),
    'ventas_ayer', (
      SELECT COALESCE(SUM(total),0) FROM ventas
      WHERE fecha::date = CURRENT_DATE - 1 AND anulada = false
        AND (v_rol = 'Admin' OR sede_id = v_sede)
    ),
    'ventas_semana', (
      SELECT COALESCE(SUM(total),0) FROM ventas
      WHERE fecha >= date_trunc('week', CURRENT_DATE) AND anulada = false
        AND (v_rol = 'Admin' OR sede_id = v_sede)
    ),
    'ventas_mes', (
      SELECT COALESCE(SUM(total),0) FROM ventas
      WHERE fecha >= date_trunc('month', CURRENT_DATE) AND anulada = false
        AND (v_rol = 'Admin' OR sede_id = v_sede)
    ),
    'ticket_promedio_mes', (
      SELECT COALESCE(AVG(total),0)::INTEGER FROM ventas
      WHERE fecha >= date_trunc('month', CURRENT_DATE) AND anulada = false
        AND (v_rol = 'Admin' OR sede_id = v_sede)
    ),
    -- Compras
    'compras_mes', (
      SELECT COALESCE(SUM(total),0) FROM compras
      WHERE fecha >= date_trunc('month', CURRENT_DATE)
        AND (v_rol = 'Admin' OR sede_destino_id = v_sede)
    ),
    -- Inventario
    'total_productos_activos', (
      SELECT COUNT(*) FROM productos WHERE activo = true
    ),
    'valor_inventario', (
      SELECT COALESCE(SUM(i.cantidad * p.costo_promedio),0)::BIGINT
      FROM inventario i JOIN productos p ON p.id = i.producto_id
      WHERE (v_rol = 'Admin' OR i.sede_id = v_sede)
    ),
    'stock_bajo_count', (
      SELECT COUNT(*) FROM inventario
      WHERE estado_stock = 'Bajo' AND (v_rol = 'Admin' OR sede_id = v_sede)
    ),
    'stock_agotado_count', (
      SELECT COUNT(*) FROM inventario
      WHERE estado_stock = 'Agotado' AND (v_rol = 'Admin' OR sede_id = v_sede)
    ),
    'alertas_count', (
      SELECT COUNT(*) FROM inventario
      WHERE estado_stock IN ('Bajo','Agotado')
        AND (v_rol = 'Admin' OR sede_id = v_sede)
    ),
    -- Operaciones abiertas
    'ordenes_abiertas', (
      SELECT COUNT(*) FROM ordenes_servicio
      WHERE estado IN ('abierta','en_proceso','esperando_repuesto','completada')
        AND (v_rol = 'Admin' OR sede_id = v_sede)
    ),
    'cotizaciones_vigentes', (
      SELECT COUNT(*) FROM cotizaciones
      WHERE estado = 'vigente'
        AND (v_rol = 'Admin' OR sede_id = v_sede)
    ),
    'traspasos_en_transito', (
      SELECT COUNT(*) FROM traspasos
      WHERE estado IN ('en_transito','en_picking','verificado')
        AND (v_rol = 'Admin' OR sede_origen_id = v_sede OR sede_destino_id = v_sede)
    ),
    'herramientas_prestadas', (
      SELECT COUNT(*) FROM herramientas_prestamo
      WHERE estado = 'prestada'
        AND (v_rol = 'Admin' OR sede_id = v_sede)
    ),
    'ensambles_pendientes', (
      SELECT COUNT(*) FROM ensambles
      WHERE completado = false
        AND (v_rol = 'Admin' OR sede_id = v_sede)
    ),

    -- Lista de alertas (stock)
    'alertas', (
      SELECT COALESCE(jsonb_agg(a ORDER BY a->>'severity' DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'message', p.nombre || ' (' || i.cantidad || ' uds) — ' || s.nombre,
          'severity', CASE i.estado_stock WHEN 'Agotado' THEN 'danger' ELSE 'warning' END
        ) AS a
        FROM inventario i
        JOIN productos p ON p.id = i.producto_id
        JOIN sedes s ON s.id = i.sede_id
        WHERE i.estado_stock IN ('Bajo','Agotado')
          AND (v_rol = 'Admin' OR i.sede_id = v_sede)
        ORDER BY i.estado_stock DESC, i.cantidad ASC
        LIMIT 10
      ) sub
    ),

    -- Actividad reciente
    'actividad_reciente', (
      SELECT COALESCE(jsonb_agg(act ORDER BY act->>'created_at' DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'action',
          CASE m.tipo
            WHEN 'venta' THEN 'Venta — ' || p.nombre
            WHEN 'compra' THEN 'Compra — ' || p.nombre
            WHEN 'traspaso_salida' THEN 'Traspaso salida — ' || p.nombre
            WHEN 'traspaso_entrada' THEN 'Traspaso entrada — ' || p.nombre
            WHEN 'devolucion' THEN 'Devolución — ' || p.nombre
            WHEN 'ajuste' THEN 'Ajuste — ' || p.nombre
            WHEN 'orden_consumo' THEN 'Orden — ' || p.nombre
            WHEN 'ensamble_consumo' THEN 'Ensamble (consumo) — ' || p.nombre
            WHEN 'ensamble_produccion' THEN 'Ensamble (producción) — ' || p.nombre
            ELSE m.tipo || ' — ' || p.nombre
          END,
          'user', u.nombre,
          'type', m.tipo,
          'cantidad', m.cantidad,
          'created_at', m.created_at
        ) AS act
        FROM movimientos m
        JOIN productos p ON p.id = m.producto_id
        JOIN usuarios u ON u.id = m.usuario_id
        WHERE (v_rol = 'Admin' OR m.sede_id = v_sede)
        ORDER BY m.created_at DESC
        LIMIT 15
      ) sub
    ),

    -- Tendencia de ventas últimos 7 días (chart line)
    'tendencia_7d', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t->>'fecha'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'fecha', d::date,
          'total', COALESCE(SUM(v.total), 0)
        ) AS t
        FROM generate_series(CURRENT_DATE - 6, CURRENT_DATE, '1 day'::interval) d
        LEFT JOIN ventas v ON v.fecha::date = d::date AND v.anulada = false
          AND (v_rol = 'Admin' OR v.sede_id = v_sede)
        GROUP BY d
      ) sub
    ),

    -- Ventas por sede mes actual (chart bar) — Admin only ve todas
    'ventas_por_sede', (
      SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'total')::numeric DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'sede', s.nombre,
          'total', COALESCE(SUM(v.total), 0)
        ) AS t
        FROM sedes s
        LEFT JOIN ventas v ON v.sede_id = s.id
          AND v.fecha >= date_trunc('month', CURRENT_DATE)
          AND v.anulada = false
        WHERE s.activa = true AND (v_rol = 'Admin' OR s.id = v_sede)
        GROUP BY s.id, s.nombre
      ) sub
    ),

    -- Top 5 productos del mes (cantidad vendida)
    'top5_productos_mes', (
      SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'unidades')::int DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'nombre', p.nombre,
          'referencia', p.referencia,
          'unidades', SUM(dv.cantidad),
          'total', SUM(dv.subtotal)
        ) AS t
        FROM detalle_venta dv
        JOIN ventas v ON v.id = dv.venta_id
        JOIN productos p ON p.id = dv.producto_id
        WHERE v.fecha >= date_trunc('month', CURRENT_DATE) AND v.anulada = false
          AND (v_rol = 'Admin' OR v.sede_id = v_sede)
        GROUP BY p.id, p.nombre, p.referencia
        ORDER BY SUM(dv.cantidad) DESC
        LIMIT 5
      ) sub
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ── 2) Vista: sugerencias de reorden ───────────────────────────────────────

CREATE OR REPLACE VIEW v_sugerencias_reorden AS
SELECT
  p.id AS producto_id,
  p.referencia,
  p.nombre,
  p.categoria,
  p.clasificacion,
  i.sede_id,
  s.nombre AS sede_nombre,
  i.cantidad AS stock_actual,
  p.stock_minimo,
  p.stock_maximo,
  GREATEST(p.stock_maximo - i.cantidad, 0) AS cantidad_sugerida,
  p.costo_promedio,
  GREATEST(p.stock_maximo - i.cantidad, 0) * p.costo_promedio AS costo_estimado_compra,
  i.estado_stock
FROM productos p
JOIN inventario i ON i.producto_id = p.id
JOIN sedes s ON s.id = i.sede_id
WHERE p.activo = true
  AND s.activa = true
  AND i.cantidad <= p.stock_minimo
ORDER BY i.cantidad ASC;

-- RLS implícita: la vista hereda RLS de las tablas base (productos, inventario)

-- ── 3) Top productos por rango de fechas ───────────────────────────────────

CREATE OR REPLACE FUNCTION fn_top_productos(p_dias INTEGER DEFAULT 30, p_limit INTEGER DEFAULT 10)
RETURNS TABLE(
  producto_id UUID,
  referencia TEXT,
  nombre TEXT,
  unidades_vendidas BIGINT,
  total_vendido NUMERIC,
  num_ventas BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_rol TEXT; v_sede TEXT;
BEGIN
  SELECT rol::TEXT, sede_id INTO v_rol, v_sede FROM usuarios WHERE id = auth.uid();

  RETURN QUERY
  SELECT
    p.id,
    p.referencia,
    p.nombre,
    SUM(dv.cantidad)::BIGINT,
    SUM(dv.subtotal)::NUMERIC,
    COUNT(DISTINCT v.id)::BIGINT
  FROM detalle_venta dv
  JOIN ventas v ON v.id = dv.venta_id
  JOIN productos p ON p.id = dv.producto_id
  WHERE v.fecha >= CURRENT_DATE - p_dias
    AND v.anulada = false
    AND (v_rol = 'Admin' OR v.sede_id = v_sede)
  GROUP BY p.id, p.referencia, p.nombre
  ORDER BY SUM(dv.cantidad) DESC
  LIMIT p_limit;
END;
$$;

-- ── 4) Aplicar ajuste de conteo cíclico al inventario ──────────────────────

CREATE OR REPLACE FUNCTION fn_aplicar_ajuste_conteo(p_conteo_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conteo conteos%ROWTYPE;
  v_rol TEXT;
  v_uid UUID := auth.uid();
  v_stock_actual INTEGER;
BEGIN
  SELECT rol::TEXT INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol <> 'Admin' THEN
    RAISE EXCEPTION 'Solo Admin puede aplicar ajustes de conteo';
  END IF;

  SELECT * INTO v_conteo FROM conteos WHERE id = p_conteo_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conteo no encontrado';
  END IF;
  IF v_conteo.ajuste_aplicado THEN
    RAISE EXCEPTION 'Este conteo ya fue ajustado';
  END IF;

  -- Lock inventario
  SELECT cantidad INTO v_stock_actual
    FROM inventario
   WHERE producto_id = v_conteo.producto_id AND sede_id = v_conteo.sede_id
   FOR UPDATE;

  -- Aplicar el ajuste: la diferencia define cuánto sumar/restar
  UPDATE inventario
     SET cantidad = v_conteo.stock_fisico,
         ultimo_movimiento = now(),
         updated_at = now()
   WHERE producto_id = v_conteo.producto_id AND sede_id = v_conteo.sede_id;

  -- Registrar movimiento de ajuste
  INSERT INTO movimientos (
    tipo, producto_id, sede_id, cantidad,
    stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id, observaciones
  ) VALUES (
    'conteo_ajuste', v_conteo.producto_id, v_conteo.sede_id,
    v_conteo.diferencia,
    v_stock_actual, v_conteo.stock_fisico,
    v_conteo.id, 'conteo', v_uid,
    'Ajuste de conteo cíclico'
  );

  -- Marcar conteo como aplicado
  UPDATE conteos
     SET ajuste_aplicado = true,
         aprobado_por = v_uid
   WHERE id = p_conteo_id;

  PERFORM fn_actualizar_estado_stock(v_conteo.producto_id, v_conteo.sede_id);

  RETURN jsonb_build_object(
    'ok', true,
    'diferencia', v_conteo.diferencia,
    'stock_anterior', v_stock_actual,
    'stock_posterior', v_conteo.stock_fisico
  );
END;
$$;

-- ── 5) RLS conteos ─────────────────────────────────────────────────────────

ALTER TABLE conteos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ct_select" ON conteos;
DROP POLICY IF EXISTS "ct_insert" ON conteos;
DROP POLICY IF EXISTS "ct_update" ON conteos;

CREATE POLICY "ct_select" ON conteos
  FOR SELECT TO authenticated
  USING (
    (SELECT get_my_rol()) = 'Admin'
    OR sede_id = (SELECT get_my_sede_id())
  );

CREATE POLICY "ct_insert" ON conteos
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT get_my_rol()) IN ('Admin','Bodeguero')
    AND ((SELECT get_my_rol()) = 'Admin' OR sede_id = (SELECT get_my_sede_id()))
  );

-- UPDATE solo via fn_aplicar_ajuste_conteo (que es SECURITY DEFINER)
CREATE POLICY "ct_update" ON conteos
  FOR UPDATE TO authenticated
  USING ((SELECT get_my_rol()) = 'Admin');

-- ── 6) Índices ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_conteos_sede_fecha ON conteos(sede_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_conteos_aplicado ON conteos(ajuste_aplicado) WHERE ajuste_aplicado = false;
CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha DESC) WHERE anulada = false;
CREATE INDEX IF NOT EXISTS idx_movimientos_sede_fecha ON movimientos(sede_id, fecha DESC);
