-- MEDIO (auditoría 2026-06-09, M2): fn_aplicar_ajuste_conteo hacía un overwrite
-- ABSOLUTO (inventario.cantidad = stock_fisico) usando la `diferencia` congelada al
-- REGISTRAR el conteo (columna generada = stock_fisico - stock_sistema). Si entre
-- fn_registrar_conteo y fn_aplicar_ajuste_conteo ocurría una venta/traspaso, el
-- overwrite borraba esos movimientos del saldo y el movimiento de ajuste quedaba con
-- cantidad (delta viejo) inconsistente con el stock_anterior real, rompiendo
-- stock_posterior = stock_anterior + cantidad y perdiendo stock en silencio (TOCTOU).
--
-- Fix (chequeo optimista): tras bloquear inventario con FOR UPDATE, comparar el
-- stock real con el stock_sistema que vio el conteo. Si difieren, abortar exigiendo
-- recontar (no aplicar un conteo cuya base ya se movió). Además, el movimiento se
-- asienta con cantidad = stock_fisico - stock_actual (== diferencia cuando la base
-- coincide), dejando explícito el invariante cantidad = stock_posterior - stock_anterior.

create or replace function public.fn_aplicar_ajuste_conteo(p_conteo_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_conteo conteos%ROWTYPE;
  v_rol TEXT;
  v_uid UUID := auth.uid();
  v_stock_actual INTEGER;
  v_cantidad INTEGER;
BEGIN
  SELECT rol::TEXT INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol <> 'Admin' THEN RAISE EXCEPTION 'Solo Admin puede aplicar ajustes de conteo'; END IF;

  SELECT * INTO v_conteo FROM conteos WHERE id = p_conteo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conteo no encontrado'; END IF;
  IF v_conteo.ajuste_aplicado THEN RAISE EXCEPTION 'Este conteo ya fue ajustado'; END IF;
  IF v_conteo.stock_fisico IS NULL THEN RAISE EXCEPTION 'stock_fisico es NULL — conteo corrupto'; END IF;

  SELECT cantidad INTO v_stock_actual FROM inventario
   WHERE producto_id = v_conteo.producto_id AND sede_id = v_conteo.sede_id FOR UPDATE;
  v_stock_actual := COALESCE(v_stock_actual, 0);

  -- Chequeo optimista: si el stock se movió desde que se registró el conteo, abortar.
  -- Evita sobrescribir ventas/traspasos concurrentes con un stock_fisico ya obsoleto.
  IF v_stock_actual <> v_conteo.stock_sistema THEN
    RAISE EXCEPTION 'El stock cambió desde que se registró el conteo (sistema=%, actual=%). Vuelve a registrar el conteo antes de aplicar el ajuste.',
      v_conteo.stock_sistema, v_stock_actual;
  END IF;

  v_cantidad := v_conteo.stock_fisico - v_stock_actual;  -- == diferencia cuando la base coincide

  UPDATE inventario SET cantidad = v_conteo.stock_fisico,
    ultimo_movimiento = now(), updated_at = now()
   WHERE producto_id = v_conteo.producto_id AND sede_id = v_conteo.sede_id;

  INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id, observaciones)
  VALUES ('conteo_ajuste', v_conteo.producto_id, v_conteo.sede_id, v_cantidad,
    v_stock_actual, v_conteo.stock_fisico, v_conteo.id, 'conteo', v_uid, 'Ajuste de conteo cíclico');

  UPDATE conteos SET ajuste_aplicado = true, aprobado_por = v_uid WHERE id = p_conteo_id;
  PERFORM fn_actualizar_estado_stock(v_conteo.producto_id, v_conteo.sede_id);
  RETURN jsonb_build_object('ok', true, 'diferencia', v_cantidad,
    'stock_anterior', v_stock_actual, 'stock_posterior', v_conteo.stock_fisico);
END; $function$;
