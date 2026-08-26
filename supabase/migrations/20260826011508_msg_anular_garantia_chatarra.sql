-- El bloqueo de anulación por chatarra ausente decía la causa pero no el
-- producto ni la salida, así que obligaba a ir a buscar de qué pieza hablaba:
--   "la chatarra ingresada (1 uds en CHV) ya no está disponible (stock 0)"
--
-- Ahora nombra el producto y dice qué hacer. Único cambio de la función: el
-- texto del raise y la variable v_prod_nombre que lo alimenta. Toda la lógica
-- de inventario, la cancelación de la OT y los controles quedan intactos.

CREATE OR REPLACE FUNCTION public.fn_anular_garantia_venta(p_garantia_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_gar record;
  v_mov record;
  v_stock_ant int;
  v_stock_post int;
  v_ot_estado text;
  v_prod_nombre text;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text into v_rol from usuarios where id = v_uid;
  if v_rol <> 'Admin' then raise exception 'Solo un Admin puede anular garantías'; end if;

  select * into v_gar from garantias_venta where id = p_garantia_id for update;
  if not found then raise exception 'Garantía de venta no encontrada'; end if;
  if v_gar.estado = 'anulada' then raise exception 'La garantía ya está anulada'; end if;

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
      v_stock_post := v_stock_ant + abs(v_mov.cantidad);
      update inventario set cantidad = v_stock_post, ultimo_movimiento = now(), updated_at = now()
       where producto_id = v_mov.producto_id and sede_id = v_mov.sede_id;
      insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, observaciones)
      values ('garantia_entrada', v_mov.producto_id, v_mov.sede_id, abs(v_mov.cantidad),
        v_stock_ant, v_stock_post, p_garantia_id, 'garantia_venta', v_uid,
        'Reversa por anulación de garantía');
    else
      if v_stock_ant < v_mov.cantidad then
        -- El mensaje anterior decía la causa pero no el producto ni la salida,
        -- así que obligaba a ir a buscar de qué pieza hablaba.
        select nombre into v_prod_nombre from productos where id = v_mov.producto_id;
        raise exception 'No se puede anular: la chatarra de "%" (% ud en %) ya no está en inventario (quedan %). Seguramente ya se devolvió al proveedor o se dio de baja: revisa su historial en Auditoría. Si de verdad hay que anular esta garantía, primero haz un ajuste de entrada de esa pieza.',
          coalesce(v_prod_nombre, v_mov.producto_id::text), v_mov.cantidad, v_mov.sede_id, v_stock_ant;
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

  if v_gar.ot_reparacion_id is not null then
    select estado::text into v_ot_estado from ordenes_servicio where id = v_gar.ot_reparacion_id;
    if v_ot_estado is not null and v_ot_estado not in ('entregada','cancelada') then
      perform fn_cancelar_orden(v_gar.ot_reparacion_id);
    end if;
  end if;

  update garantias_venta
     set estado = 'anulada',
         motivo = coalesce(nullif(trim(coalesce(motivo,'')),'') || ' | ', '') ||
                  case when nullif(trim(coalesce(p_motivo,'')),'') is not null
                       then 'ANULADA: ' || trim(p_motivo)
                       else 'ANULADA' end
   where id = p_garantia_id;
end;
$function$;
