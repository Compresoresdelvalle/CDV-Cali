-- Campanas del header, parte 2: las conversiones a insumo se agrupan en un
-- solo aviso por día y sede, que se actualiza en vivo en vez de crear una fila
-- nueva. 840 de 886 notificaciones (95%) eran de este tipo y mataron la campana.
--
-- Todo el cuerpo es idéntico a la versión anterior; solo cambia el bloque de
-- notificación del final y se agregan v_fecha y v_key al DECLARE.

CREATE OR REPLACE FUNCTION public.fn_convertir_a_insumo(
  p_producto_id uuid, p_sede_id text, p_cantidad integer
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rol text; v_usuario text;
  v_venta int; v_insumo int;
  v_prod text; v_sede text;
  v_notificar boolean;
  v_fecha date;
  v_key text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::text, nombre INTO v_rol, v_usuario FROM usuarios WHERE id = v_uid;
  IF v_rol IS NULL OR v_rol NOT IN ('Admin','Bodeguero','Tecnico','Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para convertir stock a insumo (rol %)', COALESCE(v_rol,'desconocido');
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad a convertir debe ser mayor a 0';
  END IF;

  SELECT cantidad, cantidad_insumo INTO v_venta, v_insumo
    FROM inventario WHERE producto_id = p_producto_id AND sede_id = p_sede_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no tiene inventario en la sede %', p_sede_id;
  END IF;
  IF v_venta < p_cantidad THEN
    RAISE EXCEPTION 'Stock de venta insuficiente (hay %, intentas convertir %)', v_venta, p_cantidad;
  END IF;

  UPDATE inventario
     SET cantidad = cantidad - p_cantidad,
         cantidad_insumo = cantidad_insumo + p_cantidad,
         ultimo_movimiento = now(), updated_at = now()
   WHERE producto_id = p_producto_id AND sede_id = p_sede_id;

  INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_tipo, usuario_id, observaciones)
  VALUES ('conversion_a_insumo', p_producto_id, p_sede_id, -p_cantidad,
    v_venta, v_venta - p_cantidad, 'conversion', v_uid,
    format('Convertidas %s uds de venta a insumo', p_cantidad));

  PERFORM fn_actualizar_estado_stock(p_producto_id, p_sede_id);

  v_notificar := (v_rol <> 'Admin');
  IF v_notificar THEN
    SELECT nombre INTO v_prod FROM productos WHERE id = p_producto_id;
    SELECT nombre INTO v_sede FROM sedes WHERE id = p_sede_id;

    -- Día laboral en hora Colombia, no UTC: si se corta en UTC, todo lo que
    -- pasa después de las 7pm cae en el "día siguiente" y el agrupado miente.
    v_fecha := (now() AT TIME ZONE 'America/Bogota')::date;
    v_key := 'conversion_insumo:' || p_sede_id || ':' || v_fecha::text;

    INSERT INTO notificaciones (tipo, titulo, mensaje, data, para_rol, created_by,
                                dedupe_key, updated_at)
    VALUES (
      'conversion_insumo',
      'Conversiones a insumo',
      format('Hoy en %s: 1 conversión a insumo (%s ud).',
             COALESCE(v_sede, p_sede_id), p_cantidad),
      jsonb_build_object('sede_id', p_sede_id, 'sede', v_sede,
                         'fecha', v_fecha::text, 'eventos', 1, 'unidades', p_cantidad),
      'Admin', v_uid, v_key, now()
    )
    -- El predicado repite el del índice parcial: ON CONFLICT no puede inferir
    -- un índice parcial sin él.
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE
      SET data = notificaciones.data || jsonb_build_object(
                   'eventos',  COALESCE((notificaciones.data->>'eventos')::int, 0) + 1,
                   'unidades', COALESCE((notificaciones.data->>'unidades')::int, 0) + p_cantidad),
          mensaje = format('Hoy en %s: %s conversiones a insumo (%s ud).',
                     COALESCE(v_sede, p_sede_id),
                     COALESCE((notificaciones.data->>'eventos')::int, 0) + 1,
                     COALESCE((notificaciones.data->>'unidades')::int, 0) + p_cantidad),
          -- Deliberado: si entran conversiones después de que el Admin revisó,
          -- el badge vuelve. Es lo pedido.
          leida = false,
          updated_at = now();
  END IF;

  RETURN jsonb_build_object('producto_id', p_producto_id, 'sede_id', p_sede_id,
    'cantidad_venta', v_venta - p_cantidad, 'cantidad_insumo', v_insumo + p_cantidad,
    'notificado_admin', v_notificar);
END $function$;
