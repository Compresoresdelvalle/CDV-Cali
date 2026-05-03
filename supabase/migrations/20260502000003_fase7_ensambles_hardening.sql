-- ============================================================================
-- Fase 7 — Hardening para Ensambles
--
-- Aplica DESPUÉS de 20260502000002_fase7_hardening.sql
--
-- Problemas resueltos:
--   1) trg_ensamble_stock sin SET search_path (search_path injection)
--   2) RLS faltante o permisiva en ensambles, detalle_ensamble, recetas_bom
--   3) Índices faltantes en sede_id de ensambles
--   4) Mensaje de error de stock insuficiente más claro (incluye producto)
-- ============================================================================

-- ── 1) Reescribir trg_ensamble_stock con SET search_path ───────────────────

CREATE OR REPLACE FUNCTION trg_ensamble_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_det RECORD;
  v_cant INTEGER;
  v_stock_resultado INTEGER;
  v_costo NUMERIC := 0;
  v_nombre_falta TEXT;
BEGIN
  IF NEW.completado = true AND (OLD.completado = false OR OLD.completado IS NULL) THEN
    -- Consumir cada componente
    FOR v_det IN SELECT * FROM detalle_ensamble WHERE ensamble_id = NEW.id LOOP
      SELECT cantidad INTO v_cant FROM inventario
       WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_id
       FOR UPDATE;

      IF v_cant IS NULL OR v_cant < v_det.cantidad THEN
        SELECT nombre INTO v_nombre_falta FROM productos WHERE id = v_det.producto_id;
        RAISE EXCEPTION 'Stock insuficiente del componente "%" (necesita %, hay %)',
          COALESCE(v_nombre_falta, v_det.producto_id::text),
          v_det.cantidad,
          COALESCE(v_cant, 0);
      END IF;

      UPDATE inventario
         SET cantidad = cantidad - v_det.cantidad,
             ultimo_movimiento = now(),
             updated_at = now()
       WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_id;

      INSERT INTO movimientos (
        tipo, producto_id, sede_id, cantidad,
        stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id
      )
      VALUES (
        'ensamble_consumo', v_det.producto_id, NEW.sede_id,
        -v_det.cantidad, v_cant, v_cant - v_det.cantidad,
        NEW.id, 'ensamble', NEW.realizado_por
      );

      v_costo := v_costo + (v_det.costo_unitario * v_det.cantidad);
      PERFORM fn_actualizar_estado_stock(v_det.producto_id, NEW.sede_id);
    END LOOP;

    -- Producir el resultado
    SELECT cantidad INTO v_stock_resultado FROM inventario
     WHERE producto_id = NEW.producto_resultado_id AND sede_id = NEW.sede_id
     FOR UPDATE;

    IF v_stock_resultado IS NULL THEN
      INSERT INTO inventario (producto_id, sede_id, cantidad)
      VALUES (NEW.producto_resultado_id, NEW.sede_id, NEW.cantidad_producida);
      v_stock_resultado := 0;
    ELSE
      UPDATE inventario
         SET cantidad = cantidad + NEW.cantidad_producida,
             ultimo_movimiento = now(),
             updated_at = now()
       WHERE producto_id = NEW.producto_resultado_id AND sede_id = NEW.sede_id;
    END IF;

    INSERT INTO movimientos (
      tipo, producto_id, sede_id, cantidad,
      stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id
    )
    VALUES (
      'ensamble_produccion', NEW.producto_resultado_id, NEW.sede_id,
      NEW.cantidad_producida, v_stock_resultado, v_stock_resultado + NEW.cantidad_producida,
      NEW.id, 'ensamble', NEW.realizado_por
    );

    UPDATE ensambles SET costo_total = v_costo WHERE id = NEW.id;
    PERFORM fn_actualizar_estado_stock(NEW.producto_resultado_id, NEW.sede_id);
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2) RLS estricta en ensambles ───────────────────────────────────────────

ALTER TABLE ensambles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ens_all" ON ensambles;
DROP POLICY IF EXISTS "ens_select" ON ensambles;
DROP POLICY IF EXISTS "ens_insert" ON ensambles;
DROP POLICY IF EXISTS "ens_update" ON ensambles;

CREATE POLICY "ens_select" ON ensambles
  FOR SELECT TO authenticated
  USING (
    (SELECT get_my_rol()) = 'Admin'
    OR sede_id = (SELECT get_my_sede_id())
  );

CREATE POLICY "ens_insert" ON ensambles
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT get_my_rol()) IN ('Admin', 'Bodeguero', 'Tecnico')
    AND (
      (SELECT get_my_rol()) = 'Admin'
      OR sede_id = (SELECT get_my_sede_id())
    )
  );

-- Solo el creador o Admin puede marcar completado.
-- Una vez completado=true, NO se puede revertir ni modificar.
CREATE POLICY "ens_update" ON ensambles
  FOR UPDATE TO authenticated
  USING (
    completado = false
    AND (
      (SELECT get_my_rol()) = 'Admin'
      OR realizado_por = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    (SELECT get_my_rol()) = 'Admin'
    OR realizado_por = (SELECT auth.uid())
  );

-- ── 3) RLS en detalle_ensamble ─────────────────────────────────────────────

ALTER TABLE detalle_ensamble ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "de_all" ON detalle_ensamble;
DROP POLICY IF EXISTS "de_select" ON detalle_ensamble;
DROP POLICY IF EXISTS "de_write" ON detalle_ensamble;

CREATE POLICY "de_select" ON detalle_ensamble
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ensambles e
       WHERE e.id = detalle_ensamble.ensamble_id
         AND ((SELECT get_my_rol()) = 'Admin'
              OR e.sede_id = (SELECT get_my_sede_id()))
    )
  );

-- INSERT/UPDATE/DELETE solo cuando el ensamble NO está completado y el usuario
-- es Admin o el creador del ensamble.
CREATE POLICY "de_write" ON detalle_ensamble
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ensambles e
       WHERE e.id = detalle_ensamble.ensamble_id
         AND e.completado = false
         AND ((SELECT get_my_rol()) = 'Admin'
              OR e.realizado_por = (SELECT auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ensambles e
       WHERE e.id = detalle_ensamble.ensamble_id
         AND e.completado = false
         AND ((SELECT get_my_rol()) = 'Admin'
              OR e.realizado_por = (SELECT auth.uid()))
    )
  );

-- ── 4) RLS en recetas_bom — solo Admin las gestiona, todos las leen ────────

ALTER TABLE recetas_bom ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bom_all" ON recetas_bom;
DROP POLICY IF EXISTS "bom_select" ON recetas_bom;
DROP POLICY IF EXISTS "bom_write" ON recetas_bom;

CREATE POLICY "bom_select" ON recetas_bom
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "bom_write" ON recetas_bom
  FOR ALL TO authenticated
  USING ((SELECT get_my_rol()) = 'Admin')
  WITH CHECK ((SELECT get_my_rol()) = 'Admin');

-- ── 5) Índices faltantes ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ensambles_sede ON ensambles(sede_id);
CREATE INDEX IF NOT EXISTS idx_ensambles_realizador ON ensambles(realizado_por);
CREATE INDEX IF NOT EXISTS idx_ensambles_completado ON ensambles(completado, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_detalle_ensamble_producto ON detalle_ensamble(producto_id);
CREATE INDEX IF NOT EXISTS idx_bom_componente ON recetas_bom(componente_id);
