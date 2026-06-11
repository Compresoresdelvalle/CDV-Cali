-- MEDIO (auditoría 2026-06-09, M5): al RECIBIR una compra, trg_compra_sumar_stock
-- recalcula productos.costo_promedio (promedio móvil ponderado). Pero
-- fn_cancelar_compra revierte el stock y NO recalcula costo_promedio, dejándolo
-- "pegado" al valor que incluyó la compra ya revertida → distorsiona márgenes y
-- valuación.
--
-- La reversa EXACTA del promedio móvil es imposible sin el snapshot previo (no se
-- persiste). Fix recomendado por la auditoría: tras cancelar una compra RECIBIDA,
-- recomputar costo_promedio de cada producto afectado como el promedio ponderado de
-- las compras recibidas NO canceladas restantes (excluye la recién cancelada). Si no
-- quedan compras recibidas para el producto, se conserva el valor actual (no se pone
-- 0/NULL). Solo aplica cuando la compra estaba recibida (si no, nunca afectó el costo).

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
  select get_my_rol() into v_rol;
  if v_rol <> 'Admin' then
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

  -- Recalcular costo_promedio de los productos afectados (solo si la compra estaba
  -- recibida): promedio ponderado de las compras recibidas no canceladas restantes.
  -- La compra ya quedó 'cancelada', así que se autoexcluye del recálculo.
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
