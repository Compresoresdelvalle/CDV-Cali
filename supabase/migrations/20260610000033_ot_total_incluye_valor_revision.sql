-- MEDIO (auditoría 2026-06-09, M6): el `total` de la OT se calcula como
-- costo_mano_obra + costo_repuestos en los 3 triggers, SIN incluir valor_revision.
-- Para OTs cerradas como 'no_autorizado' el único cobro es valor_revision, pero
-- total quedaba en 0 → el recibo PDF mostraba "Valor de revisión" como ítem y
-- TOTAL=0 (incongruencia aritmética en un documento al cliente). OrdenDetalle.jsx
-- parcheaba localmente (totalOT = total + valor_revision), duplicando lógica.
--
-- Fix: definir el total cobrable canónico = costo_mano_obra + costo_repuestos +
-- valor_revision en los 3 triggers (y recomputar también cuando cambia
-- valor_revision en trg_orden_recalcular_total_mo). Backfill de las filas existentes.
-- El parche local de OrdenDetalle.jsx se elimina aparte (frontend).

-- (1) consumo de repuesto (AFTER INSERT detalle_orden) ----------------------------
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

  INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id)
  VALUES ('orden_consumo', NEW.producto_id, v_orden.sede_id, -NEW.cantidad,
    v_cant, v_cant - NEW.cantidad, NEW.orden_id, 'orden_servicio',
    COALESCE(auth.uid(), v_orden.tecnico_id));

  UPDATE ordenes_servicio SET
    costo_repuestos = (SELECT COALESCE(SUM(subtotal), 0) FROM detalle_orden WHERE orden_id = NEW.orden_id),
    total = costo_mano_obra
            + (SELECT COALESCE(SUM(subtotal), 0) FROM detalle_orden WHERE orden_id = NEW.orden_id)
            + COALESCE(valor_revision, 0)
  WHERE id = NEW.orden_id;

  PERFORM fn_actualizar_estado_stock(NEW.producto_id, v_orden.sede_id);
  RETURN NEW;
END;
$function$;

-- (2) recálculo por cambios en detalle_orden (INSERT/DELETE) ----------------------
create or replace function public.trg_orden_recalcular_totales()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_orden_id UUID;
  v_sum NUMERIC(12,2);
BEGIN
  v_orden_id := COALESCE(NEW.orden_id, OLD.orden_id);

  SELECT COALESCE(SUM(subtotal), 0) INTO v_sum
    FROM detalle_orden WHERE orden_id = v_orden_id;

  UPDATE ordenes_servicio o
     SET costo_repuestos = v_sum,
         total = o.costo_mano_obra + v_sum + COALESCE(o.valor_revision, 0),
         updated_at = now()
   WHERE id = v_orden_id;

  RETURN NULL;
END;
$function$;

-- (3) recálculo por cambio de mano de obra / valor_revision (BEFORE UPDATE) -------
create or replace function public.trg_orden_recalcular_total_mo()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
BEGIN
  IF OLD.estado = 'entregada' AND NEW.estado = 'entregada' THEN
    IF NEW.costo_mano_obra IS DISTINCT FROM OLD.costo_mano_obra
       OR NEW.cliente_nombre IS DISTINCT FROM OLD.cliente_nombre
       OR NEW.cliente_telefono IS DISTINCT FROM OLD.cliente_telefono
       OR NEW.equipo_descripcion IS DISTINCT FROM OLD.equipo_descripcion
       OR NEW.diagnostico IS DISTINCT FROM OLD.diagnostico
       OR NEW.trabajo_realizado IS DISTINCT FROM OLD.trabajo_realizado THEN
      RAISE EXCEPTION 'No se puede modificar una orden entregada';
    END IF;
  END IF;

  IF NEW.costo_mano_obra IS DISTINCT FROM OLD.costo_mano_obra
     OR NEW.valor_revision IS DISTINCT FROM OLD.valor_revision THEN
    NEW.total := NEW.costo_mano_obra + COALESCE(NEW.costo_repuestos, 0) + COALESCE(NEW.valor_revision, 0);
  END IF;
  RETURN NEW;
END;
$function$;

-- (4) Backfill: corregir total de las OTs existentes (incluye entregadas; el SET de
-- total solo no dispara el bloqueo de "orden entregada" porque no toca campos de
-- negocio ni costo_mano_obra).
update ordenes_servicio
   set total = costo_mano_obra + COALESCE(costo_repuestos, 0) + COALESCE(valor_revision, 0)
 where total is distinct from (costo_mano_obra + COALESCE(costo_repuestos, 0) + COALESCE(valor_revision, 0));
