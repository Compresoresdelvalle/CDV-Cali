-- QA Campaña — Fase 6 (Traspasos + Picking)
--
-- Hallazgo F6-03: `TraspasoNuevo.jsx` creaba el traspaso con 2 inserts NO
-- transaccionales (traspaso -> detalle) y tomaba `solicitado_por` del cliente
-- (la RLS `trasp_all` no lo validaba) -> spoofing + traspaso huérfano si el
-- insert de detalle fallaba.
--
-- Solución: RPC server-authoritative (mismo patrón que `fn_registrar_compra`).
-- `solicitado_por = auth.uid()`; valida rol/sede; crea cabecera + detalle en
-- una sola transacción.

CREATE OR REPLACE FUNCTION public.fn_crear_traspaso(
  p_sede_origen text,
  p_sede_destino text,
  p_tipo text DEFAULT 'normal',
  p_observaciones text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid         UUID;
  v_mi_sede     TEXT;
  v_mi_rol      TEXT;
  v_traspaso_id UUID;
  v_numero      INT;
  item          JSONB;
  v_prod_id     UUID;
  v_cant        INTEGER;
BEGIN
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El traspaso debe tener al menos un ítem';
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT sede_id, rol::TEXT INTO v_mi_sede, v_mi_rol
    FROM usuarios WHERE id = v_uid;

  IF v_mi_rol NOT IN ('Admin', 'Bodeguero') THEN
    RAISE EXCEPTION 'No tienes permiso para crear traspasos';
  END IF;
  IF v_mi_rol <> 'Admin' AND v_mi_sede IS DISTINCT FROM p_sede_origen THEN
    RAISE EXCEPTION 'Solo puedes crear traspasos desde tu propia sede';
  END IF;
  IF p_sede_origen = p_sede_destino THEN
    RAISE EXCEPTION 'La sede origen y destino no pueden ser la misma';
  END IF;

  -- Validar items antes de insertar nada.
  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_prod_id := (item->>'producto_id')::UUID;
    v_cant    := (item->>'cantidad_solicitada')::INTEGER;
    IF v_cant IS NULL OR v_cant <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida para el producto %', v_prod_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM productos WHERE id = v_prod_id AND activo = true) THEN
      RAISE EXCEPTION 'Producto % no encontrado o inactivo', v_prod_id;
    END IF;
  END LOOP;

  INSERT INTO traspasos (
    sede_origen_id, sede_destino_id, solicitado_por, observaciones, estado, tipo
  ) VALUES (
    p_sede_origen, p_sede_destino, v_uid,
    NULLIF(TRIM(COALESCE(p_observaciones, '')), ''),
    'borrador', p_tipo::tipo_traspaso
  ) RETURNING id, numero INTO v_traspaso_id, v_numero;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO detalle_traspaso (
      traspaso_id, producto_id, cantidad_solicitada,
      cantidad_enviada, cantidad_recibida, picking_completado
    ) VALUES (
      v_traspaso_id, (item->>'producto_id')::UUID,
      (item->>'cantidad_solicitada')::INTEGER, 0, 0, false
    );
  END LOOP;

  RETURN jsonb_build_object('traspaso_id', v_traspaso_id, 'numero', v_numero);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_crear_traspaso(text,text,text,text,jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_crear_traspaso(text,text,text,text,jsonb) TO authenticated;
