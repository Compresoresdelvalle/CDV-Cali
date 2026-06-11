-- MEDIO (auditoría 2026-06-09, M10): no existía reversa/anulación de garantías. Si
-- se abría una garantía de venta por error (resolución equivocada, producto/cantidad
-- incorrectos, duplicada), quedaba inventario descontado/ingresado de forma
-- permanente (movimientos es append-only) sin vía de recuperación por la app.
--
-- DECISIÓN CLIENTE: implementar la reversa (anulación).
--
-- fn_anular_garantia_venta (solo Admin): compensa con movimientos NUEVOS (nunca toca
-- el ledger append-only):
--   * cambiar_pieza  -> reingresa al stock las piezas entregadas (garantia_salida → +).
--   * items_devueltos -> retira la chatarra ingresada (garantia_entrada → −), validando
--                        que siga disponible (si se consumió, aborta).
--   * arreglar_producto -> cancela la OT de reparación si no está entregada/cancelada
--                        (fn_cancelar_orden restaura repuestos).
--   * devolver_dinero -> sin stock; solo marca anulada (el reintegro de caja es externo).
-- Marca la garantía estado='anulada' (enum agregado en migr 36) con el motivo.
-- La reversa de garantías de COMPRA (nota de crédito) va en una migración aparte.

create or replace function public.fn_anular_garantia_venta(p_garantia_id uuid, p_motivo text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_gar record;
  v_mov record;
  v_stock_ant int;
  v_stock_post int;
  v_ot_estado text;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text into v_rol from usuarios where id = v_uid;
  if v_rol <> 'Admin' then raise exception 'Solo un Admin puede anular garantías'; end if;

  select * into v_gar from garantias_venta where id = p_garantia_id for update;
  if not found then raise exception 'Garantía de venta no encontrada'; end if;
  if v_gar.estado = 'anulada' then raise exception 'La garantía ya está anulada'; end if;

  -- 1) Reversa de los movimientos de stock de esta garantía.
  for v_mov in
    select * from movimientos
     where referencia_id = p_garantia_id and referencia_tipo = 'garantia_venta'
       and tipo in ('garantia_salida','garantia_entrada')
     order by id
  loop
    select coalesce(cantidad,0) into v_stock_ant
      from inventario where producto_id = v_mov.producto_id and sede_id = v_mov.sede_id for update;
    v_stock_ant := coalesce(v_stock_ant, 0);

    if v_mov.tipo = 'garantia_salida' then
      -- salió stock (cantidad < 0) -> devolver +abs
      v_stock_post := v_stock_ant + abs(v_mov.cantidad);
      update inventario set cantidad = v_stock_post, ultimo_movimiento = now(), updated_at = now()
       where producto_id = v_mov.producto_id and sede_id = v_mov.sede_id;
      insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, observaciones)
      values ('garantia_entrada', v_mov.producto_id, v_mov.sede_id, abs(v_mov.cantidad),
        v_stock_ant, v_stock_post, p_garantia_id, 'garantia_venta', v_uid,
        'Reversa por anulación de garantía');
    else
      -- entró stock (chatarra, cantidad > 0) -> retirar -cant, validando disponibilidad
      if v_stock_ant < v_mov.cantidad then
        raise exception 'No se puede anular: la chatarra ingresada (% uds en %) ya no está disponible (stock %).',
          v_mov.cantidad, v_mov.sede_id, v_stock_ant;
      end if;
      v_stock_post := v_stock_ant - v_mov.cantidad;
      update inventario set cantidad = v_stock_post, ultimo_movimiento = now(), updated_at = now()
       where producto_id = v_mov.producto_id and sede_id = v_mov.sede_id;
      insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, observaciones)
      values ('garantia_salida', v_mov.producto_id, v_mov.sede_id, -v_mov.cantidad,
        v_stock_ant, v_stock_post, p_garantia_id, 'garantia_venta', v_uid,
        'Reversa por anulación de garantía (retiro de chatarra)');
    end if;
    perform fn_actualizar_estado_stock(v_mov.producto_id, v_mov.sede_id);
  end loop;

  -- 2) arreglar_producto: cancelar la OT de reparación si aún no está entregada/cancelada.
  if v_gar.ot_reparacion_id is not null then
    select estado::text into v_ot_estado from ordenes_servicio where id = v_gar.ot_reparacion_id;
    if v_ot_estado is not null and v_ot_estado not in ('entregada','cancelada') then
      perform fn_cancelar_orden(v_gar.ot_reparacion_id);
    end if;
  end if;

  -- 3) Marcar anulada con el motivo.
  update garantias_venta
     set estado = 'anulada',
         motivo = coalesce(nullif(trim(coalesce(motivo,'')),'') || ' | ', '') ||
                  case when nullif(trim(coalesce(p_motivo,'')),'') is not null
                       then 'ANULADA: ' || trim(p_motivo)
                       else 'ANULADA' end
   where id = p_garantia_id;
end;
$function$;
