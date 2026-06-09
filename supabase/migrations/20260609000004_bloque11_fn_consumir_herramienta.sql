-- Bloque 11 — Herramientas: marcar una herramienta PRESTADA como 'consumido'.
-- A diferencia de devolver, NO regresa la unidad al stock de insumo (ya se
-- había descontado al prestar): el consumo la retira definitivamente.
create or replace function public.fn_consumir_herramienta(p_herramienta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_rol  text;
  v_sede text;
  v_h    record;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;

  select * into v_h from herramientas_prestamo
   where id = p_herramienta_id for update;
  if not found then raise exception 'Herramienta no encontrada'; end if;
  if v_h.activo is not true then
    raise exception 'La herramienta ya no está activa';
  end if;
  if v_rol is distinct from 'Admin' and v_h.sede_id is distinct from v_sede then
    raise exception 'No tienes permiso sobre esta herramienta';
  end if;
  if v_h.estado <> 'prestada' then
    raise exception 'Solo se puede consumir una herramienta prestada (estado actual: %)', v_h.estado;
  end if;

  -- Consumir: cierra el préstamo y retira la herramienta SIN regresar stock.
  update herramientas_prestamo
     set estado = 'consumido', estado_prestamo = 'devuelto',
         fecha_devolucion_real = now(), activo = false, updated_at = now()
   where id = p_herramienta_id;

  return jsonb_build_object('herramienta_id', p_herramienta_id, 'estado', 'consumido');
end;
$function$;

grant execute on function public.fn_consumir_herramienta(uuid) to authenticated;
