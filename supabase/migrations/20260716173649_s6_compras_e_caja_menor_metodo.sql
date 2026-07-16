-- S6-E: fn_registrar_caja_menor con método/cuenta explícitos (prioridad parámetro > GUC S1-21 > 'Efectivo')

DROP FUNCTION public.fn_registrar_caja_menor(text, text, numeric, text, text);

CREATE OR REPLACE FUNCTION public.fn_registrar_caja_menor(
  p_sede_id text, p_concepto text, p_monto numeric,
  p_proveedor text DEFAULT NULL::text, p_observaciones text DEFAULT NULL::text,
  p_metodo_pago text DEFAULT NULL::text, p_cuenta_bancaria text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario_id UUID;
  v_mi_sede    TEXT;
  v_mi_rol     TEXT;
  v_compra_id  UUID;
  v_numero     INT;
  v_monto      NUMERIC;
  v_metodo     TEXT;
  v_cuenta     TEXT;
BEGIN
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT sede_id, rol::TEXT INTO v_mi_sede, v_mi_rol
    FROM usuarios WHERE id = v_usuario_id;

  IF v_mi_rol NOT IN ('Admin', 'Bodeguero', 'Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar compras';
  END IF;
  IF v_mi_rol <> 'Admin' AND v_mi_sede IS DISTINCT FROM p_sede_id THEN
    RAISE EXCEPTION 'No puedes registrar en una sede distinta a la tuya';
  END IF;

  IF p_concepto IS NULL OR TRIM(p_concepto) = '' THEN
    RAISE EXCEPTION 'El concepto es obligatorio para una compra de caja menor';
  END IF;

  v_monto := ROUND(COALESCE(p_monto, 0), 2);
  IF v_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0';
  END IF;

  -- S6-E: prioridad parámetro explícito > GUC (S1-21, fn_registrar_cambio) > 'Efectivo'
  v_metodo := public._fn_metodo_pago_canonico(
                COALESCE(NULLIF(TRIM(COALESCE(p_metodo_pago,'')), ''),
                         NULLIF(current_setting('cdv.caja_menor_metodo', true), ''),
                         'Efectivo'));
  IF v_metodo NOT IN ('Efectivo','Transferencia','Tarjeta') THEN
    RAISE EXCEPTION 'Método de pago inválido para caja menor (%)', v_metodo;
  END IF;

  v_cuenta := COALESCE(NULLIF(TRIM(COALESCE(p_cuenta_bancaria,'')), ''),
                       NULLIF(current_setting('cdv.caja_menor_cuenta', true), ''));
  IF v_metodo IN ('Transferencia','Tarjeta') AND v_cuenta IS NULL THEN
    RAISE EXCEPTION 'Indica la cuenta bancaria para pagos con % (Transferencia o Tarjeta).', v_metodo;
  END IF;
  IF v_metodo = 'Efectivo' THEN
    v_cuenta := NULL;
  END IF;

  INSERT INTO compras (
    proveedor, registrado_por, sede_destino_id, subtotal, iva, total,
    factura_proveedor, observaciones, recibida, fecha_recepcion,
    es_caja_menor, concepto, metodo_pago, cuenta_bancaria
  ) VALUES (
    COALESCE(NULLIF(TRIM(COALESCE(p_proveedor, '')), ''), 'Caja menor'),
    v_usuario_id, p_sede_id, v_monto, 0, v_monto,
    NULL,
    NULLIF(TRIM(COALESCE(p_observaciones, '')), ''),
    true, now(),
    true, TRIM(p_concepto), v_metodo, v_cuenta
  ) RETURNING id, numero INTO v_compra_id, v_numero;

  RETURN jsonb_build_object(
    'compra_id', v_compra_id, 'numero', v_numero,
    'total', v_monto, 'es_caja_menor', true,
    'metodo_pago', v_metodo, 'cuenta_bancaria', v_cuenta
  );
END;
$function$;
