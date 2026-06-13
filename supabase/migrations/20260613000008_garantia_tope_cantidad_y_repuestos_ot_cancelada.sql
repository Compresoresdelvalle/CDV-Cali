-- Paso 8 — GARANTIAS-01 (ALTA) + ORDENES-04 (MEDIA)
--
-- GARANTIAS-01: fn_abrir_garantia_compra valida que el producto pertenezca a la compra,
--   que cantidad>0 y que haya stock, pero NO valida que la cantidad reclamada no supere la
--   comprada → sobre-reclamo y nota de crédito inflada (feature hoy sin uso: 0 garantías).
--   Fix: por cada ítem, exigir reclamado_previo (garantías no anuladas) + cantidad <= comprado.
--
-- ORDENES-04: la policy do_write de detalle_orden excluía solo 'entregada', no 'cancelada'
--   → se podían agregar/editar/borrar repuestos de una OT cancelada por REST. Fix: excluir
--   también 'cancelada'. (fn_cancelar_orden es SECURITY DEFINER y borra el detalle ANTES de
--   marcar cancelada, así que no se ve afectada.)

-- ── GARANTIAS-01 ─────────────────────────────────────────────────────────────────
create or replace function public.fn_abrir_garantia_compra(p_payload jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
  v_costo NUMERIC;
  v_stock_ant INT;
  v_comprado INT;
  v_reclamado INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT, sede_id INTO v_rol, v_my_sede FROM usuarios WHERE id = v_uid;
  IF v_rol NOT IN ('Admin','Bodeguero') THEN
    RAISE EXCEPTION 'No tienes permiso para abrir garantías de compra';
  END IF;

  SELECT * INTO v_compra FROM compras WHERE id = (p_payload->>'compra_id')::UUID;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada'; END IF;
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

    -- Costo server-authoritative: del detalle de la compra, no del cliente.
    -- Valida de paso que el producto pertenezca a la compra.
    SELECT costo_unitario INTO v_costo
      FROM detalle_compra
     WHERE compra_id = v_compra.id AND producto_id = v_prod
     LIMIT 1;
    IF v_costo IS NULL THEN
      RAISE EXCEPTION 'El producto % no pertenece a la compra %', v_prod, v_compra.id;
    END IF;

    -- GARANTIAS-01: no reclamar más de lo comprado (descontando garantías previas no anuladas).
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

    INSERT INTO detalle_garantia_compra (
      garantia_id, producto_id, sede_id, cantidad, costo_unitario
    ) VALUES (
      v_garantia_id, v_prod, v_compra.sede_destino_id, v_cant, v_costo
    );
    v_monto_total := v_monto_total + v_cant * v_costo;

    -- Lock + leer stock + restar
    SELECT COALESCE(cantidad,0) INTO v_stock_ant
      FROM inventario WHERE producto_id=v_prod AND sede_id=v_compra.sede_destino_id
      FOR UPDATE;
    IF v_stock_ant < v_cant THEN
      RAISE EXCEPTION 'Stock insuficiente del producto % en sede % (stock=%, requerido=%)',
        v_prod, v_compra.sede_destino_id, v_stock_ant, v_cant;
    END IF;
    UPDATE inventario SET cantidad = cantidad - v_cant, ultimo_movimiento = now(), updated_at = now()
     WHERE producto_id=v_prod AND sede_id=v_compra.sede_destino_id;

    INSERT INTO movimientos (
      tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, observaciones
    ) VALUES (
      'garantia_salida', v_prod, v_compra.sede_destino_id, -v_cant,
      v_stock_ant, v_stock_ant - v_cant,
      v_garantia_id, 'garantia_compra', v_uid,
      'Devolución por garantía al proveedor'
    );

    PERFORM fn_actualizar_estado_stock(v_prod, v_compra.sede_destino_id);
  END LOOP;

  IF v_resolucion = 'nota_credito' AND v_monto_total > 0 THEN
    INSERT INTO notas_credito_proveedor (
      proveedor, garantia_compra_id, monto, saldo_restante, observaciones, registrado_por
    ) VALUES (
      v_compra.proveedor, v_garantia_id, v_monto_total, v_monto_total,
      'Nota crédito por garantía de compra', v_uid
    );
  END IF;

  RETURN v_garantia_id;
END $function$;

-- ── ORDENES-04: do_write no debe permitir tocar repuestos de una OT cancelada ─────
drop policy if exists do_write on public.detalle_orden;
create policy do_write on public.detalle_orden
  for all to authenticated
  using (
    exists (
      select 1 from ordenes_servicio o
       where o.id = detalle_orden.orden_id
         and o.estado not in ('entregada', 'cancelada')
         and ((select get_my_rol()) = 'Admin' or o.tecnico_id = (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from ordenes_servicio o
       where o.id = detalle_orden.orden_id
         and o.estado not in ('entregada', 'cancelada')
         and ((select get_my_rol()) = 'Admin' or o.tecnico_id = (select auth.uid()))
    )
  );
