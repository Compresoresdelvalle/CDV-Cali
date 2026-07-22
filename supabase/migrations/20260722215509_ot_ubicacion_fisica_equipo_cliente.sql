-- Dónde está FÍSICAMENTE el equipo del cliente mientras la OT está abierta.
--
-- Caso real: el cliente abona, deja el compresor y no vuelve. Para no tener el
-- equipo ocupando espacio en el almacén, lo mandan a la Bodega principal, y
-- cuando el cliente aparece se lo devuelven. Hasta ahora no había dónde
-- registrar ese movimiento: `ordenes_servicio.sede_id` es la sede DUEÑA de la
-- orden, no dónde está guardado el equipo.
--
-- Importante: el equipo es del CLIENTE, no es inventario de la empresa. Por eso
-- esto NO usa traspasos (que mueven stock propio y exigen producto con
-- existencias) ni toca inventario ni plata. Es solo custodia.
--
--   sede_equipo_id NULL  → el equipo está en la sede de la orden (lo normal)
--   sede_equipo_id != NULL → está guardado en otra sede, desde equipo_movido_at
--   equipo_ubicacion_nota → dónde exactamente ("estante del fondo")

alter table public.ordenes_servicio
  add column if not exists sede_equipo_id text references sedes(id),
  add column if not exists equipo_movido_at timestamptz,
  add column if not exists equipo_ubicacion_nota text;

comment on column public.ordenes_servicio.sede_equipo_id is
  'Sede donde está guardado físicamente el equipo del cliente. NULL = en la sede de la orden.';

create or replace function public.fn_mover_equipo_orden(
  p_orden_id uuid, p_sede_destino text default null, p_nota text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid(); v_rol text; v_misede text;
  v_o ordenes_servicio; v_antes numeric; v_despues numeric; v_dest text;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text, sede_id into v_rol, v_misede from usuarios where id = v_uid;
  if v_rol not in ('Admin','Bodeguero','Vendedor') then
    raise exception 'No tienes permiso para mover el equipo de una orden';
  end if;

  select * into v_o from ordenes_servicio where id = p_orden_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if v_o.estado in ('entregada','cancelada') then
    raise exception 'La orden #% está % y su equipo ya no está en custodia', v_o.numero, v_o.estado;
  end if;
  -- Quien no es Admin solo opera equipos de su sede (sea la dueña de la orden o
  -- la sede donde el equipo está guardado hoy: así Bodega puede devolverlo).
  if v_rol <> 'Admin'
     and v_misede is distinct from v_o.sede_id
     and v_misede is distinct from coalesce(v_o.sede_equipo_id, v_o.sede_id) then
    raise exception 'No tienes permiso sobre el equipo de esta orden (es de otra sede)';
  end if;

  v_dest := nullif(trim(coalesce(p_sede_destino,'')),'');
  if v_dest is not null and not exists (select 1 from sedes where id = v_dest and activa) then
    raise exception 'Sede destino no válida';
  end if;
  -- Volver a la sede de la orden = "en su sitio": se guarda como NULL.
  if v_dest = v_o.sede_id then v_dest := null; end if;
  if coalesce(v_dest,'') = coalesce(v_o.sede_equipo_id,'') then
    raise exception 'El equipo ya está ahí';
  end if;

  v_antes := v_o.total;
  update ordenes_servicio
     set sede_equipo_id = v_dest,
         equipo_movido_at = case when v_dest is null then null else now() end,
         equipo_ubicacion_nota = case when v_dest is null then null
                                      else nullif(trim(coalesce(p_nota,'')),'') end,
         updated_at = now()
   where id = p_orden_id
   returning total into v_despues;

  -- Guarda dura: el trigger de la OT recalcula totales ante cualquier UPDATE.
  -- Mover un equipo NUNCA puede tocar la plata; si lo hiciera, se aborta.
  if v_despues is distinct from v_antes then
    raise exception 'No se movió el equipo: la orden #% tiene valores descuadrados y su total cambiaría de % a %. Corrige la orden primero.',
      v_o.numero, v_antes, v_despues;
  end if;

  return jsonb_build_object('ok', true, 'orden_id', p_orden_id, 'sede_equipo_id', v_dest,
                            'sede_orden_id', v_o.sede_id, 'en_su_sitio', v_dest is null);
end;
$function$;

revoke all on function public.fn_mover_equipo_orden(uuid, text, text) from public, anon;
grant execute on function public.fn_mover_equipo_orden(uuid, text, text) to authenticated;
