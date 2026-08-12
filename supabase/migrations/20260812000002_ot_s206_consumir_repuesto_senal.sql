-- Complemento del fix S2-06 (ver 20260812000001).
--
-- En un INSERT de repuesto en detalle_orden el trigger que corre NO es
-- trg_orden_recalcular_totales (ese es AFTER UPDATE/DELETE), sino
-- trg_orden_consumir_repuesto (AFTER INSERT): consume el insumo Y recalcula el
-- total de la OT con su propio UPDATE. Ese UPDATE no marcaba la señal
-- cdv.recalc_detalle, así que la guarda S2-06 seguía bloqueando la descarga en
-- el PRIMER repuesto (confirmado en pruebas: total intermedio 83.000 < 110.000
-- abonado). Se marca la señal también aquí.
CREATE OR REPLACE FUNCTION public.trg_orden_consumir_repuesto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Señal: recálculo por descarga de repuestos (INSERT en detalle_orden). Igual
  -- que en trg_orden_recalcular_totales: S2-06 no debe bloquear estos estados
  -- intermedios; el tope real se valida al cerrar la OT (fn_generar_venta_ot).
  perform set_config('cdv.recalc_detalle', '1', true);
  update ordenes_servicio o set
    valor_repuestos = v_val,
    costo_repuestos = v_cost,
    total = round((o.costo_mano_obra + v_val + coalesce(o.valor_revision,0) - coalesce(o.descuento_valor,0))
                  * (1 + coalesce(o.iva_pct,0)/100), 2),
    updated_at = now()
   where o.id = NEW.orden_id;
  perform set_config('cdv.recalc_detalle', '', true);

  perform fn_actualizar_estado_stock(NEW.producto_id, v_orden.sede_id);
  return NEW;
end $function$;