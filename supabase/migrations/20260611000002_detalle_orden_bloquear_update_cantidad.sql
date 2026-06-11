-- BAJO (auditoría 2026-06-09, B8): detalle_orden tiene AFTER INSERT (consume stock),
-- BEFORE DELETE (repone stock) y AFTER UPDATE (solo recalcula totales). Un UPDATE que
-- cambie `cantidad` recalcula subtotal/total pero NO ajusta cantidad_insumo ni registra
-- movimiento → bomba de tiempo: el día que un flujo o import edite la cantidad in-place,
-- el stock queda descuadrado (misma clase que el bug de traspaso). Hoy el frontend solo
-- hace INSERT/DELETE, nunca UPDATE de cantidad.
--
-- Fix (alineado al patrón existente delete+insert que SÍ mantiene stock y movimientos):
-- bloquear explícitamente el cambio de `cantidad`, forzando eliminar y re-agregar el
-- repuesto. Otros UPDATE (p.ej. precio/descripción) siguen permitidos.

create or replace function public.trg_detalle_orden_bloquear_update_cantidad()
 returns trigger
 language plpgsql
as $function$
begin
  if NEW.cantidad is distinct from OLD.cantidad then
    raise exception 'No se permite editar la cantidad de un repuesto en la OT; elimine la línea y vuelva a agregarla con la cantidad correcta'
      using errcode = 'check_violation';
  end if;
  return NEW;
end $function$;

drop trigger if exists trg_before_update_cantidad_detalle_orden on public.detalle_orden;
create trigger trg_before_update_cantidad_detalle_orden
  before update of cantidad on public.detalle_orden
  for each row execute function public.trg_detalle_orden_bloquear_update_cantidad();
