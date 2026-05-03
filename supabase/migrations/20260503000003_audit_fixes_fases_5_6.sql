-- ============================================================================
-- Audit Fases 5-6 — Cierra hallazgos CRITICAL/HIGH/MEDIUM
-- Aplicado via MCP el 2026-05-03 (este archivo es solo para reproducibilidad)
-- ============================================================================

-- ── 1) trg_compra_sumar_stock con advisory lock + FOR UPDATE + costo global ─
CREATE OR REPLACE FUNCTION public.trg_compra_sumar_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_compra RECORD;
  v_det RECORD;
  v_stock_ant INTEGER;
  v_stock_global_prev INTEGER;
BEGIN
  IF NEW.recibida = true AND (OLD.recibida = false OR OLD.recibida IS NULL) THEN
    PERFORM pg_advisory_xact_lock(hashtext('compra:' || NEW.id::text));
    SELECT sede_destino_id, registrado_por, recibida INTO v_compra
      FROM compras WHERE id = NEW.id FOR UPDATE;
    IF v_compra.recibida IS DISTINCT FROM NEW.recibida THEN RETURN NEW; END IF;
    FOR v_det IN SELECT * FROM detalle_compra WHERE compra_id = NEW.id LOOP
      SELECT COALESCE(cantidad, 0) INTO v_stock_ant
        FROM inventario WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id
        FOR UPDATE;
      SELECT COALESCE(SUM(cantidad), 0) INTO v_stock_global_prev
        FROM inventario WHERE producto_id = v_det.producto_id;
      INSERT INTO inventario (producto_id, sede_id, cantidad)
      VALUES (v_det.producto_id, v_compra.sede_destino_id, v_det.cantidad)
      ON CONFLICT (producto_id, sede_id) DO UPDATE SET
        cantidad = inventario.cantidad + v_det.cantidad,
        ultimo_movimiento = now(), updated_at = now();
      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
                              referencia_id, referencia_tipo, usuario_id)
      VALUES ('compra', v_det.producto_id, v_compra.sede_destino_id, v_det.cantidad,
              COALESCE(v_stock_ant, 0), COALESCE(v_stock_ant, 0) + v_det.cantidad,
              NEW.id, 'compra', v_compra.registrado_por);
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
$$;

-- ── 2) Inmutabilidad recibida true→false ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_compra_recibida_inmutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.recibida = true AND NEW.recibida = false THEN
    RAISE EXCEPTION 'No se puede revertir una compra recibida';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_before_update_compra_recibida ON compras;
CREATE TRIGGER trg_before_update_compra_recibida
  BEFORE UPDATE OF recibida ON compras
  FOR EACH ROW EXECUTE FUNCTION trg_compra_recibida_inmutable();

-- ── 3) Triggers traspaso con FOR UPDATE + columna correcta ─────────────────
CREATE OR REPLACE FUNCTION public.trg_traspaso_salida()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_det RECORD; v_cant INTEGER; v_enviar INTEGER;
BEGIN
  IF NEW.estado = 'en_transito' AND OLD.estado = 'verificado' THEN
    PERFORM pg_advisory_xact_lock(hashtext('traspaso:' || NEW.id::text));
    FOR v_det IN SELECT * FROM detalle_traspaso WHERE traspaso_id = NEW.id LOOP
      v_enviar := COALESCE(v_det.cantidad_enviada, v_det.cantidad_solicitada);
      SELECT cantidad INTO v_cant
        FROM inventario WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_origen_id
        FOR UPDATE;
      IF v_cant IS NULL OR v_cant < v_enviar THEN
        RAISE EXCEPTION 'Stock insuficiente en sede origen';
      END IF;
      UPDATE inventario SET cantidad = cantidad - v_enviar, ultimo_movimiento = now(), updated_at = now()
       WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_origen_id;
      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id)
      VALUES ('traspaso_salida', v_det.producto_id, NEW.sede_origen_id, -v_enviar,
        v_cant, v_cant - v_enviar, NEW.id, 'traspaso', NEW.solicitado_por);
      PERFORM fn_actualizar_estado_stock(v_det.producto_id, NEW.sede_origen_id);
    END LOOP;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_traspaso_entrada()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_det RECORD; v_stock_ant INTEGER; v_recibir INTEGER;
