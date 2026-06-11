-- MEDIO (auditoría 2026-06-09, M9): las garantías de venta con resolución
-- 'arreglar_producto' nacen estado='abierta' y NUNCA cierran — no existía función
-- ni trigger que las pasara a 'cerrada', y la tabla garantias_venta no tenía
-- columnas de auditoría de cierre (sí existen en garantias_compra). Resultado:
-- métricas de garantías abiertas infladas y sin registro de quién/cuándo cerró.
--
-- DECISIÓN CLIENTE: implementar el cierre (auto al entregar la OT de reparación).
--
-- Fix: (1) añadir cerrado_por / fecha_cierre a garantias_venta (paridad con
-- garantias_compra); (2) trigger en ordenes_servicio que, cuando la OT de reparación
-- referenciada por garantias_venta.ot_reparacion_id pase a 'entregada', cierre la
-- garantía vinculada.

alter table public.garantias_venta
  add column if not exists cerrado_por uuid,
  add column if not exists fecha_cierre timestamptz;

create or replace function public.trg_garantia_venta_cerrar_por_ot()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
BEGIN
  IF NEW.estado = 'entregada' AND OLD.estado IS DISTINCT FROM 'entregada' THEN
    UPDATE garantias_venta
       SET estado = 'cerrada',
           fecha_cierre = now(),
           cerrado_por = COALESCE(auth.uid(), NEW.tecnico_id)
     WHERE ot_reparacion_id = NEW.id
       AND estado = 'abierta';
  END IF;
  RETURN NULL;
END;
$function$;

drop trigger if exists trg_after_update_orden_cierra_garantia on public.ordenes_servicio;
create trigger trg_after_update_orden_cierra_garantia
  after update of estado on public.ordenes_servicio
  for each row
  execute function public.trg_garantia_venta_cerrar_por_ot();
