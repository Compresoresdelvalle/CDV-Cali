-- Bloque 7 (ítem 3) — Generar inventario de SEGUNDA MANO desde una OT.
--
-- Cuando la OT está terminada (completada / pendiente_recogida / entregada), se
-- ofrece crear un producto a partir del equipo de la OT, marcado como
-- `segunda_mano`, y darle stock en una sede. No modifica la OT.

create or replace function public.fn_generar_producto_segunda_ot(
  p_orden_id uuid,
  p_nombre text,
  p_categoria text,
  p_precio numeric,
  p_costo numeric,
  p_cantidad numeric,
  p_sede text default null,
  p_referencia text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_rol       text;
  v_sede      text;
  v_ot        record;
  v_ref       text;
  v_prod_id   uuid;
  v_sede_dest text;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;

  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;

  select id, numero, sede_id, estado::text, equipo_descripcion
    into v_ot from ordenes_servicio where id = p_orden_id;
  if v_ot.id is null then raise exception 'OT no encontrada'; end if;

  if v_rol not in ('Admin', 'Bodeguero', 'Tecnico') then
    raise exception 'No tienes permiso para generar inventario';
  end if;
  if v_rol <> 'Admin' and v_ot.sede_id <> v_sede then
    raise exception 'No puedes generar inventario de una OT de otra sede';
  end if;
  if v_ot.estado not in ('completada', 'pendiente_recogida', 'entregada') then
    raise exception 'Solo desde una OT terminada (estado actual: %)', v_ot.estado;
  end if;
  if p_nombre is null or trim(p_nombre) = '' then
    raise exception 'El nombre del producto es obligatorio';
  end if;
  if p_categoria is null or trim(p_categoria) = '' then
    raise exception 'La categoría es obligatoria';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor a 0';
  end if;
  if coalesce(p_precio, 0) < 0 or coalesce(p_costo, 0) < 0 then
    raise exception 'Precio o costo inválido';
  end if;

  v_sede_dest := coalesce(nullif(trim(p_sede), ''), v_ot.sede_id);

  -- Referencia única: autogenerada si no se entrega; valida colisión si se da.
  v_ref := nullif(trim(p_referencia), '');
  if v_ref is null then
    v_ref := '2DA-OT' || v_ot.numero;
    if exists (select 1 from productos where referencia = v_ref) then
      v_ref := v_ref || '-' || left(replace(gen_random_uuid()::text, '-', ''), 5);
    end if;
  elsif exists (select 1 from productos where referencia = v_ref) then
    raise exception 'Ya existe un producto con la referencia %', v_ref;
  end if;

  insert into productos (
    referencia, nombre, categoria, precio_venta, costo_promedio,
    tipo, vendible, activo, descripcion
  ) values (
    v_ref, trim(p_nombre), upper(trim(p_categoria)),
    coalesce(p_precio, 0), coalesce(p_costo, 0),
    'segunda_mano', true, true,
    'Generado desde OT #' || v_ot.numero
  ) returning id into v_prod_id;

  insert into inventario (producto_id, sede_id, cantidad)
  values (v_prod_id, v_sede_dest, p_cantidad)
  on conflict (producto_id, sede_id)
    do update set cantidad = inventario.cantidad + excluded.cantidad;

  insert into movimientos (
    tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id
  ) values (
    'ajuste', v_prod_id, v_sede_dest, p_cantidad, 0, p_cantidad,
    p_orden_id, 'orden_segunda', v_uid
  );

  perform fn_actualizar_estado_stock(v_prod_id, v_sede_dest);

  return jsonb_build_object(
    'producto_id', v_prod_id, 'referencia', v_ref, 'sede', v_sede_dest
  );
end;
$function$;

grant execute on function public.fn_generar_producto_segunda_ot(
  uuid, text, text, numeric, numeric, numeric, text, text
) to authenticated;
