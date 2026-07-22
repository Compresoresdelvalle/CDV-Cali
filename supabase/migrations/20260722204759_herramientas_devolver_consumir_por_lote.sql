-- Devolución y consumo de herramientas POR CANTIDAD.
--
-- Contexto: `herramientas_prestamo` guarda UNA FILA POR UNIDAD FÍSICA. Al prestar
-- 5 unidades del mismo producto (fn_prestar_herramientas_lote) quedan 5 filas
-- 'prestada', y la UI pintaba 5 tarjetas separadas. Además solo existían
-- fn_devolver_herramienta / fn_consumir_herramienta, de UNA unidad, así que no
-- había forma de devolver 2 y consumir 3 del mismo préstamo.
--
-- Estas funciones reciben una unidad "ancla" + cantidad, resuelven las N unidades
-- hermanas del MISMO préstamo y delegan en las funciones de una unidad que ya
-- existen y están probadas. Con eso:
--   · No se duplica lógica (permisos, insumo, movimientos e historial intactos).
--   · Es atómico: o se procesan las N o ninguna (una sola transacción).
--   · El historial sigue con un evento POR UNIDAD (auditoría fina).
--
-- Llave del grupo: mismo producto (o nombre+código si es herramienta manual),
-- misma sede y mismo estado; y si están prestadas, además el mismo responsable y
-- el mismo `fecha_prestamo` — que es idéntico al microsegundo porque el préstamo
-- por lote marca todas las unidades en un solo UPDATE.

create or replace function public.fn_devolver_herramientas_lote(p_herramienta_id uuid, p_cantidad integer default 1)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid(); v_anchor herramientas_prestamo;
  v_ids uuid[]; v_id uuid; v_n int;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  if p_cantidad is null or p_cantidad < 1 then raise exception 'Cantidad inválida'; end if;

  select * into v_anchor from herramientas_prestamo where id = p_herramienta_id for update;
  if not found then raise exception 'Herramienta no encontrada'; end if;
  if v_anchor.activo is not true then raise exception 'La herramienta ya no está activa'; end if;

  select array_agg(id) into v_ids from (
    select hp.id from herramientas_prestamo hp
    where hp.sede_id = v_anchor.sede_id
      and hp.activo = true
      and hp.estado = v_anchor.estado
      and ((v_anchor.producto_id is not null and hp.producto_id = v_anchor.producto_id)
        or (v_anchor.producto_id is null and hp.producto_id is null
            and hp.herramienta_nombre is not distinct from v_anchor.herramienta_nombre
            and hp.herramienta_codigo is not distinct from v_anchor.herramienta_codigo))
      and (v_anchor.estado <> 'prestada'
           or (hp.prestada_a is not distinct from v_anchor.prestada_a
               and hp.fecha_prestamo is not distinct from v_anchor.fecha_prestamo))
    order by (hp.id = p_herramienta_id) desc, hp.created_at
    limit p_cantidad
    for update skip locked
  ) sel;

  v_n := coalesce(array_length(v_ids,1),0);
  if v_n = 0 then raise exception 'No hay unidades de esta herramienta para devolver'; end if;

  -- Delega en la función de UNA unidad: conserva permisos, reingreso a insumo,
  -- movimientos e historial exactamente como estaban.
  foreach v_id in array v_ids loop
    perform fn_devolver_herramienta(v_id);
  end loop;

  return jsonb_build_object('ok', true, 'devueltas', v_n, 'solicitadas', p_cantidad,
                            'inventariable', v_anchor.producto_id is not null);
end;
$function$;

create or replace function public.fn_consumir_herramientas_lote(p_herramienta_id uuid, p_cantidad integer default 1)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid(); v_anchor herramientas_prestamo;
  v_ids uuid[]; v_id uuid; v_n int;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  if p_cantidad is null or p_cantidad < 1 then raise exception 'Cantidad inválida'; end if;

  select * into v_anchor from herramientas_prestamo where id = p_herramienta_id for update;
  if not found then raise exception 'Herramienta no encontrada'; end if;
  if v_anchor.activo is not true then raise exception 'La herramienta ya no está activa'; end if;
  if v_anchor.estado <> 'prestada' then
    raise exception 'Solo se puede consumir una herramienta prestada (estado actual: %)', v_anchor.estado;
  end if;

  select array_agg(id) into v_ids from (
    select hp.id from herramientas_prestamo hp
    where hp.sede_id = v_anchor.sede_id
      and hp.activo = true
      and hp.estado = 'prestada'
      and ((v_anchor.producto_id is not null and hp.producto_id = v_anchor.producto_id)
        or (v_anchor.producto_id is null and hp.producto_id is null
            and hp.herramienta_nombre is not distinct from v_anchor.herramienta_nombre
            and hp.herramienta_codigo is not distinct from v_anchor.herramienta_codigo))
      and hp.prestada_a is not distinct from v_anchor.prestada_a
      and hp.fecha_prestamo is not distinct from v_anchor.fecha_prestamo
    order by (hp.id = p_herramienta_id) desc, hp.created_at
    limit p_cantidad
    for update skip locked
  ) sel;

  v_n := coalesce(array_length(v_ids,1),0);
  if v_n = 0 then raise exception 'No hay unidades prestadas de esta herramienta para consumir'; end if;

  foreach v_id in array v_ids loop
    perform fn_consumir_herramienta(v_id);
  end loop;

  return jsonb_build_object('ok', true, 'consumidas', v_n, 'solicitadas', p_cantidad);
end;
$function$;

revoke all on function public.fn_devolver_herramientas_lote(uuid, integer) from public, anon;
revoke all on function public.fn_consumir_herramientas_lote(uuid, integer) from public, anon;
grant execute on function public.fn_devolver_herramientas_lote(uuid, integer) to authenticated;
grant execute on function public.fn_consumir_herramientas_lote(uuid, integer) to authenticated;
