-- ============================================================================
-- Bloque 9 · #35 — Conteo cíclico "por bodega".
--
-- Hasta ahora fn_registrar_conteo derivaba la sede SIEMPRE del usuario que
-- llama, así que solo se podía contar la propia sede. Se añade p_sede_id:
--   · Admin    → puede contar CUALQUIER sede (la que mande p_sede_id).
--   · Bodeguero → queda forzado a su propia sede (se ignora p_sede_id).
--
-- Se hace DROP del overload de 3 argumentos para evitar ambigüedad de firmas
-- y se recrea con 4 argumentos. DROP+CREATE pierde los GRANT, así que se
-- vuelven a otorgar a authenticated y service_role (como estaban).
-- ============================================================================

DROP FUNCTION IF EXISTS public.fn_registrar_conteo(uuid, integer, text);

CREATE OR REPLACE FUNCTION public.fn_registrar_conteo(
  p_producto_id uuid,
  p_stock_fisico integer,
  p_observaciones text DEFAULT NULL::text,
  p_sede_id text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     UUID := auth.uid();
  v_rol     TEXT;
  v_mi_sede TEXT;
  v_sede    TEXT;   -- sede que efectivamente se cuenta (resuelta)
  v_inv     RECORD;
  v_conteo_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no_session';
  END IF;
  IF p_stock_fisico IS NULL OR p_stock_fisico < 0 THEN
    RAISE EXCEPTION 'Stock físico inválido';
  END IF;

  SELECT rol::TEXT, sede_id INTO v_rol, v_mi_sede
    FROM usuarios WHERE id = v_uid;
  IF v_rol NOT IN ('Admin', 'Bodeguero') THEN
    RAISE EXCEPTION 'Solo Admin o Bodeguero pueden registrar conteos';
  END IF;

  -- #35: el Admin elige la sede a contar; el Bodeguero siempre la suya.
  IF v_rol = 'Admin' THEN
    v_sede := COALESCE(NULLIF(TRIM(p_sede_id), ''), v_mi_sede);
  ELSE
    v_sede := v_mi_sede;
  END IF;

  IF v_sede IS NULL THEN
    RAISE EXCEPTION 'No hay sede para el conteo (selecciona una o asigna sede al usuario)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sedes WHERE id = v_sede) THEN
    RAISE EXCEPTION 'La sede % no existe', v_sede;
  END IF;

  -- Lock inventario y leer stock_sistema en el momento del insert (anti-race)
  SELECT id, cantidad INTO v_inv
    FROM inventario
   WHERE producto_id = p_producto_id AND sede_id = v_sede
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este producto no tiene inventario en la sede %', v_sede;
  END IF;

  INSERT INTO conteos (
    inventario_id, producto_id, sede_id,
    stock_sistema, stock_fisico,
    contado_por, observaciones, ajuste_aplicado
  )
  VALUES (
    v_inv.id, p_producto_id, v_sede,
    v_inv.cantidad, p_stock_fisico,
    v_uid, NULLIF(TRIM(p_observaciones), ''), false
  )
  RETURNING id INTO v_conteo_id;

  RETURN jsonb_build_object(
    'ok', true,
    'conteo_id', v_conteo_id,
    'sede_id', v_sede,
    'stock_sistema', v_inv.cantidad,
    'stock_fisico', p_stock_fisico,
    'diferencia', p_stock_fisico - v_inv.cantidad
  );
END;
$function$;

-- Restaurar la postura de la función original: solo authenticated/service_role.
-- El DROP+CREATE reintroduce el grant por defecto de Supabase a PUBLIC/anon;
-- lo revocamos (la función ya exige auth.uid(), pero no debe ser callable por anon).
REVOKE EXECUTE ON FUNCTION public.fn_registrar_conteo(uuid, integer, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_registrar_conteo(uuid, integer, text, text)
  TO authenticated, service_role;
