-- Rediseño OT — Opción A — FIX: blindaje de valor_repuestos / total.
--
-- Problema (Hallazgo 4, OT #72): tras DESCARGAR los repuestos (que quedan en
-- detalle_orden a precio de venta), si se vacía el borrador de cotización el
-- front hace `update ordenes_servicio set valor_repuestos = 0` (total del draft
-- vacío). El trigger BEFORE recalculaba el total confiando en ese 0 →
-- total ignoraba los repuestos ya descargados (OT 72: total 1190 vs real 4760).
--
-- Solución:
--   1) Blindaje: en el BEFORE INSERT/UPDATE de la OT, si YA hay líneas en
--      detalle_orden (repuestos descargados), valor_repuestos SIEMPRE deriva de
--      SUM(detalle.subtotal) — fuente de verdad. Vaciar el borrador ya no puede
--      dejar el total en 0. Durante la cotización en borrador (sin detalle) se
--      respeta el valor del borrador, como hasta ahora.
--   2) Re-sincronizar las OT existentes desfasadas (incluida la 72).

-- 1) Trigger blindado ---------------------------------------------------------
create or replace function public.trg_orden_recalcular_total_mo()
returns trigger language plpgsql set search_path to 'public','pg_temp'
as $$
declare v_det_rep numeric;
begin
  -- Guardia: no permitir modificar campos clave de una orden entregada.
  if TG_OP = 'UPDATE' and OLD.estado = 'entregada' and NEW.estado = 'entregada' then
    if NEW.costo_mano_obra   is distinct from OLD.costo_mano_obra
       or NEW.cliente_nombre is distinct from OLD.cliente_nombre
       or NEW.cliente_telefono is distinct from OLD.cliente_telefono
       or NEW.equipo_descripcion is distinct from OLD.equipo_descripcion
       or NEW.diagnostico   is distinct from OLD.diagnostico
       or NEW.trabajo_realizado is distinct from OLD.trabajo_realizado then
      raise exception 'No se puede modificar una orden entregada';
    end if;
  end if;

  -- BLINDAJE: si ya hay repuestos descargados, valor_repuestos deriva del
  -- detalle (fuente de verdad). Así, vaciar el borrador no puede ponerlo en 0.
  -- En INSERT no hay detalle todavía → se respeta el valor del borrador.
  if TG_OP = 'UPDATE' then
    select coalesce(sum(subtotal),0) into v_det_rep
      from detalle_orden where orden_id = NEW.id;
    if v_det_rep > 0 and NEW.valor_repuestos is distinct from v_det_rep then
      NEW.valor_repuestos := v_det_rep;
    end if;
  end if;

  if TG_OP = 'INSERT'
     or NEW.costo_mano_obra is distinct from OLD.costo_mano_obra
     or NEW.valor_repuestos is distinct from OLD.valor_repuestos
     or NEW.valor_revision is distinct from OLD.valor_revision
     or NEW.iva_pct        is distinct from OLD.iva_pct
     or NEW.descuento_valor is distinct from OLD.descuento_valor then
    NEW.total := round((coalesce(NEW.costo_mano_obra,0) + coalesce(NEW.valor_repuestos,0)
                        + coalesce(NEW.valor_revision,0) - coalesce(NEW.descuento_valor,0))
                       * (1 + coalesce(NEW.iva_pct,0)/100), 2);
  end if;
  return NEW;
end $$;

-- 2) Re-sincronizar OT desfasadas (valor_repuestos = SUM(detalle); el trigger
--    recalcula el total). Solo toca las que tienen detalle y están desfasadas.
update ordenes_servicio o
set valor_repuestos = d.s
from (
  select orden_id, sum(subtotal) as s
  from detalle_orden
  group by orden_id
) d
where d.orden_id = o.id
  and o.valor_repuestos is distinct from d.s;
