-- ============================================================================
-- Bloque 3 — #10: Venta sin stock → inventario NEGATIVO (acotado a Ventas).
--
-- La clienta pidió que vender sin stock NO bloquee: el inventario baja a
-- negativo y se regulariza con un traspaso o una compra (con alerta urgente).
--
-- Para tener stock negativo hay que quitar el CHECK de columna `cantidad >= 0`
-- (es global). Es SEGURO acotarlo a Ventas porque TODOS los demás caminos que
-- restan stock conservan su propio bloqueo:
--   - trg_traspaso_salida → RAISE 'Stock insuficiente en sede origen'.
--   - OT / Ensambles consumen `cantidad_insumo` (su CHECK >= 0 se mantiene).
--   - fn_convertir_a_insumo valida cantidad disponible.
--   - Compras/Devoluciones solo SUMAN stock.
-- El único camino que ahora permite negativo es el trigger de venta (abajo).
--
-- `cantidad_insumo >= 0` se MANTIENE (insumos no van a negativo aquí).
-- ============================================================================

-- 1) Permitir cantidad negativa (solo se quita el CHECK de venta; insumo sigue).
ALTER TABLE public.inventario DROP CONSTRAINT IF EXISTS inventario_cantidad_check;

-- 2) Estado de stock: negativo (<= 0) debe marcarse 'Agotado' (antes solo = 0).
CREATE OR REPLACE FUNCTION public.fn_actualizar_estado_stock(p_producto_id uuid, p_sede_id text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_cantidad INTEGER; v_min INTEGER; v_max INTEGER; v_nuevo estado_stock;
BEGIN
  SELECT i.cantidad, p.stock_minimo, p.stock_maximo
  INTO v_cantidad, v_min, v_max
  FROM inventario i JOIN productos p ON p.id = i.producto_id
  WHERE i.producto_id = p_producto_id AND i.sede_id = p_sede_id;

  v_nuevo := CASE
    WHEN v_cantidad <= 0 THEN 'Agotado'   -- #10: negativo también es Agotado
    WHEN v_cantidad <= v_min THEN 'Bajo'
    WHEN v_cantidad > v_max THEN 'Sobrestock'
    ELSE 'OK'
  END;

  UPDATE inventario SET estado_stock = v_nuevo, updated_at = now()
  WHERE producto_id = p_producto_id AND sede_id = p_sede_id;
END; $function$;

-- 3) Trigger de venta: ya NO bloquea por stock; crea la fila si no existe y deja
--    bajar a negativo. Mantiene el log en movimientos y el recálculo de estado.
CREATE OR REPLACE FUNCTION public.trg_venta_descontar_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inv   RECORD;
  v_venta RECORD;
BEGIN
  SELECT sede_id, vendedor_id INTO v_venta FROM ventas WHERE id = NEW.venta_id;

  SELECT id, cantidad INTO v_inv
  FROM inventario
  WHERE producto_id = NEW.producto_id AND sede_id = v_venta.sede_id
  FOR UPDATE;

  -- #10: si no hay fila en esa sede, la creamos en 0 para poder ir a negativo.
  IF NOT FOUND THEN
    INSERT INTO inventario (producto_id, sede_id, cantidad)
    VALUES (NEW.producto_id, v_venta.sede_id, 0)
    ON CONFLICT (producto_id, sede_id) DO NOTHING;

    SELECT id, cantidad INTO v_inv
    FROM inventario
    WHERE producto_id = NEW.producto_id AND sede_id = v_venta.sede_id
    FOR UPDATE;
  END IF;

  -- #10: sin bloqueo por stock insuficiente — la venta puede dejar negativo.
  UPDATE inventario
  SET cantidad = cantidad - NEW.cantidad,
      ultimo_movimiento = now(),
      updated_at = now()
  WHERE id = v_inv.id;

  INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
                          referencia_id, referencia_tipo, usuario_id)
  VALUES ('venta', NEW.producto_id, v_venta.sede_id, -NEW.cantidad,
          v_inv.cantidad, v_inv.cantidad - NEW.cantidad,
          NEW.venta_id, 'venta', v_venta.vendedor_id);

  PERFORM fn_actualizar_estado_stock(NEW.producto_id, v_venta.sede_id);
  RETURN NEW;
END; $function$;
