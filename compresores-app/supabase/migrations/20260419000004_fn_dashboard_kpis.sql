-- ============================================================
-- fn_dashboard_kpis
-- Retorna KPIs en tiempo real para el Dashboard.
-- Accesible por todos los roles autenticados.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_dashboard_kpis()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid       UUID;
  v_rol       TEXT;
  v_sede      TEXT;
  v_result    JSONB;
BEGIN
  v_uid  := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT rol::TEXT, sede_id INTO v_rol, v_sede FROM usuarios WHERE id = v_uid;

  SELECT jsonb_build_object(

    -- ── KPIs numéricos ───────────────────────────────────────
    'ventas_hoy', (
      SELECT COALESCE(SUM(total), 0)
      FROM ventas
      WHERE fecha::date = CURRENT_DATE
        AND anulada = false
        AND (v_rol = 'Admin' OR sede_id = v_sede)
    ),

    'ventas_ayer', (
      SELECT COALESCE(SUM(total), 0)
      FROM ventas
      WHERE fecha::date = CURRENT_DATE - 1
        AND anulada = false
        AND (v_rol = 'Admin' OR sede_id = v_sede)
    ),

    'total_productos_activos', (
      SELECT COUNT(*) FROM productos WHERE activo = true
    ),

    'alertas_count', (
      SELECT COUNT(*)
      FROM inventario i
      WHERE i.estado_stock IN ('Bajo', 'Agotado')
        AND (v_rol = 'Admin' OR i.sede_id = v_sede)
    ),

    -- ── Lista de alertas de stock (máx. 10) ──────────────────
    'alertas', (
      SELECT COALESCE(jsonb_agg(a ORDER BY a->>'severity' DESC, a->>'message'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'message', p.nombre || ' (' || i.cantidad || ' uds) — ' || s.nombre,
          'severity', CASE i.estado_stock WHEN 'Agotado' THEN 'danger' ELSE 'warning' END
        ) AS a
        FROM inventario i
        JOIN productos p ON p.id = i.producto_id
        JOIN sedes     s ON s.id = i.sede_id
        WHERE i.estado_stock IN ('Bajo', 'Agotado')
          AND (v_rol = 'Admin' OR i.sede_id = v_sede)
        ORDER BY i.estado_stock DESC, i.cantidad ASC
        LIMIT 10
      ) sub
    ),

    -- ── Actividad reciente (últimos 10 movimientos) ───────────
    'actividad_reciente', (
      SELECT COALESCE(jsonb_agg(act ORDER BY act->>'created_at' DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'action',     CASE m.tipo
            WHEN 'venta'               THEN 'Venta — ' || p.nombre
            WHEN 'compra'              THEN 'Compra — ' || p.nombre
            WHEN 'traspaso_salida'     THEN 'Traspaso salida — ' || p.nombre
            WHEN 'traspaso_entrada'    THEN 'Traspaso entrada — ' || p.nombre
            WHEN 'devolucion'          THEN 'Devolución — ' || p.nombre
            WHEN 'ajuste'              THEN 'Ajuste — ' || p.nombre
            ELSE m.tipo || ' — ' || p.nombre
          END,
          'user',       u.nombre,
          'type',       m.tipo,
          'created_at', m.created_at
        ) AS act
        FROM movimientos m
        JOIN productos p ON p.id = m.producto_id
        JOIN usuarios  u ON u.id = m.usuario_id
        WHERE (v_rol = 'Admin' OR m.sede_id = v_sede)
        ORDER BY m.created_at DESC
        LIMIT 10
      ) sub
    )

  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_dashboard_kpis() TO authenticated;
