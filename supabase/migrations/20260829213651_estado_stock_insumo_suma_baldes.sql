-- Correccion sobre el paso 2: para un producto NO vendible, las existencias son
-- `cantidad + cantidad_insumo`, no solo `cantidad_insumo`.
--
-- Por que: la chatarra se marca no vendible pero su unidad fisica vive en
-- `cantidad` (asi la deja fn_registrar_devolucion_cliente). Con
-- `ELSE cantidad_insumo` esas filas pasaban a decir "Agotado" teniendo la pieza
-- en la mano: una regresion, porque hoy dicen OK.
--
-- La suma es segura por construccion: hoy el estado se calcula con `cantidad` a
-- secas, y cantidad + cantidad_insumo >= cantidad, asi que ninguna fila queda
-- MAS alarmante que antes. Y arregla las 28 filas de insumos que decian
-- "Agotado" teniendo insumo disponible.
--
-- OJO: `v_sugerencias_reorden` sigue usando `vendible ? cantidad :
-- cantidad_insumo` a proposito. Son preguntas distintas: el estado responde
-- "tengo la cosa?" y la sugerencia responde "cuanto compro para tener insumo
-- USABLE?", y lo que esta en el balde de venta no se puede consumir sin
-- convertirlo primero.
CREATE OR REPLACE FUNCTION public.fn_actualizar_estado_stock(p_producto_id uuid, p_sede_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_exist INTEGER; v_min INTEGER; v_max INTEGER; v_nuevo estado_stock;
BEGIN
  SELECT CASE WHEN p.vendible THEN i.cantidad
              ELSE i.cantidad + i.cantidad_insumo END,
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
