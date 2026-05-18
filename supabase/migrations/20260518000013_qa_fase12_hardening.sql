-- QA Campaña — Fase 12 (Ajustes Inventario/Compras/Traspasos)
-- Cierra 3 hallazgos de la revisión:
--   * F12-01 (P1, RBAC): la policy `compras_update` solo exigía Admin OR
--     misma sede → cualquier Vendedor/Técnico de la sede podía hacer
--     UPDATE directo `recibida=true` (la app marca recibida con UPDATE
--     directo, no RPC) y disparar `trg_compra_sumar_stock`, inyectando
--     stock. Se restringe a Admin + Bodeguero.
--   * F12-02 (P2, auditoría): `trg_compra_sumar_stock` lee el stock con
--     `FOR UPDATE` pero si la fila de `inventario` aún no existe no bloquea
--     nada → dos compras concurrentes de un producto nuevo a la misma sede
--     calculan `stock_anterior=0` ambas y el rastro en `movimientos` queda
--     inconsistente (el `cantidad` final sí es correcto por el ON CONFLICT).
--     Se asegura la fila con INSERT ... ON CONFLICT DO NOTHING antes del
--     SELECT ... FOR UPDATE (mismo patrón que el fix F6-04).
--   * F12-03 (P2, defensa en profundidad): `fn_alertas_rotacion` es
--     SECURITY DEFINER y no validaba sesión ni rol → cualquier usuario
--     autenticado podía leer rotación/ventas/stock de todas las sedes. La
--     UI es solo-admin; se añade validación de sesión + rol Admin.

-- ── F12-01 ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS compras_update ON public.compras;
CREATE POLICY compras_update ON public.compras
  FOR UPDATE
  USING (
    (SELECT get_my_rol()) IN ('Admin', 'Bodeguero')
    AND ((SELECT get_my_rol()) = 'Admin'
         OR sede_destino_id = (SELECT get_my_sede_id()))
  )
  WITH CHECK (
    (SELECT get_my_rol()) IN ('Admin', 'Bodeguero')
    AND ((SELECT get_my_rol()) = 'Admin'
         OR sede_destino_id = (SELECT get_my_sede_id()))
  );

-- ── F12-02 ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_compra_sumar_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_compra RECORD;
  v_det RECORD;
  v_stock_ant INTEGER;
  v_stock_global_prev INTEGER;
BEGIN
  IF NEW.recibida = true AND (OLD.recibida = false OR OLD.recibida IS NULL) THEN
    -- Advisory lock: serializa recepciones concurrentes de la misma compra
    PERFORM pg_advisory_xact_lock(hashtext('compra:' || NEW.id::text));

    -- Re-lee compras con FOR UPDATE (bajo el advisory lock)
    SELECT sede_destino_id, registrado_por, recibida INTO v_compra
      FROM compras WHERE id = NEW.id FOR UPDATE;

    -- Si otra transacción ya recibió, salir sin sumar
    IF v_compra.recibida IS DISTINCT FROM NEW.recibida THEN
      RETURN NEW;
    END IF;

    FOR v_det IN SELECT * FROM detalle_compra WHERE compra_id = NEW.id LOOP
      -- Asegura que exista la fila de inventario para poder bloquearla con
      -- FOR UPDATE (si no existe, el SELECT ... FOR UPDATE no bloquea nada y
      -- dos compras concurrentes de un producto nuevo corrompen el rastro de
      -- `movimientos`). Patrón idéntico al fix F6-04 de traspasos.
      INSERT INTO inventario (producto_id, sede_id, cantidad)
      VALUES (v_det.producto_id, v_compra.sede_destino_id, 0)
      ON CONFLICT (producto_id, sede_id) DO NOTHING;

      -- Lock fila inventario para esta sede+producto (ya existe garantizado)
      SELECT COALESCE(cantidad, 0) INTO v_stock_ant
        FROM inventario
       WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id
       FOR UPDATE;

      -- Stock global previo (todas las sedes) para ponderar costo
      SELECT COALESCE(SUM(cantidad), 0) INTO v_stock_global_prev
        FROM inventario WHERE producto_id = v_det.producto_id;

      UPDATE inventario SET
        cantidad = inventario.cantidad + v_det.cantidad,
        ultimo_movimiento = now(), updated_at = now()
      WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id;

      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
                              referencia_id, referencia_tipo, usuario_id)
      VALUES ('compra', v_det.producto_id, v_compra.sede_destino_id, v_det.cantidad,
              COALESCE(v_stock_ant, 0), COALESCE(v_stock_ant, 0) + v_det.cantidad,
              NEW.id, 'compra', v_compra.registrado_por);

      -- Costo promedio ponderado por stock GLOBAL (no solo sede destino)
      UPDATE productos SET
        costo_promedio = CASE
          WHEN v_stock_global_prev = 0 THEN v_det.costo_unitario
          ELSE (costo_promedio * v_stock_global_prev + v_det.costo_unitario * v_det.cantidad)
               / NULLIF(v_stock_global_prev + v_det.cantidad, 0)
        END,
        updated_at = now()
      WHERE id = v_det.producto_id;

      PERFORM fn_actualizar_estado_stock(v_det.producto_id, v_compra.sede_destino_id);
    END LOOP;

    UPDATE compras SET fecha_recepcion = COALESCE(fecha_recepcion, now()) WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── F12-03 ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_alertas_rotacion(p_dias integer DEFAULT 30, p_sede text DEFAULT NULL::text)
 RETURNS TABLE(categoria text, producto_id uuid, nombre text, codigo_interno text, ventas_periodo integer, stock_actual integer, sede_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
