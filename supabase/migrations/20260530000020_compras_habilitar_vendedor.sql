-- ============================================================================
-- Habilitar el rol Vendedor en el módulo de Compras.
--
-- Solo se amplía el gate de rol de los dos RPC (Admin/Bodeguero → +Vendedor).
-- Se conserva el bloqueo de sede (cada quien registra en su propia sede).
-- La RLS de lectura de `compras`/`detalle_compra` ya permite ver lo de la
-- propia sede sin importar el rol, así que no requiere cambios.
--
-- Nota: al Vendedor NO se le precarga el costo histórico del producto en el
-- frontend (lo digita manual). Esto es un cambio de UI; aquí solo se amplían
-- los permisos de registro.
-- ============================================================================

-- fn_registrar_compra: +Vendedor en el gate.
CREATE OR REPLACE FUNCTION public.fn_registrar_compra(
  p_sede_id text,
  p_proveedor text,
  p_factura_proveedor text DEFAULT NULL::text,
  p_observaciones text DEFAULT NULL::text,
  p_recibir boolean DEFAULT false,
  p_items jsonb DEFAULT '[]'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_usuario_id UUID;
  v_mi_sede    TEXT;
  v_mi_rol     TEXT;
  v_compra_id  UUID;
  v_numero     INT;
  item         JSONB;
  v_prod_id    UUID;
  v_cantidad   INTEGER;
  v_costo      NUMERIC;
  v_subtotal   NUMERIC := 0;
  v_iva        NUMERIC;
  v_total      NUMERIC;
BEGIN
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La compra debe tener al menos un ítem';
  END IF;

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
    RAISE EXCEPTION 'No puedes registrar compras en una sede distinta a la tuya';
  END IF;
  IF p_proveedor IS NULL OR TRIM(p_proveedor) = '' THEN
    RAISE EXCEPTION 'El proveedor es obligatorio';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_prod_id  := (item->>'producto_id')::UUID;
    v_cantidad := (item->>'cantidad')::INTEGER;
    v_costo    := (item->>'costo_unitario')::NUMERIC;
    IF v_cantidad IS NULL OR v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida para el producto %', v_prod_id;
    END IF;
    IF v_costo IS NULL OR v_costo < 0 THEN
      RAISE EXCEPTION 'Costo inválido para el producto %', v_prod_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM productos WHERE id = v_prod_id AND activo = true) THEN
      RAISE EXCEPTION 'Producto % no encontrado o inactivo', v_prod_id;
    END IF;
    v_subtotal := v_subtotal + v_cantidad * v_costo;
  END LOOP;

  v_iva   := round(v_subtotal * 0.19, 2);
  v_total := v_subtotal + v_iva;

  INSERT INTO compras (
    proveedor, registrado_por, sede_destino_id, subtotal, iva, total,
    factura_proveedor, observaciones, recibida
  ) VALUES (
    TRIM(p_proveedor), v_usuario_id, p_sede_id, v_subtotal, v_iva, v_total,
    NULLIF(TRIM(COALESCE(p_factura_proveedor, '')), ''),
    NULLIF(TRIM(COALESCE(p_observaciones, '')), ''),
    false
  ) RETURNING id, numero INTO v_compra_id, v_numero;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_prod_id  := (item->>'producto_id')::UUID;
    v_cantidad := (item->>'cantidad')::INTEGER;
    v_costo    := (item->>'costo_unitario')::NUMERIC;
    INSERT INTO detalle_compra (compra_id, producto_id, cantidad, costo_unitario, subtotal)
    VALUES (v_compra_id, v_prod_id, v_cantidad, v_costo, v_cantidad * v_costo);
  END LOOP;

  IF p_recibir THEN
    UPDATE compras SET recibida = true, fecha_recepcion = now()
     WHERE id = v_compra_id;
  END IF;

  RETURN jsonb_build_object(
    'compra_id', v_compra_id, 'numero', v_numero,
    'subtotal', v_subtotal, 'iva', v_iva, 'total', v_total,
    'recibida', p_recibir
  );
END;
$function$;

-- fn_registrar_caja_menor: +Vendedor en el gate.
CREATE OR REPLACE FUNCTION public.fn_registrar_caja_menor(
  p_sede_id text,
  p_concepto text,
  p_monto numeric,
  p_proveedor text DEFAULT NULL::text,
  p_observaciones text DEFAULT NULL::text
)
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

  INSERT INTO compras (
    proveedor, registrado_por, sede_destino_id, subtotal, iva, total,
    factura_proveedor, observaciones, recibida, fecha_recepcion,
    es_caja_menor, concepto
  ) VALUES (
    COALESCE(NULLIF(TRIM(COALESCE(p_proveedor, '')), ''), 'Caja menor'),
    v_usuario_id, p_sede_id, v_monto, 0, v_monto,
    NULL,
    NULLIF(TRIM(COALESCE(p_observaciones, '')), ''),
    true, now(),
    true, TRIM(p_concepto)
  ) RETURNING id, numero INTO v_compra_id, v_numero;

  RETURN jsonb_build_object(
    'compra_id', v_compra_id, 'numero', v_numero,
    'total', v_monto, 'es_caja_menor', true
  );
END;
$function$;
