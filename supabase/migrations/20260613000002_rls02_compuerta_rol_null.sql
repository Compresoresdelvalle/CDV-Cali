-- Paso 1b — RLS-02 / RLS-03 (CRÍTICA): compuerta de rol que falla abierta con rol NULL
--
-- Problema: las compuertas usaban `if get_my_rol() <> 'Admin' then raise`. En plpgsql
-- `NULL <> 'Admin'` evalúa a NULL y `if NULL then` NO ejecuta el raise. get_my_rol() es
-- NULL para `anon` (y para un autenticado sin fila en `usuarios`), así que la compuerta se
-- saltaba: probado end-to-end (rol anon, ROLLBACK) que fn_cancelar_orden cambiaba una OT
-- real de 'abierta' a 'cancelada'. fn_anular_venta y fn_cancelar_compra comparten el patrón.
-- Además las 3 funciones tenían EXECUTE concedido a `anon`.
--
-- Fix (doble cinturón):
--   1. Guard `if auth.uid() is null then raise` al inicio (rechaza no autenticados).
--   2. Compuerta `is distinct from 'Admin'` (NULL is distinct from 'Admin' = TRUE → raise),
--      lo que también bloquea al autenticado sin rol.
--   3. REVOKE EXECUTE ... FROM anon, public (authenticated/service_role conservan EXECUTE).
-- El resto del cuerpo de cada función queda idéntico.

