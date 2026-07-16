-- FEATURE S6: fn_aplicar_nota_credito — aplica una nota crédito de proveedor como pago
-- de una compra a crédito del mismo proveedor (pagos_cuenta tipo='pago', metodo='Nota crédito').
-- No toca el arqueo de efectivo del cierre (solo cuenta metodo='efectivo').
-- Además fn_cancelar_compra restaura el saldo de notas crédito consumidas contra la compra cancelada.

CREATE OR REPLACE FUNCTION public.fn_aplicar_nota_credito(p_nota_id uuid, p_compra_id uuid, p_monto numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_rol    text;
  v_nota   record;
  v_compra record;
  v_pagos  numeric;
  v_saldo_compra numeric;
  v_monto  numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::text INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol NOT IN ('Admin','Bodeguero','Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para aplicar notas crédito';
  END IF;

  SELECT * INTO v_nota FROM notas_credito_proveedor WHERE id = p_nota_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nota crédito no encontrada'; END IF;
  IF COALESCE(v_nota.saldo_restante, 0) <= 0 THEN
    RAISE EXCEPTION 'La nota crédito #% no tiene saldo disponible', v_nota.numero;
  END IF;

  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada'; END IF;
  IF v_compra.estado = 'cancelada' THEN RAISE EXCEPTION 'La compra está cancelada'; END IF;
  IF v_compra.metodo_pago IS DISTINCT FROM 'Crédito' THEN
    RAISE EXCEPTION 'La nota crédito solo se puede aplicar a compras a crédito';
  END IF;
  IF lower(trim(coalesce(v_nota.proveedor,''))) <> lower(trim(coalesce(v_compra.proveedor,''))) THEN
    RAISE EXCEPTION 'La nota crédito es del proveedor "%" y la compra es de "%"', v_nota.proveedor, v_compra.proveedor;
  END IF;

  SELECT COALESCE(SUM(p.monto),0) INTO v_pagos
    FROM pagos_cuenta p
   WHERE p.compra_id = v_compra.id AND p.tipo = 'pago' AND COALESCE(p.anulado,false) = false;
  v_saldo_compra := COALESCE(v_compra.total,0) - v_pagos;
  IF v_saldo_compra <= 0 THEN
    RAISE EXCEPTION 'La compra #% no tiene saldo pendiente', v_compra.numero;
  END IF;

  v_monto := COALESCE(p_monto, LEAST(v_nota.saldo_restante, v_saldo_compra));
  IF v_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor que 0'; END IF;
  IF v_monto > v_nota.saldo_restante THEN
    RAISE EXCEPTION 'El monto (%) supera el saldo de la nota crédito (%)', v_monto, v_nota.saldo_restante;
  END IF;
  IF v_monto > v_saldo_compra + 0.01 THEN
    RAISE EXCEPTION 'El monto (%) supera el saldo pendiente de la compra (%)', v_monto, v_saldo_compra;
  END IF;

  UPDATE notas_credito_proveedor
     SET saldo_restante = saldo_restante - v_monto
   WHERE id = p_nota_id;

  INSERT INTO notas_credito_consumos (nota_id, compra_id, monto, registrado_por, observaciones)
  VALUES (p_nota_id, p_compra_id, v_monto, v_uid,
          format('Aplicada como pago a compra #%s', v_compra.numero));

  INSERT INTO pagos_cuenta (tipo, compra_id, monto, metodo_pago, cuenta_bancaria, observaciones, registrado_por)
  VALUES ('pago', p_compra_id, v_monto, 'Nota crédito', NULL,
          format('Nota crédito #%s', v_nota.numero), v_uid);

  RETURN jsonb_build_object(
    'nota_id', p_nota_id, 'nota_numero', v_nota.numero,
    'compra_id', p_compra_id, 'compra_numero', v_compra.numero,
    'monto_aplicado', v_monto,
    'saldo_nota_restante', v_nota.saldo_restante - v_monto,
    'saldo_compra_restante', v_saldo_compra - v_monto
  );
END;
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
  v_numero          int;
  v_det             record;
  v_c               record;
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

  select estado, recibida, sede_destino_id, proveedor, numero
    into v_estado, v_recibida, v_sede, v_proveedor, v_numero
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

  -- S6: restaurar el saldo de notas crédito consumidas contra esta compra
  -- (el CHECK de notas_credito_consumos no admite reversas negativas; el rastro
  --  queda en observaciones de la nota y en el pago anulado)
  for v_c in
    select nota_id, sum(monto) as monto
      from notas_credito_consumos
     where compra_id = p_compra_id
     group by nota_id
    having sum(monto) > 0
  loop
    update notas_credito_proveedor
       set saldo_restante = least(monto, saldo_restante + v_c.monto),
           observaciones = coalesce(nullif(trim(coalesce(observaciones,'')),'') || ' | ', '') ||
                           format('Saldo restaurado (+%s) por cancelación de compra #%s', v_c.monto, v_numero)
     where id = v_c.nota_id;
  end loop;

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