BEGIN
  IF NEW.estado IN ('recibido', 'con_diferencia') AND OLD.estado = 'en_transito' THEN
    PERFORM pg_advisory_xact_lock(hashtext('traspaso:' || NEW.id::text));
    FOR v_det IN SELECT * FROM detalle_traspaso WHERE traspaso_id = NEW.id LOOP
      v_recibir := COALESCE(v_det.cantidad_recibida, v_det.cantidad_enviada, v_det.cantidad_solicitada);
      SELECT COALESCE(cantidad, 0) INTO v_stock_ant
        FROM inventario WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_destino_id
        FOR UPDATE;
      INSERT INTO inventario (producto_id, sede_id, cantidad)
      VALUES (v_det.producto_id, NEW.sede_destino_id, v_recibir)
      ON CONFLICT (producto_id, sede_id) DO UPDATE SET
        cantidad = inventario.cantidad + v_recibir,
        ultimo_movimiento = now(), updated_at = now();
      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id)
      VALUES ('traspaso_entrada', v_det.producto_id, NEW.sede_destino_id, v_recibir,
        v_stock_ant, v_stock_ant + v_recibir, NEW.id, 'traspaso', NEW.solicitado_por);
      PERFORM fn_actualizar_estado_stock(v_det.producto_id, NEW.sede_destino_id);
    END LOOP;
  END IF;
  RETURN NEW;
END; $$;

-- ── 4) State machine validator (impide UPDATE directo bypass de RPC) ───────
CREATE OR REPLACE FUNCTION public.trg_traspaso_validar_transicion()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.estado = NEW.estado THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.estado = 'borrador' AND NEW.estado = 'picking') OR
    (OLD.estado = 'picking' AND NEW.estado = 'verificado') OR
    (OLD.estado = 'verificado' AND NEW.estado = 'en_transito') OR
    (OLD.estado = 'en_transito' AND NEW.estado IN ('recibido', 'con_diferencia'))
  ) THEN
    RAISE EXCEPTION 'Transición de traspaso inválida: % -> %', OLD.estado, NEW.estado;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_before_update_traspaso_estado ON traspasos;
CREATE TRIGGER trg_before_update_traspaso_estado
  BEFORE UPDATE OF estado ON traspasos
  FOR EACH ROW EXECUTE FUNCTION trg_traspaso_validar_transicion();

-- ── 5) CHECK constraints ───────────────────────────────────────────────────
ALTER TABLE traspasos DROP CONSTRAINT IF EXISTS chk_traspaso_sedes_diferentes;
ALTER TABLE traspasos ADD CONSTRAINT chk_traspaso_sedes_diferentes
  CHECK (sede_origen_id <> sede_destino_id);
ALTER TABLE traspasos DROP CONSTRAINT IF EXISTS chk_picker_distinto_verificador;
ALTER TABLE traspasos ADD CONSTRAINT chk_picker_distinto_verificador
  CHECK (verificado_por IS NULL OR picker_id IS NULL OR verificado_por <> picker_id);
ALTER TABLE detalle_compra DROP CONSTRAINT IF EXISTS chk_costo_unitario_no_negativo;
ALTER TABLE detalle_compra ADD CONSTRAINT chk_costo_unitario_no_negativo
  CHECK (costo_unitario >= 0);
ALTER TABLE detalle_traspaso DROP CONSTRAINT IF EXISTS chk_cantidad_traspaso_positiva;
ALTER TABLE detalle_traspaso ADD CONSTRAINT chk_cantidad_traspaso_positiva
  CHECK (cantidad_solicitada > 0);

-- ── 6) RLS endurecida en compras + detalle_compra ──────────────────────────
DROP POLICY IF EXISTS "compras_all" ON compras;
DROP POLICY IF EXISTS "compras_select" ON compras;
DROP POLICY IF EXISTS "compras_insert" ON compras;
DROP POLICY IF EXISTS "compras_update" ON compras;
CREATE POLICY "compras_select" ON compras FOR SELECT TO authenticated
  USING ((SELECT get_my_rol()) = 'Admin' OR sede_destino_id = (SELECT get_my_sede_id()));
CREATE POLICY "compras_insert" ON compras FOR INSERT TO authenticated
  WITH CHECK ((SELECT get_my_rol()) IN ('Admin','Bodeguero')
              AND ((SELECT get_my_rol()) = 'Admin' OR sede_destino_id = (SELECT get_my_sede_id())));
CREATE POLICY "compras_update" ON compras FOR UPDATE TO authenticated
  USING ((SELECT get_my_rol()) = 'Admin' OR sede_destino_id = (SELECT get_my_sede_id()));

DROP POLICY IF EXISTS "dc_all" ON detalle_compra;
DROP POLICY IF EXISTS "dc_select" ON detalle_compra;
DROP POLICY IF EXISTS "dc_write" ON detalle_compra;
CREATE POLICY "dc_select" ON detalle_compra FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM compras c WHERE c.id = detalle_compra.compra_id
    AND ((SELECT get_my_rol()) = 'Admin' OR c.sede_destino_id = (SELECT get_my_sede_id()))));
CREATE POLICY "dc_write" ON detalle_compra FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM compras c WHERE c.id = detalle_compra.compra_id
    AND c.recibida = false
    AND ((SELECT get_my_rol()) = 'Admin' OR c.sede_destino_id = (SELECT get_my_sede_id()))))
  WITH CHECK (EXISTS (SELECT 1 FROM compras c WHERE c.id = detalle_compra.compra_id
    AND ((SELECT get_my_rol()) = 'Admin' OR c.sede_destino_id = (SELECT get_my_sede_id()))));

