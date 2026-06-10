-- ALTO (auditoría 2026-06-09): un Vendedor podía anular su propia venta con un
-- UPDATE REST directo (PATCH anulada=true). La política ventas_update permite a
-- vendedor_id = auth.uid() actualizar su venta SIN WITH CHECK, y NO hay trigger
-- en `ventas`. Resultado: la venta queda marcada anulada PERO el stock NO se
-- restaura (la reversa de inventario solo vive en fn_anular_venta), inflando o
-- desinflando el inventario fuera de la función SECURITY DEFINER. También permitía
-- "des-anular" (true->false) a voluntad.
--
-- Fix: trigger BEFORE UPDATE en `ventas` que bloquea cualquier cambio de la
-- columna `anulada`, salvo la única transición legítima false->true ejecutada
-- DESDE fn_anular_venta (que restaura stock y asienta el movimiento de reversa).
-- fn_anular_venta marca esa ventana con un GUC transaccional `cdv.anulando_venta`.
--
-- No rompe trg_recalcular_total_venta (actualiza `total`, no `anulada`) ni los
-- reportes (solo leen `anulada`).

-- 1) fn_anular_venta: idéntica, pero habilitando la ventana de anulación con el
--    GUC transaccional alrededor del UPDATE.
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

  -- Habilita la transición anulada=false->true SOLO para el UPDATE siguiente.
  -- is_local=true => se descarta al terminar la transacción (cada request REST
  -- es su propia transacción). Se apaga de inmediato tras el UPDATE.
  PERFORM set_config('cdv.anulando_venta', 'on', true);
  UPDATE ventas SET anulada = TRUE WHERE id = p_venta_id;
  PERFORM set_config('cdv.anulando_venta', 'off', true);

  FOR v_item IN
    SELECT * FROM detalle_venta WHERE venta_id = p_venta_id
  LOOP
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

-- 2) Trigger guard: protege la columna `anulada` de mutaciones por REST directo.
create or replace function public.trg_ventas_proteger_anulacion()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
BEGIN
  IF NEW.anulada IS DISTINCT FROM OLD.anulada THEN
    -- Única transición permitida: false -> true, y solo desde fn_anular_venta
    -- (marcada con el GUC). Cualquier otra (des-anular, o anular por UPDATE
    -- directo sin restaurar stock) se rechaza.
    IF COALESCE(OLD.anulada, false) = false
       AND NEW.anulada = true
       AND current_setting('cdv.anulando_venta', true) = 'on' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'La anulación de ventas debe hacerse con fn_anular_venta (restaura el stock). No se puede modificar "anulada" por UPDATE directo.';
  END IF;
  RETURN NEW;
END;
$function$;

drop trigger if exists trg_ventas_proteger_anulacion on public.ventas;
create trigger trg_ventas_proteger_anulacion
  before update on public.ventas
  for each row
  execute function public.trg_ventas_proteger_anulacion();
