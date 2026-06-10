-- ALTOS (auditoría 2026-06-09), clúster compras:
--
-- (A) fn_cancelar_compra: al revertir una compra recibida BAJA el inventario
--     (v_new = stock - cantidad) pero insertaba el movimiento con cantidad
--     POSITIVO, rompiendo la convención cantidad = stock_posterior - stock_anterior
--     y la invariante inventario = SUM(movimientos). Fix: cantidad = -v_det.cantidad.
--
-- (B) Se podía RECIBIR (recibida false->true) una compra cancelada: el trigger
--     trg_compra_recibida_inmutable solo bloqueaba recibida true->false, y
--     trg_compra_sumar_stock no verifica estado. Fix: bloquear la transición
--     false->true cuando estado='cancelada' — SIN romper la cancelación de una
--     compra ya recibida (que mantiene recibida=true al pasar a 'cancelada').

-- (A) ---------------------------------------------------------------------
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
end; $function$;

-- (B) ---------------------------------------------------------------------
create or replace function public.trg_compra_recibida_inmutable()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
BEGIN
  IF OLD.recibida = true AND NEW.recibida = false THEN
    RAISE EXCEPTION 'No se puede revertir una compra recibida (intentaría descuadrar stock)';
  END IF;
  -- Bloquear RECIBIR (false->true) una compra cancelada. La condición
  -- COALESCE(OLD.recibida,false)=false asegura que solo aplica a la transición
  -- de recepción, no a cancelar una compra que ya estaba recibida.
  IF NEW.recibida = true AND COALESCE(OLD.recibida, false) = false AND NEW.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se puede recibir una compra cancelada';
  END IF;
  RETURN NEW;
END;
$function$;
