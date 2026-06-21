-- ============================================================================
-- Rediseño OT — Opción A — FASE 2: Repuestos a PRECIO DE VENTA
-- - Nuevo trigger BEFORE INSERT que fija precio_unitario (precio_venta),
--   costo_unitario (costo_promedio) y subtotal = precio * cantidad.
-- - El consumo de insumo y los recálculos pasan a separar:
--     valor_repuestos = SUM(subtotal)            (PRECIO, lo que paga el cliente)
--     costo_repuestos = SUM(costo_unitario*cant) (COSTO, para el margen)
--     total = (mano_obra + valor_repuestos + valor_revision - descuento) * (1 + iva/100)
--   (iva_pct y descuento_valor por ahora son 0 por defecto → total = suma simple)
-- ============================================================================

-- 1) BEFORE INSERT: fijar precio/costo/subtotal de cada línea desde el catálogo
create or replace function public.trg_orden_fijar_precio_detalle()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_precio numeric; v_costo numeric;
begin
  select precio_venta, costo_promedio into v_precio, v_costo from productos where id = NEW.producto_id;
  if coalesce(NEW.precio_unitario,0) = 0 then NEW.precio_unitario := coalesce(v_precio,0); end if;
  if coalesce(NEW.costo_unitario,0)  = 0 then NEW.costo_unitario  := coalesce(v_costo,0);  end if;
  NEW.subtotal := coalesce(NEW.precio_unitario,0) * NEW.cantidad;
  return NEW;
end $$;

drop trigger if exists trg_before_insert_fijar_precio_detalle on detalle_orden;
create trigger trg_before_insert_fijar_precio_detalle
  before insert on detalle_orden
  for each row execute function trg_orden_fijar_precio_detalle();

-- 2) AFTER INSERT: consumir insumo (igual que hoy) + recálculo con precio/costo separados
create or replace function public.trg_orden_consumir_repuesto()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_orden record; v_cant int; v_val numeric; v_cost numeric;
begin
  select tecnico_id, sede_id into v_orden from ordenes_servicio where id = NEW.orden_id;

  select cantidad_insumo into v_cant from inventario
   where producto_id = NEW.producto_id and sede_id = v_orden.sede_id for update;
  if v_cant is null or v_cant < NEW.cantidad then
    raise exception 'Stock de insumo insuficiente para la orden (disponible: %, requerido: %). Convierte stock de venta a insumo primero.',
      coalesce(v_cant,0), NEW.cantidad;
  end if;

  update inventario set cantidad_insumo = cantidad_insumo - NEW.cantidad,
    ultimo_movimiento = now(), updated_at = now()
   where producto_id = NEW.producto_id and sede_id = v_orden.sede_id;

  insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id)
  values ('orden_consumo', NEW.producto_id, v_orden.sede_id, -NEW.cantidad,
    v_cant, v_cant - NEW.cantidad, NEW.orden_id, 'orden_servicio',
    coalesce(auth.uid(), v_orden.tecnico_id));

  select coalesce(sum(subtotal),0), coalesce(sum(costo_unitario*cantidad),0)
    into v_val, v_cost from detalle_orden where orden_id = NEW.orden_id;

  update ordenes_servicio o set
    valor_repuestos = v_val,
    costo_repuestos = v_cost,
    total = round((o.costo_mano_obra + v_val + coalesce(o.valor_revision,0) - coalesce(o.descuento_valor,0))
                  * (1 + coalesce(o.iva_pct,0)/100), 2),
    updated_at = now()
   where o.id = NEW.orden_id;

  perform fn_actualizar_estado_stock(NEW.producto_id, v_orden.sede_id);
  return NEW;
end $$;

-- 3) AFTER DELETE/UPDATE de detalle: mismo recálculo
create or replace function public.trg_orden_recalcular_totales()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_orden_id uuid; v_val numeric; v_cost numeric;
begin
  v_orden_id := coalesce(NEW.orden_id, OLD.orden_id);
  select coalesce(sum(subtotal),0), coalesce(sum(costo_unitario*cantidad),0)
    into v_val, v_cost from detalle_orden where orden_id = v_orden_id;
  update ordenes_servicio o set
    valor_repuestos = v_val,
    costo_repuestos = v_cost,
    total = round((o.costo_mano_obra + v_val + coalesce(o.valor_revision,0) - coalesce(o.descuento_valor,0))
                  * (1 + coalesce(o.iva_pct,0)/100), 2),
    updated_at = now()
   where o.id = v_orden_id;
  return null;
end $$;

-- 4) BEFORE UPDATE de la OT: recalcular total si cambia mano_obra/revisión/iva/descuento
create or replace function public.trg_orden_recalcular_total_mo()
returns trigger language plpgsql set search_path to 'public','pg_temp'
as $$
begin
  if OLD.estado = 'entregada' and NEW.estado = 'entregada' then
    if NEW.costo_mano_obra   is distinct from OLD.costo_mano_obra
       or NEW.cliente_nombre is distinct from OLD.cliente_nombre
       or NEW.cliente_telefono is distinct from OLD.cliente_telefono
       or NEW.equipo_descripcion is distinct from OLD.equipo_descripcion
       or NEW.diagnostico   is distinct from OLD.diagnostico
       or NEW.trabajo_realizado is distinct from OLD.trabajo_realizado then
      raise exception 'No se puede modificar una orden entregada';
    end if;
  end if;

  if NEW.costo_mano_obra is distinct from OLD.costo_mano_obra
     or NEW.valor_revision is distinct from OLD.valor_revision
     or NEW.iva_pct        is distinct from OLD.iva_pct
     or NEW.descuento_valor is distinct from OLD.descuento_valor then
    NEW.total := round((NEW.costo_mano_obra + coalesce(NEW.valor_repuestos,0)
                        + coalesce(NEW.valor_revision,0) - coalesce(NEW.descuento_valor,0))
                       * (1 + coalesce(NEW.iva_pct,0)/100), 2);
  end if;
  return NEW;
end $$;
