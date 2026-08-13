-- Anular devolución, ahora consciente del flujo nuevo (destino + reembolso):
--  * destino 'vendible'    -> la devolución sumó al producto ORIGINAL -> se resta.
--  * destino 'chatarra'    -> sumó al producto CHATARRA -> se resta de ese.
--  * destino 'no_reingresa'-> no hubo movimiento de stock -> nada que revertir.
--  * proveedor (venta_id NULL) -> restó del original -> se repone.
-- El REEMBOLSO se revierte solo: al quedar estado='anulada', el cierre deja de
-- contarlo como egreso (filtra estado<>'anulada'), igual que garantías.
-- Reglas previas intactas: solo Admin, no re-anular, no anular las de un cambio,
-- no dejar stock negativo. Probado en prod (transacciones revertidas): vendible,
-- chatarra, no_reingresa, proveedor, guarda negativa, cambio y doble anulación.
CREATE OR REPLACE FUNCTION public.fn_anular_devolucion(p_devolucion_id uuid, p_motivo text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_usuario_id uuid;
  v_rol text;
  v_dev devoluciones%ROWTYPE;
  v_target uuid;
  v_reverse integer;
  v_stock_ant integer;
  v_stock_post integer;
BEGIN
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;

  SELECT rol::text INTO v_rol FROM usuarios WHERE id = v_usuario_id;
  IF v_rol IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede anular devoluciones';
  END IF;

  SELECT * INTO v_dev FROM devoluciones WHERE id = p_devolucion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Devolución no encontrada'; END IF;
  IF v_dev.estado = 'anulada' THEN
    RAISE EXCEPTION 'La devolución #% ya está anulada', v_dev.numero;
  END IF;
  IF v_dev.motivo ILIKE 'Cambio desde venta%' THEN
    RAISE EXCEPTION 'La devolución #% es parte de un cambio de producto. Para revertirla, anula la venta del cambio desde Ventas.', v_dev.numero;
  END IF;

  -- Producto y reversa según el destino / tipo.
  IF v_dev.destino_stock = 'no_reingresa' THEN
    v_target := NULL; v_reverse := 0;
  ELSIF v_dev.destino_stock = 'chatarra' THEN
    v_target := v_dev.chatarra_producto_id;
    v_reverse := CASE WHEN v_dev.chatarra_producto_id IS NULL THEN 0 ELSE -v_dev.cantidad END;
  ELSIF v_dev.venta_id IS NOT NULL THEN
    v_target := v_dev.producto_id; v_reverse := -v_dev.cantidad;
  ELSE
    v_target := v_dev.producto_id; v_reverse := v_dev.cantidad;
  END IF;

  IF v_target IS NOT NULL AND v_reverse <> 0 THEN
    SELECT cantidad INTO v_stock_ant FROM inventario
     WHERE producto_id = v_target AND sede_id = v_dev.sede_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No hay registro de inventario para revertir esta devolución';
    END IF;
    IF v_reverse < 0 AND v_stock_ant < abs(v_reverse) THEN
      RAISE EXCEPTION 'No se puede anular: el stock disponible (%) es menor a las % unidades que reingresó la devolución (parte ya se movió o vendió).',
        v_stock_ant, abs(v_reverse);
    END IF;
    UPDATE inventario
       SET cantidad = cantidad + v_reverse, ultimo_movimiento = now(), updated_at = now()
     WHERE producto_id = v_target AND sede_id = v_dev.sede_id
     RETURNING cantidad INTO v_stock_post;
    INSERT INTO movimientos (producto_id, sede_id, tipo, cantidad,
      stock_anterior, stock_posterior, referencia_id, referencia_tipo,
      usuario_id, observaciones)
    VALUES (v_target, v_dev.sede_id, 'ajuste', v_reverse,
      v_stock_ant, v_stock_post, v_dev.id, 'devolucion', v_usuario_id,
      'Anulación de devolución #' || v_dev.numero ||
        CASE WHEN v_dev.monto_reembolso > 0 THEN ' (revierte reembolso)' ELSE '' END ||
        COALESCE(': ' || NULLIF(btrim(p_motivo), ''), ''));
    PERFORM fn_actualizar_estado_stock(v_target, v_dev.sede_id);
  END IF;

  UPDATE devoluciones
     SET estado = 'anulada', anulado_por = v_usuario_id, anulado_at = now(),
         motivo_anulacion = NULLIF(btrim(p_motivo), ''), updated_at = now()
   WHERE id = v_dev.id;

  RETURN jsonb_build_object(
    'devolucion_id', v_dev.id, 'numero', v_dev.numero, 'estado', 'anulada',
    'destino_stock', v_dev.destino_stock, 'delta_stock', v_reverse,
    'reembolso_revertido', v_dev.monto_reembolso
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_anular_devolucion(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_anular_devolucion(uuid, text) TO authenticated;
