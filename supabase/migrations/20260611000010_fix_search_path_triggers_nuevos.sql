-- Hardening (advisor function_search_path_mutable): dos trigger functions creadas en
-- esta tanda de bajos (migr 02 y 08) quedaron sin `SET search_path` explícito, las dos
-- únicas del proyecto con search_path mutable. Se fijan a 'public','pg_temp' como el
-- resto de funciones del esquema. CREATE OR REPLACE conserva los triggers asociados.

create or replace function public.trg_detalle_orden_bloquear_update_cantidad()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if NEW.cantidad is distinct from OLD.cantidad then
    raise exception 'No se permite editar la cantidad de un repuesto en la OT; elimine la línea y vuelva a agregarla con la cantidad correcta'
      using errcode = 'check_violation';
  end if;
  return NEW;
end $function$;

create or replace function public.trg_ppcl_append_only()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  raise exception 'productos_precio_costo_log es append-only: % no permitido', tg_op;
end $function$;
