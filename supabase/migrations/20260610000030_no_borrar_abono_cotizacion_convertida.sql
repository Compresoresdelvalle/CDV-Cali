-- MEDIO (auditoría 2026-06-09): fn_eliminar_abono_cotizacion solo verificaba rol
-- Admin y hacía DELETE, SIN comprobar si la cotización ya fue convertida en venta
-- (venta_id NOT NULL). Como la reconciliación de la venta lee en vivo de
-- abonos_cotizacion por venta_id, borrar un abono de una cotización ya convertida
-- cambia retroactivamente el saldo/crédito de una venta cerrada, sin rastro
-- (abonos_cotizacion permite DELETE real). La política de DELETE directo tenía el
-- mismo hueco (solo exigía rol Admin).
--
-- Fix: (1) la función rechaza el borrado si la cotización tiene venta_id; (2) la
-- política abonos_cotizacion_delete también exige que la cotización NO esté
-- convertida, cerrando el camino REST directo.

create or replace function public.fn_eliminar_abono_cotizacion(p_abono_id bigint)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_venta_id uuid;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text into v_rol from usuarios where id = v_uid;
  if v_rol <> 'Admin' then
    raise exception 'Solo un Admin puede eliminar abonos';
  end if;

  select c.venta_id into v_venta_id
    from abonos_cotizacion a
    join cotizaciones c on c.id = a.cotizacion_id
   where a.id = p_abono_id;
  if not found then raise exception 'Abono no encontrado'; end if;
  if v_venta_id is not null then
    raise exception 'No se puede eliminar un abono de una cotización ya convertida en venta (afectaría el saldo de la venta)';
  end if;

  delete from abonos_cotizacion where id = p_abono_id;
end;
$function$;

-- Endurecer el DELETE directo: Admin Y cotización no convertida.
drop policy if exists abonos_cotizacion_delete on public.abonos_cotizacion;
create policy abonos_cotizacion_delete on public.abonos_cotizacion
  for delete to authenticated
  using (
    (select get_my_rol()) = 'Admin'
    and not exists (
      select 1 from cotizaciones c
      where c.id = abonos_cotizacion.cotizacion_id
        and c.venta_id is not null
    )
  );
