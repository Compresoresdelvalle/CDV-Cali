-- ============================================================================
-- Bloque 8 — #31: Compras de "caja menor" (NO inventariables).
--
-- Una compra de caja menor es un gasto con CONCEPTO libre y MONTO digitado a
-- mano (el concepto varía). NO lleva productos ni mueve inventario.
--
-- Implementación: una fila en `compras` SIN `detalle_compra` (el trigger de
-- stock recorre detalle → no suma nada). Se marca con `es_caja_menor` y se
-- guarda el `concepto`. El monto digitado es el total (sin IVA).
-- ============================================================================

ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS es_caja_menor boolean NOT NULL DEFAULT false;
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS concepto text;

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

  -- Mismo gate que las compras normales.
  IF v_mi_rol NOT IN ('Admin', 'Bodeguero') THEN
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

  -- Sin detalle_compra → el trigger de stock no suma nada (no inventariable).
  -- recibida=true: es un gasto cerrado; el trigger de suma es solo en UPDATE,
  -- así que un INSERT recibida=true no dispara nada (y no hay detalle).
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
