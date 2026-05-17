-- Fase 15 — Dashboard expandido + Cierres
-- Tabla `cierres` (append-only / inmutable), RPCs de previsualización y
-- generación de cierres consolidados, y extensión de fn_dashboard_kpis con
-- los ingresos por servicios.
--
-- Modelo de ingresos: base CAJA ("lo que entró").
--   - Productos = SUM(ventas.total) WHERE anulada = false
--   - Servicios = SUM(abonos.monto)  (abonos es la única fuente del cash de OT)
--   - Egresos   = SUM(compras.total)
--   - Margen    = (productos + servicios) - egresos
-- Bucketing por día hábil America/Bogota: (fecha AT TIME ZONE 'America/Bogota')::date.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Tabla cierres
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cierres (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero             SERIAL,
  tipo               TEXT NOT NULL CHECK (tipo IN ('diario', 'periodo')),
  fecha_desde        DATE NOT NULL,
  fecha_hasta        DATE NOT NULL,
  ingresos_productos NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (ingresos_productos >= 0),
  ingresos_servicios NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (ingresos_servicios >= 0),
  ingresos_total     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (ingresos_total >= 0),
  egresos            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (egresos >= 0),
  margen             NUMERIC(14,2) NOT NULL DEFAULT 0,        -- puede ser negativo
  count_ventas       INTEGER NOT NULL DEFAULT 0,
  count_abonos       INTEGER NOT NULL DEFAULT 0,
  count_compras      INTEGER NOT NULL DEFAULT 0,
  detalle            JSONB NOT NULL DEFAULT '{}',             -- snapshot por sede / método
  observaciones      TEXT,
  cerrado_por        UUID REFERENCES usuarios(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cierres_rango_valido CHECK (fecha_hasta >= fecha_desde)
);

CREATE INDEX IF NOT EXISTS ix_cierres_rango   ON cierres(fecha_desde, fecha_hasta);
CREATE INDEX IF NOT EXISTS ix_cierres_created ON cierres(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Inmutabilidad — append-only (rechaza UPDATE y DELETE)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_no_modify_cierre()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Cierres son inmutables — % no permitido', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_update_cierres ON cierres;
CREATE TRIGGER trg_prevent_update_cierres
  BEFORE UPDATE ON cierres
  FOR EACH ROW EXECUTE FUNCTION trg_no_modify_cierre();

DROP TRIGGER IF EXISTS trg_prevent_delete_cierres ON cierres;
CREATE TRIGGER trg_prevent_delete_cierres
  BEFORE DELETE ON cierres
  FOR EACH ROW EXECUTE FUNCTION trg_no_modify_cierre();

-- ─────────────────────────────────────────────────────────────────────
-- 3. RLS — solo Admin (módulo admin-only)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE cierres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cierres_admin" ON cierres;
CREATE POLICY "cierres_admin" ON cierres FOR ALL TO authenticated
  USING ((SELECT get_my_rol()) = 'Admin')
  WITH CHECK ((SELECT get_my_rol()) = 'Admin');

REVOKE UPDATE, DELETE ON cierres FROM authenticated;
GRANT SELECT, INSERT ON cierres TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE cierres_numero_seq TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Helper interno — calcula totales + desglose de un rango de fechas
--    No expuesto a clientes; lo invocan los RPCs SECURITY DEFINER.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _fn_cierre_totales(p_desde DATE, p_hasta DATE)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  -- Productos: ventas no anuladas en el rango.
  SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO v_productos, v_cv
  FROM ventas
  WHERE anulada = false
    AND (fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta;

  -- Servicios: abonos recibidos a OT en el rango.
  SELECT COALESCE(SUM(monto), 0), COUNT(*)
    INTO v_servicios, v_ca
  FROM abonos
  WHERE (fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta;

  -- Egresos: compras en el rango.
  SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO v_egresos, v_cc
  FROM compras
  WHERE (fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta;

  -- Desglose por sede (productos / servicios / egresos).
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
                  AND (c.fecha AT TIME ZONE 'America/Bogota')::date BETWEEN p_desde AND p_hasta), 0) AS egresos
    FROM sedes se
    WHERE se.activa = true
  ) d;

  -- Desglose por método de pago (solo ingresos: productos + servicios).
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
$$;

REVOKE EXECUTE ON FUNCTION _fn_cierre_totales(DATE, DATE) FROM anon, public;

-- ─────────────────────────────────────────────────────────────────────
-- 5. RPC fn_preview_cierre — calcula totales al vuelo (sin guardar).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_preview_cierre(p_desde DATE, p_hasta DATE)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_rol     TEXT;
  v_totales JSONB;
  v_solap   INTEGER[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Solo el Admin puede consultar cierres';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL THEN
    RAISE EXCEPTION 'Debe indicar fecha desde y hasta';
  END IF;
  IF p_hasta < p_desde THEN
    RAISE EXCEPTION 'La fecha hasta no puede ser anterior a la fecha desde';
  END IF;

  v_totales := _fn_cierre_totales(p_desde, p_hasta);

  SELECT COALESCE(array_agg(numero ORDER BY numero), ARRAY[]::INTEGER[])
    INTO v_solap
  FROM cierres
  WHERE fecha_desde <= p_hasta AND fecha_hasta >= p_desde;

  RETURN v_totales || jsonb_build_object(
    'fecha_desde',  p_desde,
    'fecha_hasta',  p_hasta,
    'ya_cubierto',  (COALESCE(array_length(v_solap, 1), 0) > 0),
    'solapamiento', to_jsonb(v_solap)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_preview_cierre(DATE, DATE) FROM anon, public;
GRANT EXECUTE ON FUNCTION fn_preview_cierre(DATE, DATE) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 6. RPC fn_generar_cierre — valida no-solapamiento e inserta el cierre.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_generar_cierre(
  p_desde         DATE,
  p_hasta         DATE,
  p_tipo          TEXT,
  p_observaciones TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_rol     TEXT;
  v_totales JSONB;
  v_row     cierres;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Solo el Admin puede generar cierres';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL THEN
    RAISE EXCEPTION 'Debe indicar fecha desde y hasta';
  END IF;
  IF p_hasta < p_desde THEN
    RAISE EXCEPTION 'La fecha hasta no puede ser anterior a la fecha desde';
  END IF;
  IF p_tipo NOT IN ('diario', 'periodo') THEN
    RAISE EXCEPTION 'Tipo de cierre inválido: %', p_tipo;
  END IF;
  IF p_tipo = 'diario' AND p_desde <> p_hasta THEN
    RAISE EXCEPTION 'Un cierre diario debe cubrir un solo día';
  END IF;

  -- Serializa la verificación de solapamiento contra cierres concurrentes.
  PERFORM pg_advisory_xact_lock(hashtext('cierres'));

  IF EXISTS (SELECT 1 FROM cierres
             WHERE fecha_desde <= p_hasta AND fecha_hasta >= p_desde) THEN
    RAISE EXCEPTION 'El rango % a % solapa un cierre ya existente', p_desde, p_hasta;
  END IF;

  -- Recalcula en el servidor (nunca confía en el cliente).
  v_totales := _fn_cierre_totales(p_desde, p_hasta);

  INSERT INTO cierres (
    tipo, fecha_desde, fecha_hasta,
    ingresos_productos, ingresos_servicios, ingresos_total, egresos, margen,
    count_ventas, count_abonos, count_compras,
    detalle, observaciones, cerrado_por
  ) VALUES (
    p_tipo, p_desde, p_hasta,
    (v_totales->>'ingresos_productos')::NUMERIC,
    (v_totales->>'ingresos_servicios')::NUMERIC,
    (v_totales->>'ingresos_total')::NUMERIC,
    (v_totales->>'egresos')::NUMERIC,
    (v_totales->>'margen')::NUMERIC,
    (v_totales->>'count_ventas')::INTEGER,
    (v_totales->>'count_abonos')::INTEGER,
    (v_totales->>'count_compras')::INTEGER,
    v_totales->'detalle',
    NULLIF(TRIM(COALESCE(p_observaciones, '')), ''),
    v_uid
  )
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_generar_cierre(DATE, DATE, TEXT, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION fn_generar_cierre(DATE, DATE, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 7. fn_dashboard_kpis — agrega ingresos_servicios_hoy / _mes.
--    Aditivo: las claves de productos (ventas_*) y egresos (compras_mes) ya
--    existen. NOTA TZ: las claves de ventas existentes se dejan sobre
--    fecha::date (UTC) para no mover números ya desplegados; las claves
--    nuevas de servicios usan el día hábil America/Bogota.
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
    'ingresos_servicios_hoy', (SELECT COALESCE(SUM(a.monto),0) FROM abonos a JOIN ordenes_servicio o ON o.id = a.orden_id WHERE (a.fecha AT TIME ZONE 'America/Bogota')::date = (now() AT TIME ZONE 'America/Bogota')::date AND (v_rol = 'Admin' OR o.sede_id = v_sede)),
    'ingresos_servicios_mes', (SELECT COALESCE(SUM(a.monto),0) FROM abonos a JOIN ordenes_servicio o ON o.id = a.orden_id WHERE (a.fecha AT TIME ZONE 'America/Bogota')::date >= date_trunc('month', (now() AT TIME ZONE 'America/Bogota')::date) AND (v_rol = 'Admin' OR o.sede_id = v_sede)),
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

GRANT EXECUTE ON FUNCTION public.fn_dashboard_kpis() TO authenticated;
