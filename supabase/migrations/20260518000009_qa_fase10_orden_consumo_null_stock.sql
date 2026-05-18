-- QA Campaña — Fase 10 (Ajustes OT)
--
-- Hallazgo F10-01: `trg_orden_consumir_repuesto` hacía `IF v_cant < NEW.cantidad`
-- para detectar stock insuficiente. Si el producto NO tiene fila de inventario
-- en la sede de la OT, `v_cant` queda NULL; `NULL < x` es NULL (no dispara la
-- excepción), el `UPDATE inventario` no afecta filas, y el INSERT en
-- `movimientos` con `stock_anterior = NULL` viola el NOT NULL -> el alta del
-- repuesto falla con un error críptico (mismo patrón que F6-04).
--
-- Es alcanzable vía `fn_asociar_cotizacion_a_ot` (copia ítems cotizados como
-- repuestos) si un producto cotizado no se stockea en la sede de la OT.
--
-- Fix: tratar `v_cant IS NULL` como stock insuficiente (error claro).

CREATE OR REPLACE FUNCTION public.trg_orden_consumir_repuesto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_orden RECORD; v_cant INTEGER;
BEGIN
  SELECT tecnico_id, sede_id INTO v_orden FROM ordenes_servicio WHERE id = NEW.orden_id;

  SELECT cantidad INTO v_cant FROM inventario
  WHERE producto_id = NEW.producto_id AND sede_id = v_orden.sede_id FOR UPDATE;

  -- v_cant NULL = el producto no se stockea en la sede de la OT.
  IF v_cant IS NULL OR v_cant < NEW.cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente de repuesto para orden de servicio (disponible: %, requerido: %)',
      COALESCE(v_cant, 0), NEW.cantidad;
  END IF;

  UPDATE inventario SET cantidad = cantidad - NEW.cantidad,
    ultimo_movimiento = now(), updated_at = now()
  WHERE producto_id = NEW.producto_id AND sede_id = v_orden.sede_id;

  INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id)
  VALUES ('orden_consumo', NEW.producto_id, v_orden.sede_id, -NEW.cantidad,
    v_cant, v_cant - NEW.cantidad, NEW.orden_id, 'orden_servicio', v_orden.tecnico_id);

  UPDATE ordenes_servicio SET
    costo_repuestos = (SELECT COALESCE(SUM(subtotal), 0) FROM detalle_orden WHERE orden_id = NEW.orden_id),
    total = costo_mano_obra + (SELECT COALESCE(SUM(subtotal), 0) FROM detalle_orden WHERE orden_id = NEW.orden_id)
  WHERE id = NEW.orden_id;

  PERFORM fn_actualizar_estado_stock(NEW.producto_id, v_orden.sede_id);
  RETURN NEW;
END;
$function$;
