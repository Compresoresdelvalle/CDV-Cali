-- QA Campaña — Fase 5 (Compras + Devoluciones)
--
-- Hallazgos F5-01/02/03: `CompraNueva.jsx` registraba la compra con 3 inserts
-- NO transaccionales (compra -> detalle -> recibir), tomando `registrado_por`,
-- `subtotal`, `iva` y `total` del cliente sin validación. Riesgos:
--   * F5-01: un bodeguero con devtools podía atribuir la compra a otro usuario
--     (la RLS `compras_insert` no validaba `registrado_por`).
--   * F5-02: los totales venían del cliente, podían no cuadrar con el detalle.
--   * F5-03: si el insert de detalle fallaba, quedaba una compra huérfana.
--
-- Solución: RPC server-authoritative (mismo patrón que `fn_registrar_venta`).
-- `registrado_por` SIEMPRE es `auth.uid()`; los totales se recalculan en el
-- servidor; compra + detalle se insertan en una sola transacción. Se elimina
-- la política de INSERT directo para forzar el uso del RPC.

CREATE OR REPLACE FUNCTION public.fn_registrar_compra(
  p_sede_id text,
  p_proveedor text,
  p_factura_proveedor text DEFAULT NULL,
  p_observaciones text DEFAULT NULL,
  p_recibir boolean DEFAULT false,
  p_items jsonb DEFAULT '[]'::jsonb)
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

  IF v_mi_rol NOT IN ('Admin', 'Bodeguero') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar compras';
  END IF;
  IF v_mi_rol <> 'Admin' AND v_mi_sede IS DISTINCT FROM p_sede_id THEN
    RAISE EXCEPTION 'No puedes registrar compras en una sede distinta a la tuya';
  END IF;
  IF p_proveedor IS NULL OR TRIM(p_proveedor) = '' THEN
    RAISE EXCEPTION 'El proveedor es obligatorio';
  END IF;

  -- Subtotal recalculado server-side: el costo es legítimamente del usuario
  -- (factura del proveedor), pero los totales se derivan aquí, no del cliente.
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

  -- Recepción opcional: el UPDATE dispara trg_compra_sumar_stock.
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

REVOKE EXECUTE ON FUNCTION public.fn_registrar_compra(text,text,text,text,boolean,jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_registrar_compra(text,text,text,text,boolean,jsonb) TO authenticated;

-- Forzar el uso del RPC: sin INSERT directo a compras ni a detalle_compra.
-- (La recepción sigue siendo un UPDATE directo permitido por `compras_update`.)
DROP POLICY IF EXISTS compras_insert ON public.compras;
DROP POLICY IF EXISTS dc_write ON public.detalle_compra;
