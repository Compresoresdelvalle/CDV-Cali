-- ============================================================================
-- Rediseño OT — Opción A — FASE 2b: total recalcula con valor_repuestos.
-- Permite que la cotización en BORRADOR (paso 3) refleje el total cotizado:
-- el front actualiza valor_repuestos desde cotizacion_draft y el total se
-- recalcula, para que trg_abono_validar_tope acepte el anticipo del 50%.
-- Al descargar (paso 5), el trigger de detalle_orden recalcula
-- valor_repuestos = SUM(detalle) → mismo valor, consistente.
-- ============================================================================

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
     or NEW.valor_repuestos is distinct from OLD.valor_repuestos
     or NEW.valor_revision is distinct from OLD.valor_revision
     or NEW.iva_pct        is distinct from OLD.iva_pct
     or NEW.descuento_valor is distinct from OLD.descuento_valor then
    NEW.total := round((NEW.costo_mano_obra + coalesce(NEW.valor_repuestos,0)
                        + coalesce(NEW.valor_revision,0) - coalesce(NEW.descuento_valor,0))
                       * (1 + coalesce(NEW.iva_pct,0)/100), 2);
  end if;
  return NEW;
end $$;