-- ── fn_cancelar_orden ──────────────────────────────────────────────────────────
create or replace function public.fn_cancelar_orden(p_orden_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_rol    text;
  v_estado estado_orden;
  v_abonos numeric;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select get_my_rol() into v_rol;
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo el administrador puede cancelar órdenes de trabajo';
  end if;

  select estado into v_estado from ordenes_servicio where id = p_orden_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if v_estado = 'entregada' then raise exception 'No se puede cancelar una OT ya entregada'; end if;
  if v_estado = 'cancelada' then raise exception 'La orden ya está cancelada'; end if;

  v_abonos := coalesce(fn_total_abonos_ot(p_orden_id), 0);
  if v_abonos > 0 then
    raise exception 'No se puede cancelar: la OT tiene abonos registrados por %. Gestiona la devolución del anticipo al cliente antes de cancelar.', v_abonos;
  end if;

  delete from detalle_orden where orden_id = p_orden_id;
  update ordenes_servicio set estado = 'cancelada' where id = p_orden_id;
end; $function$;

-- ── fn_anular_venta ────────────────────────────────────────────────────────────
create or replace function public.fn_anular_venta(p_venta_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_rol        text;
  v_anulada    boolean;
  v_item       detalle_venta%rowtype;
  v_sede_id    text;
  v_stock_ant  integer;
  v_stock_post integer;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select get_my_rol() into v_rol;

  if v_rol is distinct from 'Admin' then
    raise exception 'Solo el administrador puede anular ventas';
  end if;

  select anulada, sede_id into v_anulada, v_sede_id
  from ventas where id = p_venta_id;

  if not found then
    raise exception 'Venta no encontrada';
  end if;

  if v_anulada then
    raise exception 'La venta ya fue anulada anteriormente';
  end if;

  perform set_config('cdv.anulando_venta', 'on', true);
  update ventas set anulada = true where id = p_venta_id;
  perform set_config('cdv.anulando_venta', 'off', true);

  for v_item in
    select * from detalle_venta where venta_id = p_venta_id
  loop
    if v_item.producto_id is null then
      continue;
    end if;

    select cantidad into v_stock_ant
    from inventario
    where producto_id = v_item.producto_id and sede_id = v_sede_id
    for update;

    v_stock_post := coalesce(v_stock_ant, 0) + v_item.cantidad;

    update inventario
       set cantidad   = v_stock_post,
           updated_at = now()
     where producto_id = v_item.producto_id and sede_id = v_sede_id;

    insert into movimientos (
      producto_id, sede_id, tipo, cantidad,
      stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, observaciones
    )
    select
      v_item.producto_id, v_sede_id,
      'ajuste', v_item.cantidad,
      coalesce(v_stock_ant, 0), v_stock_post,
      p_venta_id, 'venta', auth.uid(),
      'Anulación de venta #' || v.numero
    from ventas v where v.id = p_venta_id;

    perform fn_actualizar_estado_stock(v_item.producto_id, v_sede_id);
  end loop;
end;
$function$;

-- ── fn_cancelar_compra ─────────────────────────────────────────────────────────
create or replace function public.fn_cancelar_compra(p_compra_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_rol             text;
  v_estado          estado_compra;
  v_recibida        boolean;
  v_sede            text;
  v_det             record;
  v_stock_ant       integer;
  v_stock_insumo_ant integer;
  v_disp            integer;
  v_new             integer;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select get_my_rol() into v_rol;
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo el administrador puede cancelar compras';
  end if;

  select estado, recibida, sede_destino_id
    into v_estado, v_recibida, v_sede
    from compras where id = p_compra_id for update;
  if not found then raise exception 'Compra no encontrada'; end if;
  if v_estado = 'cancelada' then raise exception 'La compra ya está cancelada'; end if;

  if v_recibida then
    for v_det in select * from detalle_compra where compra_id = p_compra_id loop
      select coalesce(cantidad,0), coalesce(cantidad_insumo,0)
        into v_stock_ant, v_stock_insumo_ant
        from inventario
       where producto_id = v_det.producto_id and sede_id = v_sede
       for update;

      if v_det.destino = 'insumo' then
        v_disp := coalesce(v_stock_insumo_ant,0);
      else
        v_disp := coalesce(v_stock_ant,0);
      end if;

      if v_disp < v_det.cantidad then
        raise exception 'No se puede cancelar: el inventario ya no tiene stock suficiente para revertir el producto % (disponible %, requiere %). Parte de esa compra ya se usó o vendió.',
          v_det.producto_id, v_disp, v_det.cantidad;
      end if;

      if v_det.destino = 'insumo' then
        v_new := v_stock_insumo_ant - v_det.cantidad;
        update inventario
           set cantidad_insumo = v_new, ultimo_movimiento = now(), updated_at = now()
         where producto_id = v_det.producto_id and sede_id = v_sede;
        insert into movimientos (tipo, producto_id, sede_id, cantidad,
          stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
        values ('ajuste', v_det.producto_id, v_sede, -v_det.cantidad,
          v_stock_insumo_ant, v_new, p_compra_id, 'compra', auth.uid(),
          'Cancelación de compra (reversa de insumo)');
      else
        v_new := v_stock_ant - v_det.cantidad;
        update inventario
           set cantidad = v_new, ultimo_movimiento = now(), updated_at = now()
         where producto_id = v_det.producto_id and sede_id = v_sede;
        insert into movimientos (tipo, producto_id, sede_id, cantidad,
          stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
        values ('ajuste', v_det.producto_id, v_sede, -v_det.cantidad,
          v_stock_ant, v_new, p_compra_id, 'compra', auth.uid(),
          'Cancelación de compra (reversa)');
        perform fn_actualizar_estado_stock(v_det.producto_id, v_sede);
      end if;
    end loop;
  end if;

  update compras set estado = 'cancelada' where id = p_compra_id;

  if v_recibida then
    for v_det in select distinct producto_id from detalle_compra where compra_id = p_compra_id loop
      update productos p set
        costo_promedio = coalesce((
          select sum(dc.cantidad * dc.costo_unitario)::numeric / nullif(sum(dc.cantidad), 0)
          from detalle_compra dc
          join compras c on c.id = dc.compra_id
          where dc.producto_id = p.id
            and c.recibida = true
            and c.estado <> 'cancelada'
        ), p.costo_promedio),
        updated_at = now()
      where p.id = v_det.producto_id;
    end loop;
  end if;
end; $function$;

-- ── REVOKE EXECUTE a anon/public (authenticated y service_role conservan acceso) ─
revoke execute on function public.fn_cancelar_orden(uuid)  from anon, public;
revoke execute on function public.fn_anular_venta(uuid)    from anon, public;
revoke execute on function public.fn_cancelar_compra(uuid) from anon, public;
