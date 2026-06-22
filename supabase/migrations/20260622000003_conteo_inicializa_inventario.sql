-- ============================================================================
-- Conteo cíclico (Task 6): permitir contar un producto que aún no tiene fila
-- de inventario en la sede. Antes el RPC lanzaba excepción; ahora inicializa la
-- fila en 0 (cantidad y cantidad_insumo) y continúa. El RPC es SECURITY DEFINER
-- y ya valida rol (Admin/Bodeguero) y sede, así que es seguro crearla aquí.
-- ============================================================================

create or replace function public.fn_registrar_conteo(p_producto_id uuid, p_stock_fisico integer, p_observaciones text default null::text, p_sede_id text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_rol     text;
  v_mi_sede text;
  v_sede    text;
  v_inv     record;
  v_vendible boolean;
  v_stock_sistema integer;
  v_conteo_id uuid;
begin
  if v_uid is null then raise exception 'no_session'; end if;
  if p_stock_fisico is null or p_stock_fisico < 0 then raise exception 'Stock físico inválido'; end if;

  select rol::text, sede_id into v_rol, v_mi_sede from usuarios where id = v_uid;
  if v_rol not in ('Admin', 'Bodeguero') then
    raise exception 'Solo Admin o Bodeguero pueden registrar conteos';
  end if;

  if v_rol = 'Admin' then
    v_sede := coalesce(nullif(trim(p_sede_id), ''), v_mi_sede);
  else
    v_sede := v_mi_sede;
  end if;
  if v_sede is null then
    raise exception 'No hay sede para el conteo (selecciona una o asigna sede al usuario)';
  end if;
  if not exists (select 1 from sedes where id = v_sede) then
    raise exception 'La sede % no existe', v_sede;
  end if;

  select vendible into v_vendible from productos where id = p_producto_id;

  select id, coalesce(cantidad, 0) as cantidad, coalesce(cantidad_insumo, 0) as cantidad_insumo
    into v_inv
    from inventario
   where producto_id = p_producto_id and sede_id = v_sede
   for update;
  if not found then
    -- La sede aún no tenía este producto: inicializa la fila en 0 para permitir
    -- el primer conteo. Idempotente ante carreras vía on conflict.
    insert into inventario (producto_id, sede_id, cantidad, cantidad_insumo)
    values (p_producto_id, v_sede, 0, 0)
    on conflict (producto_id, sede_id) do nothing;
    select id, coalesce(cantidad, 0) as cantidad, coalesce(cantidad_insumo, 0) as cantidad_insumo
      into v_inv
      from inventario
     where producto_id = p_producto_id and sede_id = v_sede
     for update;
  end if;

  v_stock_sistema := case when v_vendible = false then v_inv.cantidad_insumo else v_inv.cantidad end;

  insert into conteos (
    inventario_id, producto_id, sede_id,
    stock_sistema, stock_fisico,
    contado_por, observaciones, ajuste_aplicado
  )
  values (
    v_inv.id, p_producto_id, v_sede,
    v_stock_sistema, p_stock_fisico,
    v_uid, nullif(trim(p_observaciones), ''), false
  )
  returning id into v_conteo_id;

  return jsonb_build_object(
    'ok', true,
    'conteo_id', v_conteo_id,
    'sede_id', v_sede,
    'stock_sistema', v_stock_sistema,
    'stock_fisico', p_stock_fisico,
    'diferencia', p_stock_fisico - v_stock_sistema
  );
end;
$function$;
