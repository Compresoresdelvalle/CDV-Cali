-- S6: 'nota_credito_emitida' es un estado TERMINAL/resuelto de garantía de compra
-- (la nota crédito ES el cierre). Se trata igual que 'cerrada'/'anulada' en TODO el
-- criterio de "quedan garantías en curso", para que la pestaña Garantía muestre solo
-- devoluciones EN CURSO y ninguna compra quede pegada en 'devolucion_garantia'.
-- Funciones tocadas: fn_abrir_garantia_compra, fn_marcar_reposicion_recibida, fn_anular_garantia_compra.

CREATE OR REPLACE FUNCTION public.fn_abrir_garantia_compra(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT;
  v_my_sede TEXT;
  v_garantia_id UUID;
  v_compra RECORD;
  v_item JSONB;
  v_estado_final estado_garantia_compra;
  v_monto_total NUMERIC := 0;
  v_resolucion resolucion_garantia_compra;
  v_prod UUID; v_cant INT;
  v_stock_ant INT;
  v_comprado INT;
  v_reclamado INT;
  v_restante INT;
  v_take INT;
  v_reclamado_d INT;
  v_dc RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT, sede_id INTO v_rol, v_my_sede FROM usuarios WHERE id = v_uid;
  IF v_rol NOT IN ('Admin','Bodeguero','Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para abrir garantías de compra';
  END IF;

  SELECT * INTO v_compra FROM compras WHERE id = (p_payload->>'compra_id')::UUID;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada'; END IF;
  IF v_compra.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se puede abrir garantía sobre una compra cancelada';
  END IF;
  IF NOT COALESCE(v_compra.recibida, FALSE) THEN
    RAISE EXCEPTION 'Solo se puede abrir garantía sobre compras ya recibidas';
  END IF;
  IF v_rol <> 'Admin' AND v_compra.sede_destino_id IS DISTINCT FROM v_my_sede THEN
    RAISE EXCEPTION 'No puedes abrir una garantía sobre una compra de otra sede';
  END IF;

  v_resolucion := (p_payload->>'resolucion')::resolucion_garantia_compra;
  v_estado_final := CASE v_resolucion
    WHEN 'nota_credito'      THEN 'nota_credito_emitida'
    WHEN 'reposicion_fisica' THEN 'reposicion_pendiente'
    ELSE 'abierta'
  END;

  INSERT INTO garantias_compra (compra_id, resolucion, estado, motivo, registrado_por)
  VALUES (v_compra.id, v_resolucion, v_estado_final,
          NULLIF(TRIM(p_payload->>'motivo'),''), v_uid)
  RETURNING id INTO v_garantia_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    v_prod := (v_item->>'producto_id')::UUID;
    v_cant := (v_item->>'cantidad')::INT;
    IF v_cant IS NULL OR v_cant <= 0 THEN
      RAISE EXCEPTION 'Cantidad de ítem debe ser > 0';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM detalle_compra WHERE compra_id = v_compra.id AND producto_id = v_prod) THEN
      RAISE EXCEPTION 'El producto % no pertenece a la compra %', v_prod, v_compra.id;
    END IF;

    SELECT COALESCE(SUM(cantidad),0) INTO v_comprado
      FROM detalle_compra WHERE compra_id = v_compra.id AND producto_id = v_prod;
    SELECT COALESCE(SUM(dgc.cantidad),0) INTO v_reclamado
      FROM detalle_garantia_compra dgc
      JOIN garantias_compra gc ON gc.id = dgc.garantia_id
     WHERE gc.compra_id = v_compra.id AND dgc.producto_id = v_prod AND gc.estado <> 'anulada';
    IF v_reclamado + v_cant > v_comprado THEN
      RAISE EXCEPTION 'No puedes reclamar % unidad(es) del producto %: comprado=%, ya reclamado en garantías=%, disponible para garantía=%',
        v_cant, v_prod, v_comprado, v_reclamado, GREATEST(v_comprado - v_reclamado, 0);
    END IF;

    v_restante := v_cant;
    FOR v_dc IN
      SELECT destino, SUM(cantidad)::int AS comprado,
             (array_agg(costo_unitario ORDER BY created_at))[1] AS costo
        FROM detalle_compra
       WHERE compra_id = v_compra.id AND producto_id = v_prod
       GROUP BY destino
       ORDER BY SUM(cantidad) DESC, destino
    LOOP
      EXIT WHEN v_restante <= 0;
      SELECT COALESCE(SUM(dgc.cantidad),0) INTO v_reclamado_d
        FROM detalle_garantia_compra dgc
        JOIN garantias_compra gc ON gc.id = dgc.garantia_id
       WHERE gc.compra_id = v_compra.id AND dgc.producto_id = v_prod
         AND dgc.destino = v_dc.destino AND gc.estado <> 'anulada';
      v_take := LEAST(v_restante, GREATEST(v_dc.comprado - v_reclamado_d, 0));
      CONTINUE WHEN v_take <= 0;

      INSERT INTO detalle_garantia_compra (
        garantia_id, producto_id, sede_id, cantidad, costo_unitario, destino
      ) VALUES (
        v_garantia_id, v_prod, v_compra.sede_destino_id, v_take, v_dc.costo, v_dc.destino
      );
      v_monto_total := v_monto_total + v_take * v_dc.costo;

      IF v_dc.destino = 'insumo' THEN
        SELECT COALESCE(cantidad_insumo,0) INTO v_stock_ant
          FROM inventario WHERE producto_id=v_prod AND sede_id=v_compra.sede_destino_id
          FOR UPDATE;
        v_stock_ant := COALESCE(v_stock_ant, 0);
        IF v_stock_ant < v_take THEN
          RAISE EXCEPTION 'Stock de insumo insuficiente del producto % en sede % (stock=%, requerido=%)',
            v_prod, v_compra.sede_destino_id, v_stock_ant, v_take;
        END IF;
        UPDATE inventario SET cantidad_insumo = cantidad_insumo - v_take, ultimo_movimiento = now(), updated_at = now()
         WHERE producto_id=v_prod AND sede_id=v_compra.sede_destino_id;

        INSERT INTO movimientos (
          tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
          referencia_id, referencia_tipo, usuario_id, observaciones
        ) VALUES (
          'garantia_salida', v_prod, v_compra.sede_destino_id, -v_take,
          v_stock_ant, v_stock_ant - v_take,
          v_garantia_id, 'garantia_compra', v_uid,
          'Devolución por garantía al proveedor (insumo)'
        );
      ELSE
        SELECT COALESCE(cantidad,0) INTO v_stock_ant
          FROM inventario WHERE producto_id=v_prod AND sede_id=v_compra.sede_destino_id
          FOR UPDATE;
        v_stock_ant := COALESCE(v_stock_ant, 0);
        IF v_stock_ant < v_take THEN
          RAISE EXCEPTION 'Stock insuficiente del producto % en sede % (stock=%, requerido=%)',
            v_prod, v_compra.sede_destino_id, v_stock_ant, v_take;
        END IF;
        UPDATE inventario SET cantidad = cantidad - v_take, ultimo_movimiento = now(), updated_at = now()
         WHERE producto_id=v_prod AND sede_id=v_compra.sede_destino_id;

        INSERT INTO movimientos (
          tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
          referencia_id, referencia_tipo, usuario_id, observaciones
        ) VALUES (
          'garantia_salida', v_prod, v_compra.sede_destino_id, -v_take,
          v_stock_ant, v_stock_ant - v_take,
          v_garantia_id, 'garantia_compra', v_uid,
          'Devolución por garantía al proveedor'
        );

        PERFORM fn_actualizar_estado_stock(v_prod, v_compra.sede_destino_id);
      END IF;

      v_restante := v_restante - v_take;
    END LOOP;

    IF v_restante > 0 THEN
      RAISE EXCEPTION 'No hay unidades disponibles suficientes para reclamar % del producto % (faltan %)',
        v_cant, v_prod, v_restante;
    END IF;
  END LOOP;

  IF v_resolucion = 'nota_credito' AND v_monto_total > 0 THEN
    INSERT INTO notas_credito_proveedor (
      proveedor, garantia_compra_id, monto, saldo_restante, observaciones, registrado_por
    ) VALUES (
      v_compra.proveedor, v_garantia_id, v_monto_total, v_monto_total,
      'Nota crédito por garantía de compra', v_uid
    );
  END IF;

  -- S6: la compra queda 'devolucion_garantia' solo si le quedan garantías EN CURSO
  -- (estados no terminales: excluye anulada, cerrada y nota_credito_emitida).
  -- La resolución por nota crédito es terminal (la nota ES el cierre): no deja la compra pegada.
  IF v_compra.estado IN ('completada','devolucion_garantia') THEN
    IF EXISTS (
         SELECT 1 FROM garantias_compra
          WHERE compra_id = v_compra.id
            AND estado NOT IN ('anulada','cerrada','nota_credito_emitida')
       ) THEN
      IF v_compra.estado <> 'devolucion_garantia' THEN
        PERFORM set_config('cdv.compra_admin','on',true);
        UPDATE compras SET estado='devolucion_garantia' WHERE id = v_compra.id;
        PERFORM set_config('cdv.compra_admin','',true);
      END IF;
    ELSE
      IF v_compra.estado <> 'completada' THEN
        PERFORM set_config('cdv.compra_admin','on',true);
        UPDATE compras SET estado='completada' WHERE id = v_compra.id;
        PERFORM set_config('cdv.compra_admin','',true);
      END IF;
    END IF;
  END IF;

  RETURN v_garantia_id;
END $function$;

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

    -- S6: al cerrar, la compra vuelve a 'completada' si no le quedan devoluciones en curso
    -- (excluye anulada, cerrada y nota_credito_emitida — todos terminales).
    IF NOT EXISTS (
         SELECT 1 FROM garantias_compra
          WHERE compra_id = v_garantia.compra_id
            AND id <> p_garantia_id
            AND estado NOT IN ('anulada','cerrada','nota_credito_emitida')
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

  -- S6: revertir estado de la compra si no quedan garantías en curso
  -- (excluye anulada, cerrada y nota_credito_emitida — todos terminales).
  if not exists (
       select 1 from garantias_compra
        where compra_id = v_gar.compra_id and id <> p_garantia_id and estado not in ('anulada','cerrada','nota_credito_emitida')
     )
     and exists (select 1 from compras where id = v_gar.compra_id and estado = 'devolucion_garantia') then
    perform set_config('cdv.compra_admin','on',true);
    update compras set estado = 'completada' where id = v_gar.compra_id;
    perform set_config('cdv.compra_admin','',true);
  end if;
end;
$function$;
