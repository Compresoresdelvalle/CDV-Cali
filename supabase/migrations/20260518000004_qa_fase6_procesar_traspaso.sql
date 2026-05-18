-- QA Campaña — Fase 6 (Traspasos + Picking)
--
-- Hallazgo F6-01: `fn_procesar_traspaso` no validaba rol ni sede en las
-- acciones `iniciar_picking`, `verificar` y `enviar` -> cualquier usuario
-- autenticado (incluido un Vendedor) podía manejar el ciclo de un traspaso
-- ajeno y disparar movimientos de stock.
--
-- Hallazgo F6 (cantidades): `actualizar_items` aceptaba `cantidad_enviada`
-- negativa -> `trg_traspaso_salida` haría `cantidad - (negativo)` = INFLAR el
-- stock de origen. `recibir` aceptaba `cantidad_recibida` mayor a lo enviado
-- -> `trg_traspaso_entrada` inflaba el stock de la sede destino.
--
-- Solución: cada acción valida rol Admin/Bodeguero y la sede correspondiente
-- (origen para picking/verificar/enviar, destino para recibir); se validan
-- los rangos de cantidad. La regla picker<>verificador ya estaba.

CREATE OR REPLACE FUNCTION public.fn_procesar_traspaso(p_traspaso_id uuid, p_accion text, p_items jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      UUID;
  v_estado   TEXT;
  v_picker   UUID;
  v_origen   TEXT;
  v_destino  TEXT;
  v_mi_sede  TEXT;
  v_mi_rol   TEXT;
  v_item     JSONB;
  v_hay_diff BOOLEAN;
  v_count    INT;
  v_env      INTEGER;
  v_rec      INTEGER;
  v_envia    INTEGER;
BEGIN
  -- ── Autenticación ─────────────────────────────────────────
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- ── Leer traspaso ─────────────────────────────────────────
  SELECT estado::TEXT, picker_id, sede_origen_id, sede_destino_id
    INTO v_estado, v_picker, v_origen, v_destino
    FROM traspasos
   WHERE id = p_traspaso_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Traspaso no encontrado';
  END IF;

  -- ── Datos del usuario ─────────────────────────────────────
  SELECT sede_id, rol::TEXT
    INTO v_mi_sede, v_mi_rol
    FROM usuarios
   WHERE id = v_uid;

  -- Las acciones de traspaso son exclusivas de Admin/Bodeguero.
  IF v_mi_rol NOT IN ('Admin', 'Bodeguero') THEN
    RAISE EXCEPTION 'No tienes permiso para operar traspasos (rol %)', v_mi_rol;
  END IF;

  -- ════════════════════════════════════════════════════════════
  -- ACCIÓN: iniciar_picking   borrador → picking
  -- ════════════════════════════════════════════════════════════
  IF p_accion = 'iniciar_picking' THEN

    IF v_estado <> 'borrador' THEN
      RAISE EXCEPTION
        'Solo se puede iniciar picking en estado Pendiente. Estado actual: %',
        v_estado;
    END IF;
    IF v_mi_rol <> 'Admin' AND v_mi_sede <> v_origen THEN
      RAISE EXCEPTION 'Solo personal de la sede origen (%) puede hacer picking', v_origen;
    END IF;

    UPDATE traspasos SET
      estado        = 'picking',
      picker_id     = v_uid,
      fecha_picking = NOW(),
      updated_at    = NOW()
    WHERE id = p_traspaso_id;

    RETURN jsonb_build_object('ok', true, 'estado', 'picking');

  -- ════════════════════════════════════════════════════════════
  -- ACCIÓN: actualizar_items  (picker guarda progreso)
  -- ════════════════════════════════════════════════════════════
  ELSIF p_accion = 'actualizar_items' THEN

    IF v_estado <> 'picking' THEN
      RAISE EXCEPTION 'Solo se puede actualizar items en estado En Picking';
    END IF;

    IF v_uid <> v_picker THEN
      RAISE EXCEPTION
        'Solo el picker asignado puede actualizar los items del picking';
    END IF;

    FOR v_item IN
      SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB))
    LOOP
      v_env := (v_item->>'cantidad_enviada')::INTEGER;
      IF v_env IS NOT NULL AND v_env < 0 THEN
        RAISE EXCEPTION 'cantidad_enviada no puede ser negativa (recibido %)', v_env;
      END IF;
      UPDATE detalle_traspaso SET
        cantidad_enviada   = COALESCE(v_env, cantidad_enviada),
        picking_completado = COALESCE(
                               (v_item->>'picking_completado')::BOOLEAN,
                               picking_completado
                             )
      WHERE id          = (v_item->>'detalle_id')::UUID
        AND traspaso_id = p_traspaso_id;
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'accion', 'actualizar_items');

  -- ════════════════════════════════════════════════════════════
  -- ACCIÓN: verificar         picking → verificado
  -- ════════════════════════════════════════════════════════════
  ELSIF p_accion = 'verificar' THEN

    IF v_estado <> 'picking' THEN
      RAISE EXCEPTION
        'Solo se puede verificar un traspaso En Picking. Estado actual: %',
        v_estado;
    END IF;
    IF v_mi_rol <> 'Admin' AND v_mi_sede <> v_origen THEN
      RAISE EXCEPTION 'Solo personal de la sede origen (%) puede verificar', v_origen;
    END IF;

    IF v_uid = v_picker THEN
      RAISE EXCEPTION
        'El verificador no puede ser la misma persona que realizó el picking';
    END IF;

    SELECT COUNT(*)
      INTO v_count
      FROM detalle_traspaso
     WHERE traspaso_id        = p_traspaso_id
       AND picking_completado = false;

    IF v_count > 0 THEN
      RAISE EXCEPTION
        'Hay % item(s) que no han sido completados en el picking', v_count;
    END IF;

    UPDATE traspasos SET
      estado             = 'verificado',
      verificado_por     = v_uid,
      fecha_verificacion = NOW(),
      updated_at         = NOW()
    WHERE id = p_traspaso_id;

    RETURN jsonb_build_object('ok', true, 'estado', 'verificado');

  -- ════════════════════════════════════════════════════════════
  -- ACCIÓN: enviar            verificado → en_transito
  -- ════════════════════════════════════════════════════════════
  ELSIF p_accion = 'enviar' THEN

    IF v_estado <> 'verificado' THEN
      RAISE EXCEPTION
        'Solo se puede enviar un traspaso Verificado. Estado actual: %',
        v_estado;
    END IF;
    IF v_mi_rol <> 'Admin' AND v_mi_sede <> v_origen THEN
      RAISE EXCEPTION 'Solo personal de la sede origen (%) puede enviar', v_origen;
    END IF;

    IF EXISTS (
      SELECT 1 FROM detalle_traspaso
       WHERE traspaso_id = p_traspaso_id
         AND (cantidad_enviada IS NULL OR cantidad_enviada <= 0)
    ) THEN
      RAISE EXCEPTION
        'Todos los items deben tener cantidad enviada (> 0) antes de enviar';
    END IF;

    UPDATE traspasos SET
      estado     = 'en_transito',
      updated_at = NOW()
    WHERE id = p_traspaso_id;

    RETURN jsonb_build_object('ok', true, 'estado', 'en_transito');

  -- ════════════════════════════════════════════════════════════
  -- ACCIÓN: recibir           en_transito → recibido / con_diferencia
  -- ════════════════════════════════════════════════════════════
  ELSIF p_accion = 'recibir' THEN

    IF v_estado <> 'en_transito' THEN
      RAISE EXCEPTION
        'Solo se puede recibir un traspaso En Tránsito. Estado actual: %',
        v_estado;
    END IF;

    IF v_mi_rol <> 'Admin' AND v_mi_sede <> v_destino THEN
      RAISE EXCEPTION
        'Solo usuarios de la sede destino (%) pueden confirmar la recepción',
        v_destino;
    END IF;

    FOR v_item IN
      SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB))
    LOOP
      v_rec := COALESCE((v_item->>'cantidad_recibida')::INTEGER, 0);
      SELECT cantidad_enviada INTO v_envia
        FROM detalle_traspaso
       WHERE id = (v_item->>'detalle_id')::UUID
         AND traspaso_id = p_traspaso_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Ítem de traspaso no encontrado';
      END IF;
      -- El stock en destino nunca puede superar lo que salió de origen.
      IF v_rec < 0 OR v_rec > COALESCE(v_envia, 0) THEN
        RAISE EXCEPTION
          'cantidad_recibida (%) debe estar entre 0 y lo enviado (%)',
          v_rec, COALESCE(v_envia, 0);
      END IF;
      UPDATE detalle_traspaso SET
        cantidad_recibida = v_rec
      WHERE id          = (v_item->>'detalle_id')::UUID
        AND traspaso_id = p_traspaso_id;
    END LOOP;

    SELECT EXISTS(
      SELECT 1 FROM detalle_traspaso
       WHERE traspaso_id        = p_traspaso_id
         AND cantidad_recibida <> cantidad_enviada
    ) INTO v_hay_diff;

    IF v_hay_diff THEN
      UPDATE traspasos SET
        estado          = 'con_diferencia',
        recibido_por    = v_uid,
        fecha_recepcion = NOW(),
        updated_at      = NOW()
      WHERE id = p_traspaso_id;

      RETURN jsonb_build_object(
        'ok', true, 'estado', 'con_diferencia', 'hay_diferencia', true
      );
    ELSE
      UPDATE traspasos SET
        estado          = 'recibido',
        recibido_por    = v_uid,
        fecha_recepcion = NOW(),
        updated_at      = NOW()
      WHERE id = p_traspaso_id;

      RETURN jsonb_build_object(
        'ok', true, 'estado', 'recibido', 'hay_diferencia', false
      );
    END IF;

  ELSE
    RAISE EXCEPTION
      'Acción no válida: %. Opciones: iniciar_picking, actualizar_items, verificar, enviar, recibir',
      p_accion;
  END IF;
END;
$function$;
