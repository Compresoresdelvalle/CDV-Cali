-- S6: al CERRAR una garantía de compra (reposición recibida completa), la compra vuelve a
-- 'completada' si no le quedan otras devoluciones en curso (estado no anulada/cerrada).
-- Se alinea el mismo criterio en la anulación (excluir también 'cerrada').

CREATE OR REPLACE FUNCTION public.fn_marcar_reposicion_recibida(p_garantia_id uuid, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT;
  v_garantia RECORD; v_det RECORD; v_item JSONB;
  v_total INT; v_recibidos INT;
  v_stock_ant INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol NOT IN ('Admin','Bodeguero') THEN
    RAISE EXCEPTION 'No tienes permiso';
  END IF;

  SELECT * INTO v_garantia FROM garantias_compra WHERE id = p_garantia_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Garantía no encontrada'; END IF;
  IF v_garantia.estado NOT IN ('reposicion_pendiente','reposicion_recibida') THEN
    RAISE EXCEPTION 'Solo se puede recibir reposición en estado reposicion_pendiente';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_det FROM detalle_garantia_compra
      WHERE id = (v_item->>'detalle_id')::BIGINT AND garantia_id = p_garantia_id;
    IF NOT FOUND OR v_det.reposicion_recibida_at IS NOT NULL THEN CONTINUE; END IF;

    UPDATE detalle_garantia_compra
       SET reposicion_recibida_at = now(), reposicion_recibida_por = v_uid
     WHERE id = v_det.id;

    SELECT COALESCE(cantidad,0) INTO v_stock_ant
      FROM inventario WHERE producto_id=v_det.producto_id AND sede_id=v_det.sede_id
      FOR UPDATE;
    INSERT INTO inventario (producto_id, sede_id, cantidad)
    VALUES (v_det.producto_id, v_det.sede_id, v_det.cantidad)
    ON CONFLICT (producto_id, sede_id) DO UPDATE
      SET cantidad = inventario.cantidad + v_det.cantidad,
          ultimo_movimiento = now(), updated_at = now();

    INSERT INTO movimientos (
      tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, observaciones
    ) VALUES (
      'garantia_entrada', v_det.producto_id, v_det.sede_id, v_det.cantidad,
      v_stock_ant, v_stock_ant + v_det.cantidad,
      p_garantia_id, 'garantia_compra', v_uid,
      'Reposición de garantía recibida del proveedor'
    );

    PERFORM fn_actualizar_estado_stock(v_det.producto_id, v_det.sede_id);
  END LOOP;

  SELECT count(*) INTO v_total FROM detalle_garantia_compra WHERE garantia_id = p_garantia_id;
  SELECT count(*) INTO v_recibidos FROM detalle_garantia_compra
    WHERE garantia_id = p_garantia_id AND reposicion_recibida_at IS NOT NULL;
  IF v_total = v_recibidos AND v_total > 0 THEN
    UPDATE garantias_compra
       SET estado = 'cerrada', cerrado_por = v_uid, fecha_cierre = now()
     WHERE id = p_garantia_id;

    -- S6: al cerrar la garantía, la compra vuelve a 'completada' si no le quedan
    -- otras devoluciones en curso (estado no anulada/cerrada). Mismo criterio que la anulación.
    IF NOT EXISTS (
         SELECT 1 FROM garantias_compra
          WHERE compra_id = v_garantia.compra_id
            AND id <> p_garantia_id
            AND estado NOT IN ('anulada','cerrada')
       )
       AND EXISTS (SELECT 1 FROM compras WHERE id = v_garantia.compra_id AND estado = 'devolucion_garantia') THEN
      PERFORM set_config('cdv.compra_admin','on',true);
      UPDATE compras SET estado = 'completada' WHERE id = v_garantia.compra_id;
      PERFORM set_config('cdv.compra_admin','',true);
    END IF;
  ELSIF v_recibidos > 0 AND v_garantia.estado <> 'reposicion_recibida' THEN
    UPDATE garantias_compra
       SET estado = 'reposicion_recibida'
     WHERE id = p_garantia_id;
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_anular_garantia_compra(p_garantia_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_gar record;
  v_nota record;
  v_det record;
  v_stock_ant int;
  v_stock_post int;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text into v_rol from usuarios where id = v_uid;
  if v_rol <> 'Admin' then raise exception 'Solo un Admin puede anular garantías'; end if;

  select * into v_gar from garantias_compra where id = p_garantia_id for update;
  if not found then raise exception 'Garantía de compra no encontrada'; end if;
  if v_gar.estado = 'anulada' then raise exception 'La garantía ya está anulada'; end if;

  select * into v_nota from notas_credito_proveedor where garantia_compra_id = p_garantia_id for update;
  if found then
    if v_nota.saldo_restante is distinct from v_nota.monto then
      raise exception 'No se puede anular: la nota de crédito #% ya fue consumida (saldo % de %). Revierte los consumos primero.',
        v_nota.numero, v_nota.saldo_restante, v_nota.monto;
    end if;
    update notas_credito_proveedor
       set saldo_restante = 0,
           observaciones = coalesce(nullif(trim(coalesce(observaciones,'')),'') || ' | ', '') || 'ANULADA por reversa de garantía'
     where id = v_nota.id;
  end if;

  for v_det in
    select * from detalle_garantia_compra where garantia_id = p_garantia_id order by id
  loop
    if v_det.destino = 'insumo' then
      select coalesce(cantidad_insumo,0) into v_stock_ant
        from inventario where producto_id = v_det.producto_id and sede_id = v_det.sede_id for update;
      v_stock_ant := coalesce(v_stock_ant, 0);
      v_stock_post := v_stock_ant + v_det.cantidad;
      update inventario set cantidad_insumo = v_stock_post, ultimo_movimiento = now(), updated_at = now()
       where producto_id = v_det.producto_id and sede_id = v_det.sede_id;
      insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, observaciones)
      values ('garantia_entrada', v_det.producto_id, v_det.sede_id, v_det.cantidad,
        v_stock_ant, v_stock_post, p_garantia_id, 'garantia_compra', v_uid,
        'Reversa por anulación de garantía (insumo)');
    else
      select coalesce(cantidad,0) into v_stock_ant
        from inventario where producto_id = v_det.producto_id and sede_id = v_det.sede_id for update;
      v_stock_ant := coalesce(v_stock_ant, 0);
      v_stock_post := v_stock_ant + v_det.cantidad;
      update inventario set cantidad = v_stock_post, ultimo_movimiento = now(), updated_at = now()
       where producto_id = v_det.producto_id and sede_id = v_det.sede_id;
      insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, observaciones)
      values ('garantia_entrada', v_det.producto_id, v_det.sede_id, v_det.cantidad,
        v_stock_ant, v_stock_post, p_garantia_id, 'garantia_compra', v_uid,
        'Reversa por anulación de garantía');
    end if;

    if v_det.reposicion_recibida_at is not null then
      select coalesce(cantidad,0) into v_stock_ant
        from inventario where producto_id = v_det.producto_id and sede_id = v_det.sede_id for update;
      v_stock_ant := coalesce(v_stock_ant, 0);
      if v_stock_ant < v_det.cantidad then
        raise exception 'No se puede anular: la reposición recibida (% uds en %) ya no está disponible (stock %).',
          v_det.cantidad, v_det.sede_id, v_stock_ant;
      end if;
      v_stock_post := v_stock_ant - v_det.cantidad;
      update inventario set cantidad = v_stock_post, ultimo_movimiento = now(), updated_at = now()
       where producto_id = v_det.producto_id and sede_id = v_det.sede_id;
      insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, observaciones)
      values ('garantia_salida', v_det.producto_id, v_det.sede_id, -v_det.cantidad,
        v_stock_ant, v_stock_post, p_garantia_id, 'garantia_compra', v_uid,
        'Reversa por anulación de garantía (retiro de reposición)');
    end if;

    perform fn_actualizar_estado_stock(v_det.producto_id, v_det.sede_id);
  end loop;

  update garantias_compra
     set estado = 'anulada',
         motivo = coalesce(nullif(trim(coalesce(motivo,'')),'') || ' | ', '') ||
                  case when nullif(trim(coalesce(p_motivo,'')),'') is not null
                       then 'ANULADA: ' || trim(p_motivo)
                       else 'ANULADA' end
   where id = p_garantia_id;

  -- S6: revertir estado de la compra si no quedan garantías en curso (excluye anulada y cerrada)
  if not exists (
       select 1 from garantias_compra
        where compra_id = v_gar.compra_id and id <> p_garantia_id and estado not in ('anulada','cerrada')
     )
     and exists (select 1 from compras where id = v_gar.compra_id and estado = 'devolucion_garantia') then
    perform set_config('cdv.compra_admin','on',true);
    update compras set estado = 'completada' where id = v_gar.compra_id;
    perform set_config('cdv.compra_admin','',true);
  end if;
end;
$function$;