-- ── 7) Índices nuevos ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_detalle_compra_compra ON detalle_compra(compra_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_venta_producto ON devoluciones(venta_id, producto_id);
CREATE INDEX IF NOT EXISTS idx_traspasos_estado_sede_destino ON traspasos(estado, sede_destino_id);
CREATE INDEX IF NOT EXISTS idx_compras_sede_destino_fecha ON compras(sede_destino_id, fecha DESC);

-- ── 8) fn_registrar_devolucion con semántica correcta + validaciones ───────
-- cliente: SUMA stock (reingresa)
-- proveedor: RESTA stock (sale al proveedor)
-- Valida: venta no anulada, cantidad ≤ vendido - devuelto previo, stock suficiente
CREATE OR REPLACE FUNCTION public.fn_registrar_devolucion(
  p_tipo text, p_producto_id uuid, p_sede_id text, p_cantidad integer,
  p_motivo text DEFAULT 'Sin motivo especificado',
  p_venta_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_usuario_id UUID; v_dev_id UUID; v_numero INT;
  v_stock_ant INTEGER; v_stock_post INTEGER;
  v_venta_estado TEXT; v_cantidad_original INTEGER; v_devuelto_previo INTEGER;
  v_signo INTEGER; v_reingresa BOOLEAN;
BEGIN
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  IF p_tipo NOT IN ('cliente','proveedor') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  IF p_cantidad <= 0 THEN RAISE EXCEPTION 'Cantidad debe ser mayor a 0'; END IF;

  IF p_tipo = 'cliente' THEN
    v_signo := 1; v_reingresa := true;
    IF p_venta_id IS NULL THEN RAISE EXCEPTION 'Devolución de cliente requiere venta_id'; END IF;
    SELECT estado INTO v_venta_estado FROM ventas WHERE id = p_venta_id;
    IF v_venta_estado IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;
    IF v_venta_estado = 'anulada' THEN RAISE EXCEPTION 'No se puede devolver de una venta anulada'; END IF;
    SELECT COALESCE(SUM(cantidad), 0) INTO v_cantidad_original
      FROM detalle_venta WHERE venta_id = p_venta_id AND producto_id = p_producto_id;
    IF v_cantidad_original = 0 THEN RAISE EXCEPTION 'Producto no estaba en la venta original'; END IF;
    SELECT COALESCE(SUM(cantidad), 0) INTO v_devuelto_previo
      FROM devoluciones WHERE venta_id = p_venta_id AND producto_id = p_producto_id;
    IF v_devuelto_previo + p_cantidad > v_cantidad_original THEN
      RAISE EXCEPTION 'Cantidad excede lo vendido (vendido=%, ya devuelto=%, intentas=%)',
        v_cantidad_original, v_devuelto_previo, p_cantidad;
    END IF;
  ELSE
    v_signo := -1; v_reingresa := false;
  END IF;

  INSERT INTO inventario (producto_id, sede_id, cantidad, estado_stock)
  VALUES (p_producto_id, p_sede_id, 0, 'OK')
  ON CONFLICT (producto_id, sede_id) DO NOTHING;

  SELECT cantidad INTO v_stock_ant FROM inventario
   WHERE producto_id = p_producto_id AND sede_id = p_sede_id FOR UPDATE;

  IF v_signo = -1 AND v_stock_ant < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente para devolver al proveedor';
  END IF;

  INSERT INTO devoluciones (venta_id, producto_id, sede_id, cantidad, motivo,
    registrado_por, reingresa_stock, estado)
  VALUES (p_venta_id, p_producto_id, p_sede_id, p_cantidad,
    COALESCE(p_motivo, 'Sin motivo'), v_usuario_id, v_reingresa, 'procesada')
  RETURNING id, numero INTO v_dev_id, v_numero;

  UPDATE inventario
     SET cantidad = cantidad + (v_signo * p_cantidad),
         ultimo_movimiento = now(), updated_at = now()
   WHERE producto_id = p_producto_id AND sede_id = p_sede_id
   RETURNING cantidad INTO v_stock_post;

  INSERT INTO movimientos (producto_id, sede_id, tipo, cantidad,
    stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
  VALUES (p_producto_id, p_sede_id, 'devolucion', v_signo * p_cantidad,
    v_stock_ant, v_stock_post, v_dev_id, 'devolucion', v_usuario_id,
    CASE WHEN p_tipo = 'cliente' THEN 'Devolución de cliente #' || v_numero
         ELSE 'Devolución a proveedor #' || v_numero END);

  PERFORM fn_actualizar_estado_stock(p_producto_id, p_sede_id);

  RETURN jsonb_build_object(
    'devolucion_id', v_dev_id, 'numero', v_numero, 'tipo', p_tipo,
    'delta_stock', v_signo * p_cantidad,
    'stock_anterior', v_stock_ant, 'stock_posterior', v_stock_post
  );
END;
$$;
