-- Dos correcciones de la revision profunda.
--
-- ── 1. El trigger vigilaba las columnas equivocadas ──────────────────────
--
-- `trg_productos_recalc_estado_stock` disparaba con
-- `AFTER UPDATE OF stock_minimo, stock_maximo ON productos`. Esas dos columnas
-- quedaron VESTIGIALES al mudar el min/max a `inventario`: ya nadie las escribe,
-- asi que el trigger practicamente no vuelve a dispararse.
--
-- Y al mismo tiempo `fn_actualizar_estado_stock` paso a depender de
-- `productos.vendible` (para un no vendible las existencias son
-- cantidad + cantidad_insumo). O sea que hoy NADA recalcula el estado cuando se
-- cambia `vendible`, que es justo el campo del que ahora depende.
--
-- Escenario: un producto vendible con cantidad 0 y cantidad_insumo 40 esta en
-- 'Agotado' (correcto: como articulo de venta no hay nada que vender). Se marca
-- como NO vendible desde la ficha. Su estado deberia pasar a 'OK' —ahora las
-- existencias son 40— pero se queda en 'Agotado' hasta que cualquier otro
-- movimiento lo toque. Mientras tanto alerta sin motivo, o al reves.
--
-- Verificado antes de aplicar: 0 filas desincronizadas hoy, asi que esto
-- previene la deriva futura, no arregla una deuda existente.
DROP TRIGGER IF EXISTS trg_productos_recalc_estado_stock ON public.productos;

CREATE TRIGGER trg_productos_recalc_estado_stock
AFTER UPDATE OF vendible ON public.productos
FOR EACH ROW
WHEN (old.vendible IS DISTINCT FROM new.vendible)
EXECUTE FUNCTION trg_productos_recalc_estado_stock();

COMMENT ON TRIGGER trg_productos_recalc_estado_stock ON public.productos IS
  'Recalcula estado_stock de todas las sedes cuando cambia `vendible`, del que depende la formula de existencias. El min/max ya no vive aqui: vive en inventario y lo recalcula fn_definir_minmax.';

-- ── 2. La bitacora podia registrar un "valor anterior" falso ─────────────
--
-- `fn_definir_minmax` leia el valor anterior con `SELECT ... FOR UPDATE`, pero
-- FOR UPDATE **no bloquea una fila que todavia no existe**, y hay 2.640
-- combinaciones producto x sede sin fila en `inventario` (las que la pantalla
-- muestra como "Nunca ha estado aqui"). Para esas, dos guardados simultaneos
-- leian ambos "no habia nada" y escribian dos entradas de bitacora diciendo
-- min_anterior = NULL, cuando la segunda en realidad piso a la primera.
--
-- Esa bitacora existe para responder "quien apago esta alerta", asi que tiene
-- que ser exacta. Se serializa con un lock consultivo por (producto, sede), que
-- funciona exista la fila o no. Ademas da un orden de bloqueo estable, lo que
-- reduce el riesgo de bloqueo mutuo entre dos guardados en lote.
--
-- NOTA: el cuerpo definitivo de esta funcion queda en la migracion
-- 20260830130709, que le añade la salida temprana cuando no hay nada que
-- cambiar.
CREATE OR REPLACE FUNCTION public.fn_definir_minmax(
  p_producto_id uuid, p_sede_id text, p_minimo integer, p_maximo integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rol text; v_sede text; v_ref text; v_sede_ok boolean;
  v_min_ant integer; v_max_ant integer;
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

  -- Serializa por (producto, sede) exista o no la fila. Un FOR UPDATE no sirve
  -- aqui: no bloquea nada cuando la fila todavia no se ha creado.
  PERFORM pg_advisory_xact_lock(hashtext(p_producto_id::text), hashtext(p_sede_id));

  SELECT stock_minimo, stock_maximo INTO v_min_ant, v_max_ant
  FROM inventario WHERE producto_id = p_producto_id AND sede_id = p_sede_id;

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

REVOKE ALL ON FUNCTION public.fn_definir_minmax(uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_definir_minmax(uuid, text, integer, integer) TO authenticated;
