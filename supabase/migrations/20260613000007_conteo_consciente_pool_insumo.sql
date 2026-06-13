-- Paso 7 — LEDGER-01 (ALTA): conteo cíclico consciente del pool de insumo
--
-- Problema: fn_registrar_conteo leía inventario.cantidad (stock VENDIBLE) y
-- fn_aplicar_ajuste_conteo ajustaba cantidad. Para un producto INSUMO (vendible=false) el
-- stock real vive en cantidad_insumo, no en cantidad (que suele ser 0). Contar discos insumo
-- registraba stock_sistema=0 y, al aplicar, ponía cantidad=stock_fisico → stock VENDIBLE
-- fantasma de la nada (ocurrió en producción: ~293 discos). El pool de insumo quedaba sin tocar.
--
-- Fix: ambas RPC eligen el pool según productos.vendible:
--   vendible=false (insumo) → leen/ajustan cantidad_insumo
--   vendible=true/NULL      → leen/ajustan cantidad (comportamiento previo)
-- El conteo de insumo pendiente que exista (registrado con la lógica vieja sobre `cantidad`)
-- fallará de forma SEGURA el chequeo anti-race al aplicarse (stock_sistema viejo != pool real)
-- y deberá re-registrarse; nunca corrompe.

-- ── fn_registrar_conteo: leer el pool correcto como stock_sistema ─────────────────
create or replace function public.fn_registrar_conteo(p_producto_id uuid, p_stock_fisico integer, p_observaciones text DEFAULT NULL::text, p_sede_id text DEFAULT NULL::text)
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
    raise exception 'Este producto no tiene inventario en la sede %', v_sede;
  end if;

  -- Conteo consciente del pool: insumo cuenta contra cantidad_insumo.
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

-- ── fn_aplicar_ajuste_conteo: ajustar el pool correcto ────────────────────────────
create or replace function public.fn_aplicar_ajuste_conteo(p_conteo_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_conteo conteos%rowtype;
  v_rol text;
  v_uid uuid := auth.uid();
  v_vendible boolean;
  v_stock_actual integer;
  v_cantidad integer;
begin
  select rol::text into v_rol from usuarios where id = v_uid;
  if v_rol <> 'Admin' then raise exception 'Solo Admin puede aplicar ajustes de conteo'; end if;

  select * into v_conteo from conteos where id = p_conteo_id for update;
  if not found then raise exception 'Conteo no encontrado'; end if;
  if v_conteo.ajuste_aplicado then raise exception 'Este conteo ya fue ajustado'; end if;
  if v_conteo.stock_fisico is null then raise exception 'stock_fisico es NULL — conteo corrupto'; end if;

  select vendible into v_vendible from productos where id = v_conteo.producto_id;

  if v_vendible = false then
    select coalesce(cantidad_insumo, 0) into v_stock_actual from inventario
     where producto_id = v_conteo.producto_id and sede_id = v_conteo.sede_id for update;
  else
    select coalesce(cantidad, 0) into v_stock_actual from inventario
     where producto_id = v_conteo.producto_id and sede_id = v_conteo.sede_id for update;
  end if;
  v_stock_actual := coalesce(v_stock_actual, 0);

  if v_stock_actual <> v_conteo.stock_sistema then
    raise exception 'El stock cambió desde que se registró el conteo (sistema=%, actual=%). Vuelve a registrar el conteo antes de aplicar el ajuste.',
      v_conteo.stock_sistema, v_stock_actual;
  end if;

  v_cantidad := v_conteo.stock_fisico - v_stock_actual;

  if v_vendible = false then
    update inventario set cantidad_insumo = v_conteo.stock_fisico,
      ultimo_movimiento = now(), updated_at = now()
     where producto_id = v_conteo.producto_id and sede_id = v_conteo.sede_id;
  else
    update inventario set cantidad = v_conteo.stock_fisico,
      ultimo_movimiento = now(), updated_at = now()
     where producto_id = v_conteo.producto_id and sede_id = v_conteo.sede_id;
  end if;

  insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id, observaciones)
  values ('conteo_ajuste', v_conteo.producto_id, v_conteo.sede_id, v_cantidad,
    v_stock_actual, v_conteo.stock_fisico, v_conteo.id, 'conteo', v_uid,
    case when v_vendible = false then 'Ajuste de conteo cíclico (pool insumo)' else 'Ajuste de conteo cíclico' end);

  update conteos set ajuste_aplicado = true, aprobado_por = v_uid where id = p_conteo_id;
  perform fn_actualizar_estado_stock(v_conteo.producto_id, v_conteo.sede_id);
  return jsonb_build_object('ok', true, 'diferencia', v_cantidad,
    'stock_anterior', v_stock_actual, 'stock_posterior', v_conteo.stock_fisico);
end;
$function$;
