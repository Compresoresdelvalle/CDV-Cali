-- FEATURE S6: fn_recibir_compra — recepción total o parcial vía RPC.
-- Si una línea llega incompleta, se ajusta detalle_compra.cantidad/subtotal y los totales
-- de la compra ANTES de marcar recibida=true (el trigger de stock suma lo real y CxP/cierre
-- reflejan lo que de verdad se pagará). cantidad_recibida=0 elimina la línea con nota.
-- El bloqueo del UPDATE directo de `recibida` queda PENDIENTE hasta el deploy del frontend.

CREATE OR REPLACE FUNCTION public.fn_recibir_compra(p_compra_id uuid, p_recepciones jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_rol       text;
  v_mi_sede   text;
  v_compra    record;
  v_rec       jsonb;
  v_det       record;
  v_cant_rec  int;
  v_notas     text := '';
  v_ajustadas int := 0;
  v_eliminadas int := 0;
  v_subtotal  numeric;
  v_desc      numeric;
  v_iva       numeric;
  v_total     numeric;
  v_restantes int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::text, sede_id INTO v_rol, v_mi_sede FROM usuarios WHERE id = v_uid;
  IF v_rol NOT IN ('Admin','Bodeguero','Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para recibir compras';
  END IF;

  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada'; END IF;
  IF v_rol <> 'Admin' AND v_compra.sede_destino_id IS DISTINCT FROM v_mi_sede THEN
    RAISE EXCEPTION 'No puedes recibir una compra de otra sede';
  END IF;
  IF v_compra.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se puede recibir una compra cancelada';
  END IF;
  IF COALESCE(v_compra.recibida, false) THEN
    RAISE EXCEPTION 'La compra ya fue recibida';
  END IF;

  PERFORM set_config('cdv.compra_admin', 'on', true);

  -- Recepción parcial: ajustar líneas ANTES de marcar recibida (el trigger de stock suma lo real)
  IF p_recepciones IS NOT NULL AND jsonb_typeof(p_recepciones) = 'array' AND jsonb_array_length(p_recepciones) > 0 THEN
    FOR v_rec IN SELECT * FROM jsonb_array_elements(p_recepciones) LOOP
      v_cant_rec := (v_rec->>'cantidad_recibida')::int;
      SELECT dc.*, p.nombre AS producto_nombre
        INTO v_det
        FROM detalle_compra dc JOIN productos p ON p.id = dc.producto_id
       WHERE dc.id = (v_rec->>'detalle_id')::uuid AND dc.compra_id = p_compra_id
       FOR UPDATE OF dc;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La línea % no pertenece a esta compra', v_rec->>'detalle_id';
      END IF;
      IF v_cant_rec IS NULL OR v_cant_rec < 0 THEN
        RAISE EXCEPTION 'Cantidad recibida inválida para %', v_det.producto_nombre;
      END IF;
      IF v_cant_rec > v_det.cantidad THEN
        RAISE EXCEPTION 'La cantidad recibida (%) supera la pedida (%) en %', v_cant_rec, v_det.cantidad, v_det.producto_nombre;
      END IF;

      IF v_cant_rec = 0 THEN
        DELETE FROM detalle_compra WHERE id = v_det.id;
        v_eliminadas := v_eliminadas + 1;
        v_notas := v_notas || format(' | Recepción parcial: 0 de %s en %s (línea eliminada)', v_det.cantidad, v_det.producto_nombre);
      ELSIF v_cant_rec < v_det.cantidad THEN
        UPDATE detalle_compra
           SET cantidad = v_cant_rec, subtotal = v_cant_rec * costo_unitario
         WHERE id = v_det.id;
        v_ajustadas := v_ajustadas + 1;
        v_notas := v_notas || format(' | Recepción parcial: %s de %s en %s', v_cant_rec, v_det.cantidad, v_det.producto_nombre);
      END IF;
    END LOOP;

    SELECT count(*) INTO v_restantes FROM detalle_compra WHERE compra_id = p_compra_id;
    IF v_restantes = 0 THEN
      RAISE EXCEPTION 'No llegó ningún producto: no se puede recibir la compra. Usa "Cancelar compra" en su lugar.';
    END IF;

    IF v_ajustadas > 0 OR v_eliminadas > 0 THEN
      SELECT COALESCE(SUM(subtotal), 0) INTO v_subtotal FROM detalle_compra WHERE compra_id = p_compra_id;
      v_desc  := GREATEST(0, LEAST(COALESCE(v_compra.descuento_valor, 0), v_subtotal));
      v_iva   := ROUND((v_subtotal - v_desc) * COALESCE(v_compra.iva_pct, 0) / 100, 0);
      v_total := ROUND((v_subtotal - v_desc) + v_iva);
      UPDATE compras
         SET subtotal = v_subtotal, iva = v_iva, total = v_total,
             descuento_valor = NULLIF(v_desc, 0),
             observaciones = NULLIF(TRIM(BOTH ' |' FROM COALESCE(observaciones, '') || v_notas), '')
       WHERE id = p_compra_id;
    END IF;
  END IF;

  UPDATE compras SET recibida = true, fecha_recepcion = now() WHERE id = p_compra_id;

  PERFORM set_config('cdv.compra_admin', '', true);

  SELECT numero, total INTO v_det FROM compras WHERE id = p_compra_id;
  RETURN jsonb_build_object(
    'compra_id', p_compra_id, 'numero', v_det.numero, 'recibida', true,
    'total', v_det.total, 'lineas_ajustadas', v_ajustadas, 'lineas_eliminadas', v_eliminadas
  );
END;
$function$;
