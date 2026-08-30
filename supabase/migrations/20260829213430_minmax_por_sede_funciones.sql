-- Min/max por sede, paso 2: las funciones.
--
-- La firma de fn_actualizar_estado_stock NO cambia. 30 funciones la llaman
-- (ventas, compras, traspasos, ensambles, OT, garantias, conteo): cambiarle la
-- firma las romperia todas. Solo cambia el cuerpo.
--
-- (El cuerpo definitivo queda en la migracion
--  20260829213651_estado_stock_insumo_suma_baldes.sql, que corrige la regla de
--  existencias para los productos no vendibles.)
CREATE OR REPLACE FUNCTION public.fn_actualizar_estado_stock(p_producto_id uuid, p_sede_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_exist INTEGER; v_min INTEGER; v_max INTEGER; v_nuevo estado_stock;
BEGIN
  SELECT CASE WHEN p.vendible THEN i.cantidad ELSE i.cantidad_insumo END,
         COALESCE(i.stock_minimo, 0), COALESCE(i.stock_maximo, 0)
    INTO v_exist, v_min, v_max
  FROM inventario i JOIN productos p ON p.id = i.producto_id
  WHERE i.producto_id = p_producto_id AND i.sede_id = p_sede_id;

  IF NOT FOUND THEN RETURN; END IF;

  v_nuevo := CASE
    WHEN v_exist <= 0                     THEN 'Agotado'
    WHEN v_min > 0 AND v_exist <= v_min   THEN 'Bajo'
    WHEN v_max > 0 AND v_exist >  v_max   THEN 'Sobrestock'
    ELSE 'OK'
  END;

  UPDATE inventario SET estado_stock = v_nuevo, updated_at = now()
  WHERE producto_id = p_producto_id AND sede_id = p_sede_id
    AND estado_stock IS DISTINCT FROM v_nuevo;
END;
$function$;

-- `inventario` solo tiene politica de SELECT, asi que toda escritura de min/max
-- pasa por aqui. Es la UNICA puerta: fn_aplicar_minmax tambien delega en esta.
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
  IF p_maximo > 0 AND p_maximo < p_minimo THEN
    RAISE EXCEPTION 'El maximo (%) no puede ser menor que el minimo (%). Sube el maximo o baja el minimo.',
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

  SELECT stock_minimo, stock_maximo INTO v_min_ant, v_max_ant
  FROM inventario WHERE producto_id = p_producto_id AND sede_id = p_sede_id;

  -- Crea la fila si esa sede nunca ha tenido el producto (2.624 combinaciones
  -- producto x sede estan asi). NUNCA toca `cantidad` ni `cantidad_insumo`:
  -- configurar un minimo no mueve inventario.
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

REVOKE ALL ON FUNCTION public.fn_definir_minmax(uuid, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_definir_minmax(uuid, text, integer, integer) TO authenticated;
