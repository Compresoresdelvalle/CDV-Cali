-- BUG (reporte cliente 2026-06-11): no se puede anular una venta que contiene
-- servicios ("vender servicios"). Las ventas de solo-productos sí se anulan.
--
-- Causa raíz: detalle_venta guarda las líneas de servicio con producto_id = NULL
-- (y servicio_id set). El trigger de venta (trg_venta_descontar_stock) YA ignora esas
-- líneas (`if NEW.producto_id is null then return NEW`), por eso vender servicios funciona.
-- Pero fn_anular_venta recorre TODAS las líneas y, para cada una, inserta un movimiento
-- con producto_id = v_item.producto_id. Como movimientos.producto_id es NOT NULL, la
-- línea de servicio (producto_id NULL) viola la restricción y aborta toda la anulación
-- → también bloquea anular ventas MIXTAS (productos + servicios).
--
-- Fix: saltar las líneas sin producto (servicios) en el bucle, igual que hace el trigger
-- de descuento al vender. Los servicios no mueven inventario, así que no hay nada que
-- reponer ni asentar.

create or replace function public.fn_anular_venta(p_venta_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_rol        TEXT;
  v_anulada    BOOLEAN;
  v_item       detalle_venta%ROWTYPE;
  v_sede_id    TEXT;
  v_stock_ant  INTEGER;
  v_stock_post INTEGER;
BEGIN
  SELECT get_my_rol() INTO v_rol;

  IF v_rol <> 'Admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede anular ventas';
  END IF;

  SELECT anulada, sede_id INTO v_anulada, v_sede_id
  FROM ventas WHERE id = p_venta_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;

  IF v_anulada THEN
    RAISE EXCEPTION 'La venta ya fue anulada anteriormente';
  END IF;

  PERFORM set_config('cdv.anulando_venta', 'on', true);
  UPDATE ventas SET anulada = TRUE WHERE id = p_venta_id;
  PERFORM set_config('cdv.anulando_venta', 'off', true);

  FOR v_item IN
    SELECT * FROM detalle_venta WHERE venta_id = p_venta_id
  LOOP
    -- Las líneas de servicio (producto_id NULL) no mueven inventario: saltarlas,
    -- igual que trg_venta_descontar_stock al vender. Sin esto, el INSERT a
    -- movimientos (producto_id NOT NULL) abortaría la anulación.
    IF v_item.producto_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT cantidad INTO v_stock_ant
    FROM inventario
    WHERE producto_id = v_item.producto_id AND sede_id = v_sede_id
    FOR UPDATE;

    v_stock_post := COALESCE(v_stock_ant, 0) + v_item.cantidad;

    UPDATE inventario
       SET cantidad   = v_stock_post,
           updated_at = NOW()
     WHERE producto_id = v_item.producto_id AND sede_id = v_sede_id;

    INSERT INTO movimientos (
      producto_id, sede_id, tipo, cantidad,
      stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, observaciones
    )
    SELECT
      v_item.producto_id, v_sede_id,
      'ajuste', v_item.cantidad,
      COALESCE(v_stock_ant, 0), v_stock_post,
      p_venta_id, 'venta', auth.uid(),
      'Anulación de venta #' || v.numero
    FROM ventas v WHERE v.id = p_venta_id;

    PERFORM fn_actualizar_estado_stock(v_item.producto_id, v_sede_id);
  END LOOP;
END;
$function$;
