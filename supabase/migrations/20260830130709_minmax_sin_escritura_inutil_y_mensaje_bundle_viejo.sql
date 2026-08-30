-- Dos correcciones mas de la revision profunda.
--
-- ── 1. Escrituras inutiles: bitacora y tormenta de realtime ──────────────
--
-- `fn_definir_minmax` escribia SIEMPRE: upsert + fila de bitacora + recalculo
-- de estado. Guardar 200 filas en lote generaba hasta 400 UPDATE sobre
-- `inventario`, y esa tabla ESTA en la publicacion supabase_realtime, asi que
-- cada uno se emite a cada celular y tablet conectado.
--
-- El backfill masivo si se cuido de esto (la funcion de estado usa
-- IS DISTINCT FROM y el recalculo iba por lotes con pausa), pero el guardado
-- normal no. Ahora, si el minimo y el maximo ya son los que se piden, la
-- funcion sale sin tocar nada: ni upsert, ni bitacora, ni evento. Ademas evita
-- ensuciar el historial de "quien apago esta alerta" con cambios que no
-- cambiaron nada.
--
-- ── 2. Mensaje util para el bundle viejo ─────────────────────────────────
--
-- `fn_aplicar_minmax` empezo a exigir `sede_id` en cada item. La firma de
-- Postgres sigue siendo (jsonb), asi que PostgREST no rechaza la llamada: el
-- error salta DENTRO. El frontend anterior —el que sigue desplegado mientras
-- esta rama no se publique, y el que puede seguir sirviendo el service worker
-- de la PWA horas despues— manda los items SIN `sede_id`.
--
-- El mensaje era "Cada item debe traer producto_id, sede_id, min y max": cierto
-- pero inutil para Maritza, que no sabe que es un item. Ahora se distingue ese
-- caso y se le dice que hacer, como manda la regla del proyecto de que todo
-- bloqueo diga causa y salida.

CREATE OR REPLACE FUNCTION public.fn_definir_minmax(
  p_producto_id uuid, p_sede_id text, p_minimo integer, p_maximo integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rol text; v_sede text; v_ref text; v_sede_ok boolean;
  v_min_ant integer; v_max_ant integer; v_existe boolean;
BEGIN
  SELECT u.rol::text, u.sede_id INTO v_rol, v_sede FROM usuarios u WHERE u.id = auth.uid();

  IF v_rol IS NULL THEN
    RAISE EXCEPTION 'Sesion no valida. Vuelve a iniciar sesion.';
  END IF;
  IF v_rol NOT IN ('Admin', 'Vendedor', 'Bodeguero') THEN
    RAISE EXCEPTION 'Tu rol (%) no puede configurar minimos y maximos. Pidelo a Maritza.', v_rol;
  END IF;
  IF v_rol <> 'Admin' AND p_sede_id IS DISTINCT FROM v_sede THEN
    RAISE EXCEPTION 'Solo puedes configurar minimos de tu sede (%). Para % pidelo a Maritza.',
      COALESCE(v_sede, 'sin sede'), COALESCE(p_sede_id, 'esa sede');
  END IF;

  IF p_minimo IS NULL OR p_maximo IS NULL THEN
    RAISE EXCEPTION 'Falta el minimo o el maximo. Usa 0 para "no controlar".';
  END IF;
  IF p_minimo < 0 OR p_maximo < 0 THEN
    RAISE EXCEPTION 'El minimo y el maximo no pueden ser negativos.';
  END IF;
  IF p_maximo > 0 AND p_maximo <= p_minimo THEN
    RAISE EXCEPTION 'El maximo (%) debe ser MAYOR que el minimo (%). Con maximo igual al minimo el producto quedaria siempre en alerta. Sube el maximo o pon 0 para dejarlo sin techo.',
      p_maximo, p_minimo;
  END IF;

  SELECT referencia INTO v_ref FROM productos WHERE id = p_producto_id AND activo = true;
  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'Ese producto no existe o esta inactivo, asi que no se le puede poner minimo.';
  END IF;
  SELECT true INTO v_sede_ok FROM sedes WHERE id = p_sede_id AND activa = true;
  IF v_sede_ok IS NULL THEN
    RAISE EXCEPTION 'La sede % no existe o esta inactiva.', COALESCE(p_sede_id, 'indicada');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_producto_id::text), hashtext(p_sede_id));

  SELECT stock_minimo, stock_maximo, true
    INTO v_min_ant, v_max_ant, v_existe
  FROM inventario WHERE producto_id = p_producto_id AND sede_id = p_sede_id;

  -- Nada que cambiar: se evita el UPDATE (y su evento de realtime), la fila de
  -- bitacora y el recalculo. En un lote de 200 esto es la diferencia entre
  -- cientos de eventos a cada dispositivo y ninguno.
  IF v_existe AND v_min_ant = p_minimo AND v_max_ant = p_maximo THEN
    RETURN;
  END IF;

  INSERT INTO inventario (producto_id, sede_id, cantidad, cantidad_insumo,
                          stock_minimo, stock_maximo)
  VALUES (p_producto_id, p_sede_id, 0, 0, p_minimo, p_maximo)
  ON CONFLICT (producto_id, sede_id) DO UPDATE
    SET stock_minimo = EXCLUDED.stock_minimo,
        stock_maximo = EXCLUDED.stock_maximo,
        updated_at   = now();

  INSERT INTO inventario_minmax_log (producto_id, sede_id, min_anterior, max_anterior,
                                     min_nuevo, max_nuevo, usuario_id)
  VALUES (p_producto_id, p_sede_id, v_min_ant, v_max_ant, p_minimo, p_maximo, auth.uid());

  PERFORM fn_actualizar_estado_stock(p_producto_id, p_sede_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_aplicar_minmax(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_item record; v_aplicados integer := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Debes enviar al menos un producto.';
  END IF;
  IF jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'Maximo 200 productos por guardado (llegaron %). Guarda por tandas.',
      jsonb_array_length(p_items);
  END IF;

  -- El frontend anterior mandaba los items sin `sede_id` porque el min/max era
  -- global. Se detecta ese caso concreto y se dice que hacer, en vez de soltar
  -- un mensaje sobre la forma del JSON que a nadie le sirve.
  IF NOT (p_items -> 0 ? 'sede_id') THEN
    RAISE EXCEPTION 'Esta pantalla esta desactualizada: los minimos ahora son por sede. Cierra la aplicacion por completo y vuelve a abrirla para actualizarla, y repite la operacion.';
  END IF;

  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items)
      AS x(producto_id uuid, sede_id text, min integer, max integer)
    ORDER BY producto_id, sede_id
  LOOP
    IF v_item.producto_id IS NULL OR v_item.sede_id IS NULL
       OR v_item.min IS NULL OR v_item.max IS NULL THEN
      RAISE EXCEPTION 'Cada item debe traer producto_id, sede_id, min y max.';
    END IF;
    PERFORM public.fn_definir_minmax(v_item.producto_id, v_item.sede_id,
                                     v_item.min, v_item.max);
    v_aplicados := v_aplicados + 1;
  END LOOP;

  RETURN jsonb_build_object('aplicados', v_aplicados);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_definir_minmax(uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_definir_minmax(uuid, text, integer, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_aplicar_minmax(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_aplicar_minmax(jsonb) TO authenticated;
