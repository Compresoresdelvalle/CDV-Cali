-- ============================================================================
-- Compras · IVA dinámico (paridad con Ventas).
--
-- Antes: fn_registrar_compra hardcodeaba IVA al 19% y la tabla `compras` solo
-- guardaba el monto absoluto (`iva`), no el porcentaje aplicado.
-- Ahora: la función acepta `p_iva_pct` (0–100, default 19) y la tabla persiste
-- el porcentaje en una nueva columna `iva_pct` para que el detalle/reportes
-- puedan reconstruir cómo se calculó el total.
-- ============================================================================

-- 1) Columna iva_pct. Default 19 mantiene compras históricas correctas.
ALTER TABLE public.compras
  ADD COLUMN IF NOT EXISTS iva_pct NUMERIC(5,2) NOT NULL DEFAULT 19;

ALTER TABLE public.compras
  DROP CONSTRAINT IF EXISTS compras_iva_pct_check;
ALTER TABLE public.compras
  ADD CONSTRAINT compras_iva_pct_check CHECK (iva_pct >= 0 AND iva_pct <= 100);

-- 2) DROP de la firma vieja para que PostgREST no se confunda con un overload.
--    Mismo patrón que 20260530000016_bloque3_09_precio_iva_venta.
DROP FUNCTION IF EXISTS public.fn_registrar_compra(text, text, text, text, boolean, jsonb);

-- 3) fn_registrar_compra con p_iva_pct (clampado a 0..100, default 19).
CREATE OR REPLACE FUNCTION public.fn_registrar_compra(
  p_sede_id text,
  p_proveedor text,
  p_factura_proveedor text DEFAULT NULL::text,
  p_observaciones text DEFAULT NULL::text,
  p_recibir boolean DEFAULT false,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_iva_pct numeric DEFAULT 19
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
  v_destino    TEXT;
  v_subtotal   NUMERIC := 0;
  v_iva_pct    NUMERIC;
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

  -- Clampa al rango [0, 100]; mismo patrón que fn_registrar_venta.
  v_iva_pct := GREATEST(0, LEAST(100, COALESCE(p_iva_pct, 19)));

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

  v_iva   := round(v_subtotal * v_iva_pct / 100, 2);
  v_total := v_subtotal + v_iva;

  INSERT INTO compras (
    proveedor, registrado_por, sede_destino_id, subtotal, iva, iva_pct, total,
    factura_proveedor, observaciones, recibida
  ) VALUES (
    TRIM(p_proveedor), v_usuario_id, p_sede_id, v_subtotal, v_iva, v_iva_pct, v_total,
    NULLIF(TRIM(COALESCE(p_factura_proveedor, '')), ''),
    NULLIF(TRIM(COALESCE(p_observaciones, '')), ''),
    false
  ) RETURNING id, numero INTO v_compra_id, v_numero;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_prod_id  := (item->>'producto_id')::UUID;
    v_cantidad := (item->>'cantidad')::INTEGER;
    v_costo    := (item->>'costo_unitario')::NUMERIC;
    -- destino: 'venta' (default) | 'insumo'; cualquier otro valor → 'venta'.
    v_destino  := lower(COALESCE(NULLIF(TRIM(item->>'destino'), ''), 'venta'));
    IF v_destino NOT IN ('venta', 'insumo') THEN
      v_destino := 'venta';
    END IF;
    INSERT INTO detalle_compra (compra_id, producto_id, cantidad, costo_unitario, subtotal, destino)
    VALUES (v_compra_id, v_prod_id, v_cantidad, v_costo, v_cantidad * v_costo, v_destino);
  END LOOP;

  IF p_recibir THEN
    UPDATE compras SET recibida = true, fecha_recepcion = now()
     WHERE id = v_compra_id;
  END IF;

  RETURN jsonb_build_object(
    'compra_id', v_compra_id, 'numero', v_numero,
    'subtotal', v_subtotal, 'iva_pct', v_iva_pct, 'iva', v_iva, 'total', v_total,
    'recibida', p_recibir
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_registrar_compra(text, text, text, text, boolean, jsonb, numeric) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_registrar_compra(text, text, text, text, boolean, jsonb, numeric) TO authenticated;
