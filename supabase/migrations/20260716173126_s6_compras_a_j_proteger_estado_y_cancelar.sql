-- S6-A + S6-J: bloquear UPDATE directo de compras.estado/fecha/registrado_por (bypass vía GUC cdv.compra_admin)
-- S6-G + S6-10: fn_cancelar_compra anula pagos_cuenta y recalcula productos_proveedores

CREATE OR REPLACE FUNCTION public.trg_compra_proteger_materiales()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.estado = 'cancelada' and new.estado is distinct from 'cancelada' then
    raise exception 'No se puede reactivar una compra cancelada';
  end if;

  -- S6-A/S6-J: las RPCs legítimas (fn_cancelar_compra, fn_abrir/anular_garantia_compra,
  -- fn_recibir_compra) activan cdv.compra_admin para sus UPDATE internos.
  if coalesce(current_setting('cdv.compra_admin', true), '') = 'on' then
    return new;
  end if;

  if new.estado is distinct from old.estado
     or new.fecha is distinct from old.fecha
     or new.registrado_por is distinct from old.registrado_por then
    raise exception 'No se pueden modificar estado, fecha ni registrado_por de una compra directamente; usa las funciones del sistema';
  end if;

  if new.sede_destino_id    is distinct from old.sede_destino_id
     or new.subtotal          is distinct from old.subtotal
     or new.iva               is distinct from old.iva
     or new.iva_pct           is distinct from old.iva_pct
     or new.total             is distinct from old.total
     or new.descuento_valor   is distinct from old.descuento_valor
     or new.proveedor         is distinct from old.proveedor
     or new.factura_proveedor is distinct from old.factura_proveedor
     or new.metodo_pago       is distinct from old.metodo_pago
     or new.cuenta_bancaria   is distinct from old.cuenta_bancaria
     or new.concepto          is distinct from old.concepto
     or new.es_caja_menor     is distinct from old.es_caja_menor then
    raise exception 'No se pueden modificar los datos materiales (sede, importes, proveedor, factura, método de pago) de una compra ya registrada';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_cancelar_compra(p_compra_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rol             text;
  v_estado          estado_compra;
  v_recibida        boolean;
  v_sede            text;
  v_proveedor       text;
  v_prov_norm       text;
  v_det             record;
  v_stock_ant       integer;
  v_stock_insumo_ant integer;
  v_disp            integer;
  v_new             integer;
  v_ult_at          timestamptz;
  v_ult_costo       numeric;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select get_my_rol() into v_rol;
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo el administrador puede cancelar compras';
  end if;

  select estado, recibida, sede_destino_id, proveedor
    into v_estado, v_recibida, v_sede, v_proveedor
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

  -- S6-G: anular pagos de CxP de esta compra (soft, espeja fn_anular_venta)
  update pagos_cuenta
     set anulado = true, anulado_por = auth.uid(), anulado_en = now(),
         motivo_anulacion = 'Compra cancelada'
   where compra_id = p_compra_id and tipo = 'pago' and coalesce(anulado, false) = false;

  perform set_config('cdv.compra_admin', 'on', true);
  update compras set estado = 'cancelada' where id = p_compra_id;
  perform set_config('cdv.compra_admin', '', true);

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

    -- S6-10/COMP-04: recalcular productos_proveedores desde la última compra recibida no cancelada
    v_prov_norm := coalesce(nullif(trim(coalesce(v_proveedor,'')), ''), 'Sin proveedor');
    for v_det in select distinct producto_id from detalle_compra where compra_id = p_compra_id loop
      select c.fecha_recepcion, dc.costo_unitario
        into v_ult_at, v_ult_costo
        from detalle_compra dc
        join compras c on c.id = dc.compra_id
       where dc.producto_id = v_det.producto_id
         and coalesce(nullif(trim(coalesce(c.proveedor,'')), ''), 'Sin proveedor') = v_prov_norm
         and c.recibida = true
         and c.estado <> 'cancelada'
         and c.id <> p_compra_id
       order by c.fecha_recepcion desc nulls last, c.created_at desc
       limit 1;
      if found then
        update productos_proveedores
           set ultima_compra_at = v_ult_at, ultimo_costo = v_ult_costo
         where producto_id = v_det.producto_id and proveedor = v_prov_norm;
      else
        delete from productos_proveedores
         where producto_id = v_det.producto_id and proveedor = v_prov_norm;
      end if;
    end loop;
  end if;
end; $function$;
