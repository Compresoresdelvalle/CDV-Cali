-- Añade `cantidad_insumo` al retorno de fn_devolver_herramientas_lote para que la
-- UI pueda decir cuánto quedó en el stock de insumo tras devolver N unidades
-- (antes solo lo devolvía la función de una unidad). Sin cambios de lógica.
create or replace function public.fn_devolver_herramientas_lote(p_herramienta_id uuid, p_cantidad integer default 1)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid(); v_anchor herramientas_prestamo;
  v_ids uuid[]; v_id uuid; v_n int; v_insumo int;
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

  foreach v_id in array v_ids loop
    perform fn_devolver_herramienta(v_id);
  end loop;

  if v_anchor.producto_id is not null then
    select cantidad_insumo into v_insumo from inventario
     where producto_id = v_anchor.producto_id and sede_id = v_anchor.sede_id;
  end if;

  return jsonb_build_object('ok', true, 'devueltas', v_n, 'solicitadas', p_cantidad,
                            'inventariable', v_anchor.producto_id is not null,
                            'cantidad_insumo', v_insumo);
end;
$function$;
