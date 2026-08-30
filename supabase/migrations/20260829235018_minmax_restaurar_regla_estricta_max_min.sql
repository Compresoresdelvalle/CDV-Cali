-- Restaura la regla ESTRICTA max > min que ya existia en `productos` desde
-- julio (constraint `chk_stock_max_min`, migracion S4-21) y que al pasar el
-- min/max a `inventario` se copio debilitada como `>=`.
--
-- Por que importa: con min = max = 10 NO existe ninguna cantidad que deje el
-- producto en 'OK'.
--   cantidad 10 -> `v_min > 0 AND v_exist <= v_min`  -> 'Bajo'
--   cantidad 11 -> `v_max > 0 AND v_exist >  v_max`  -> 'Sobrestock'
-- Y en `v_sugerencias_reorden`, con existencias = min = max el objetivo es
-- igual a las existencias, `cantidad_sugerida` da 0 y la fila queda excluida
-- por el `WHERE ... > 0`. Resultado: alerta permanente de "Bajo" que ademas es
-- imposible de resolver desde Reorden, que es justo el tipo de aviso sin salida
-- que este proyecto prohibe.
--
-- Verificado antes de aplicar: 0 filas de inventario con max = min > 0.

ALTER TABLE public.inventario
  DROP CONSTRAINT IF EXISTS inventario_max_mayor_que_min,
  ADD CONSTRAINT inventario_max_mayor_que_min
    CHECK (stock_maximo = 0 OR stock_maximo > stock_minimo);

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
  -- Estricto, no <=: con maximo igual al minimo el producto no puede quedar
  -- nunca en 'OK' y la alerta no tiene forma de resolverse.
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

  -- FOR UPDATE: sin el, dos guardados simultaneos sobre la misma fila podian
  -- leer el mismo valor "anterior" y dejar la bitacora con un historial falso.
  -- Esa bitacora existe para responder "quien apago esta alerta".
  SELECT stock_minimo, stock_maximo INTO v_min_ant, v_max_ant
  FROM inventario WHERE producto_id = p_producto_id AND sede_id = p_sede_id
  FOR UPDATE;

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
