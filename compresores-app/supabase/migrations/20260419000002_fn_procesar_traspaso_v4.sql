-- ============================================================
-- fn_procesar_traspaso  v4
--
-- Fix respecto a v2/v3:
--   • En la acción 'recibir', el UPDATE de estado usaba una
--     variable TEXT (v_nuevo_estado) para asignar a la columna
--     ENUM estado_traspaso. PostgreSQL NO realiza cast implícito
--     TEXT→ENUM para variables PL/pgSQL (sí lo hace con literales).
--     Solución: dos ramas IF/ELSE con literales de string directos
--     en lugar de una variable TEXT intermediaria.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_procesar_traspaso(
  p_traspaso_id UUID,
  p_accion      TEXT,
  p_items       JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  -- ── Autenticación ─────────────────────────────────────────
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- ── Leer traspaso (SELECT INTO con cast explícito a TEXT) ─
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

  -- ════════════════════════════════════════════════════════════
  -- ACCIÓN: iniciar_picking   borrador → picking
  -- ════════════════════════════════════════════════════════════
  IF p_accion = 'iniciar_picking' THEN

    IF v_estado <> 'borrador' THEN
      RAISE EXCEPTION
        'Solo se puede iniciar picking en estado Pendiente. Estado actual: %',
        v_estado;
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
  -- p_items: [{detalle_id, cantidad_enviada, picking_completado}]
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
      UPDATE detalle_traspaso SET
        cantidad_enviada   = COALESCE(
                               (v_item->>'cantidad_enviada')::INTEGER,
                               cantidad_enviada
                             ),
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

    IF v_uid = v_picker THEN
      RAISE EXCEPTION
        'El verificador no puede ser la misma persona que realizó el picking';
    END IF;

    SELECT COUNT(*)
      INTO v_count
      FROM detalle_traspaso
     WHERE traspaso_id       = p_traspaso_id
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

    IF EXISTS (
      SELECT 1 FROM detalle_traspaso
       WHERE traspaso_id = p_traspaso_id
         AND (cantidad_enviada IS NULL OR cantidad_enviada = 0)
    ) THEN
      RAISE EXCEPTION
        'Todos los items deben tener cantidad enviada antes de enviar';
    END IF;

    UPDATE traspasos SET
      estado     = 'en_transito',
      updated_at = NOW()
    WHERE id = p_traspaso_id;

    RETURN jsonb_build_object('ok', true, 'estado', 'en_transito');

  -- ════════════════════════════════════════════════════════════
  -- ACCIÓN: recibir           en_transito → recibido / con_diferencia
  -- p_items: [{detalle_id, cantidad_recibida}]
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
      UPDATE detalle_traspaso SET
        cantidad_recibida = COALESCE(
                              (v_item->>'cantidad_recibida')::INTEGER, 0
                            )
      WHERE id          = (v_item->>'detalle_id')::UUID
        AND traspaso_id = p_traspaso_id;
    END LOOP;

    -- Detectar diferencias entre enviado y recibido
    SELECT EXISTS(
      SELECT 1 FROM detalle_traspaso
       WHERE traspaso_id       = p_traspaso_id
         AND cantidad_recibida <> cantidad_enviada
    ) INTO v_hay_diff;

    -- FIX: usar literales de string en lugar de variable TEXT
    -- para evitar error de cast implícito TEXT→ENUM en PostgreSQL
    IF v_hay_diff THEN
      UPDATE traspasos SET
        estado          = 'con_diferencia',
        recibido_por    = v_uid,
        fecha_recepcion = NOW(),
        updated_at      = NOW()
      WHERE id = p_traspaso_id;

      RETURN jsonb_build_object(
        'ok',             true,
        'estado',         'con_diferencia',
        'hay_diferencia', true
      );
    ELSE
      UPDATE traspasos SET
        estado          = 'recibido',
        recibido_por    = v_uid,
        fecha_recepcion = NOW(),
        updated_at      = NOW()
      WHERE id = p_traspaso_id;

      RETURN jsonb_build_object(
        'ok',             true,
        'estado',         'recibido',
        'hay_diferencia', false
      );
    END IF;

  -- ════════════════════════════════════════════════════════════
  ELSE
    RAISE EXCEPTION
      'Acción no válida: %. Opciones: iniciar_picking, actualizar_items, verificar, enviar, recibir',
      p_accion;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_procesar_traspaso(UUID, TEXT, JSONB) TO authenticated;
