-- ============================================================================
-- Bloque 2 — A3a: funciones de conversión venta <-> insumo (SOLO Admin).
-- ADITIVO y SEGURO: nadie las llama todavía; no cambia comportamiento actual.
-- Requiere A1 (columna cantidad_insumo) y A2 (valores de enum) ya aplicados.
-- Los ajustes a los triggers de consumo van aparte (A3b, migración ...0009),
-- y se aplican junto con el deploy del frontend del Bloque 2 (rollout escalonado).
-- ============================================================================

-- ── Conversión: stock de VENTA -> INSUMO (solo Admin) ───────────────────────
CREATE OR REPLACE FUNCTION public.fn_convertir_a_insumo(
  p_producto_id uuid, p_sede_id text, p_cantidad integer
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_rol text; v_venta int; v_insumo int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::text INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol <> 'Admin' THEN
    RAISE EXCEPTION 'Solo el Admin puede convertir stock a insumo';
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

  RETURN jsonb_build_object('producto_id', p_producto_id, 'sede_id', p_sede_id,
    'cantidad_venta', v_venta - p_cantidad, 'cantidad_insumo', v_insumo + p_cantidad);
END $function$;

-- ── Conversión inversa: INSUMO -> VENTA (solo Admin) ────────────────────────
CREATE OR REPLACE FUNCTION public.fn_revertir_insumo_a_venta(
  p_producto_id uuid, p_sede_id text, p_cantidad integer
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_rol text; v_venta int; v_insumo int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::text INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol <> 'Admin' THEN
    RAISE EXCEPTION 'Solo el Admin puede mover stock de insumo a venta';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
  END IF;

  SELECT cantidad, cantidad_insumo INTO v_venta, v_insumo
    FROM inventario WHERE producto_id = p_producto_id AND sede_id = p_sede_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no tiene inventario en la sede %', p_sede_id;
  END IF;
  IF v_insumo < p_cantidad THEN
    RAISE EXCEPTION 'Stock de insumo insuficiente (hay %, intentas devolver %)', v_insumo, p_cantidad;
  END IF;

  UPDATE inventario
     SET cantidad_insumo = cantidad_insumo - p_cantidad,
         cantidad = cantidad + p_cantidad,
         ultimo_movimiento = now(), updated_at = now()
   WHERE producto_id = p_producto_id AND sede_id = p_sede_id;

  INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_tipo, usuario_id, observaciones)
  VALUES ('conversion_a_venta', p_producto_id, p_sede_id, p_cantidad,
    v_venta, v_venta + p_cantidad, 'conversion', v_uid,
    format('Devueltas %s uds de insumo a venta', p_cantidad));

  PERFORM fn_actualizar_estado_stock(p_producto_id, p_sede_id);

  RETURN jsonb_build_object('producto_id', p_producto_id, 'sede_id', p_sede_id,
    'cantidad_venta', v_venta + p_cantidad, 'cantidad_insumo', v_insumo - p_cantidad);
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_convertir_a_insumo(uuid,text,integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_convertir_a_insumo(uuid,text,integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_revertir_insumo_a_venta(uuid,text,integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_revertir_insumo_a_venta(uuid,text,integer) TO authenticated;
