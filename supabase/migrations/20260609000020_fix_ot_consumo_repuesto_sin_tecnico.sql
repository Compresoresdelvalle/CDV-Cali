-- ALTO (auditoría 2026-06-09): agregar un repuesto a una OT SIN técnico asignado
-- fallaba. trg_orden_consumir_repuesto insertaba el movimiento con
-- usuario_id = v_orden.tecnico_id, que es NULL en OTs sin técnico (estado normal
-- del modelo: el técnico se asigna en un 2º momento). Como movimientos.usuario_id
-- es NOT NULL, la inserción de detalle_orden abortaba con error de constraint,
-- bloqueando también fn_asociar_cotizacion_a_ot (que inserta detalle_orden).
--
-- Fix: usar COALESCE(auth.uid(), v_orden.tecnico_id) — el usuario que ejecuta la
-- acción —, igual que ya hacía el trigger de reversa trg_orden_revertir_repuesto.

create or replace function public.trg_orden_consumir_repuesto()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE v_orden RECORD; v_cant INTEGER;
BEGIN
  SELECT tecnico_id, sede_id INTO v_orden FROM ordenes_servicio WHERE id = NEW.orden_id;

  SELECT cantidad_insumo INTO v_cant FROM inventario
  WHERE producto_id = NEW.producto_id AND sede_id = v_orden.sede_id FOR UPDATE;

  IF v_cant IS NULL OR v_cant < NEW.cantidad THEN
    RAISE EXCEPTION 'Stock de insumo insuficiente para la orden de servicio (disponible: %, requerido: %). Convierte stock de venta a insumo primero.',
      COALESCE(v_cant, 0), NEW.cantidad;
  END IF;

  UPDATE inventario SET cantidad_insumo = cantidad_insumo - NEW.cantidad,
    ultimo_movimiento = now(), updated_at = now()
  WHERE producto_id = NEW.producto_id AND sede_id = v_orden.sede_id;

  -- usuario_id es NOT NULL: usar el usuario que ejecuta la acción; si no hubiera
  -- sesión, caer al técnico. Antes usaba solo v_orden.tecnico_id (NULL en OTs sin
  -- técnico) y rompía el consumo de repuestos.
  INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id)
  VALUES ('orden_consumo', NEW.producto_id, v_orden.sede_id, -NEW.cantidad,
    v_cant, v_cant - NEW.cantidad, NEW.orden_id, 'orden_servicio',
    COALESCE(auth.uid(), v_orden.tecnico_id));

  UPDATE ordenes_servicio SET
    costo_repuestos = (SELECT COALESCE(SUM(subtotal), 0) FROM detalle_orden WHERE orden_id = NEW.orden_id),
    total = costo_mano_obra + (SELECT COALESCE(SUM(subtotal), 0) FROM detalle_orden WHERE orden_id = NEW.orden_id)
  WHERE id = NEW.orden_id;

  PERFORM fn_actualizar_estado_stock(NEW.producto_id, v_orden.sede_id);
  RETURN NEW;
END;
$function$;
