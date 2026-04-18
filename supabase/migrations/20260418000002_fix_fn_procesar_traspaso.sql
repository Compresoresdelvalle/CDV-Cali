-- ============================================================
-- FIX: fn_procesar_traspaso
--
-- Correcciones respecto a la versión anterior:
--   1. Eliminar dependencia del tipo ENUM estado_traspaso en DECLARE
--      (se usa TEXT para evitar error 42P01 si el tipo no existe)
--   2. Corregir clave JSONB: los items llegan con 'detalle_id',
--      no con 'id'
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
  v_usuario_id      UUID;
  v_estado_actual   TEXT;          -- TEXT evita dep. en ENUM estado_traspaso
  v_picker_id       UUID;
  v_sede_origen     TEXT;
  v_sede_destino    TEXT;
  v_mi_sede         TEXT;
  v_mi_rol          TEXT;
  v_item            JSONB;
  v_hay_diferencia  BOOLEAN := false;
  v_nuevo_estado    TEXT;          -- TEXT evita dep. en ENUM estado_traspaso
  v_items_sin_comp  INT;
BEGIN
  -- ── Autenticación ──────────────────────────────────────────
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- ── Leer traspaso con lock ─────────────────────────────────
  SELECT estado::TEXT, picker_id, sede_origen_id, sede_destino_id
    INTO v_estado_actual, v_picker_id, v_sede_origen, v_sede_destino
    FROM traspasos
   WHERE id = p_traspaso_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Traspaso no encontrado';
  END IF;

  -- ── Datos del usuario activo ───────────────────────────────
  SELECT sede_id, rol
    INTO v_mi_sede, v_mi_rol
    FROM usuarios
   WHERE id = v_usuario_id;

  -- ══════════════════════════════════════════════════════════
  -- ACCIÓN: iniciar_picking   borrador → picking
  -- ══════════════════════════════════════════════════════════
  IF p_accion = 'iniciar_picking' THEN

    IF v_estado_actual <> 'borrador' THEN
      RAISE EXCEPTION 'Solo se puede iniciar picking en estado Pendiente. Estado actual: %',
        v_estado_actual;
    END IF;

    UPDATE traspasos SET
      estado        = 'picking',
      picker_id     = v_usuario_id,
      fecha_picking = NOW(),
      updated_at    = NOW()
    WHERE id = p_traspaso_id;

    RETURN jsonb_build_object('ok', true, 'estado', 'picking');

  -- ══════════════════════════════════════════════════════════
  -- ACCIÓN: actualizar_items  (picker guarda progreso)
  -- p_items: [{detalle_id, cantidad_enviada, picking_completado}]
  -- ══════════════════════════════════════════════════════════
  ELSIF p_accion = 'actualizar_items' THEN

    IF v_estado_actual <> 'picking' THEN
      RAISE EXCEPTION 'Solo se puede actualizar items en estado En Picking';
    END IF;

    IF v_usuario_id <> v_picker_id THEN
      RAISE EXCEPTION 'Solo el picker asignado puede actualizar los items del picking';
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
      WHERE id          = (v_item->>'detalle_id')::UUID   -- clave correcta
        AND traspaso_id = p_traspaso_id;
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'accion', 'actualizar_items');

  -- ══════════════════════════════════════════════════════════
  -- ACCIÓN: verificar         picking → verificado
  -- ══════════════════════════════════════════════════════════
  ELSIF p_accion = 'verificar' THEN

    IF v_estado_actual <> 'picking' THEN
      RAISE EXCEPTION 'Solo se puede verificar un traspaso En Picking. Estado actual: %',
        v_estado_actual;
    END IF;

    IF v_usuario_id = v_picker_id THEN
      RAISE EXCEPTION 'El verificador no puede ser la misma persona que realizó el picking';
    END IF;

    SELECT COUNT(*) INTO v_items_sin_comp
      FROM detalle_traspaso
     WHERE traspaso_id       = p_traspaso_id
       AND picking_completado = false;

    IF v_items_sin_comp > 0 THEN
      RAISE EXCEPTION 'Hay % item(s) que no han sido completados en el picking',
        v_items_sin_comp;
    END IF;

    UPDATE traspasos SET
      estado             = 'verificado',
      verificado_por     = v_usuario_id,
      fecha_verificacion = NOW(),
      updated_at         = NOW()
    WHERE id = p_traspaso_id;

    RETURN jsonb_build_object('ok', true, 'estado', 'verificado');

  -- ══════════════════════════════════════════════════════════
  -- ACCIÓN: enviar            verificado → en_transito
  -- (trg_traspaso_salida descuenta stock origen)
  -- ══════════════════════════════════════════════════════════
  ELSIF p_accion = 'enviar' THEN

    IF v_estado_actual <> 'verificado' THEN
      RAISE EXCEPTION 'Solo se puede enviar un traspaso Verificado. Estado actual: %',
        v_estado_actual;
    END IF;

    IF EXISTS (
      SELECT 1 FROM detalle_traspaso
       WHERE traspaso_id = p_traspaso_id
         AND (cantidad_enviada IS NULL OR cantidad_enviada = 0)
    ) THEN
      RAISE EXCEPTION 'Todos los items deben tener cantidad enviada antes de enviar';
    END IF;

    UPDATE traspasos SET
      estado     = 'en_transito',
      updated_at = NOW()
    WHERE id = p_traspaso_id;

    RETURN jsonb_build_object('ok', true, 'estado', 'en_transito');

  -- ══════════════════════════════════════════════════════════
  -- ACCIÓN: recibir           en_transito → recibido / con_diferencia
  -- p_items: [{detalle_id, cantidad_recibida}]
  -- (trg_traspaso_entrada suma stock destino)
  -- ══════════════════════════════════════════════════════════
  ELSIF p_accion = 'recibir' THEN

    IF v_estado_actual <> 'en_transito' THEN
      RAISE EXCEPTION 'Solo se puede recibir un traspaso En Tránsito. Estado actual: %',
        v_estado_actual;
    END IF;

    IF v_mi_rol <> 'Admin' AND v_mi_sede <> v_sede_destino THEN
      RAISE EXCEPTION 'Solo usuarios de la sede destino (%) pueden confirmar la recepción',
        v_sede_destino;
    END IF;

    FOR v_item IN
      SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB))
    LOOP
      UPDATE detalle_traspaso SET
        cantidad_recibida = COALESCE(
                              (v_item->>'cantidad_recibida')::INTEGER, 0
                            )
      WHERE id          = (v_item->>'detalle_id')::UUID   -- clave correcta
        AND traspaso_id = p_traspaso_id;
    END LOOP;

    SELECT EXISTS(
      SELECT 1 FROM detalle_traspaso
       WHERE traspaso_id       = p_traspaso_id
         AND cantidad_recibida <> cantidad_enviada
    ) INTO v_hay_diferencia;

    v_nuevo_estado := CASE WHEN v_hay_diferencia THEN 'con_diferencia'
                           ELSE 'recibido' END;

    UPDATE traspasos SET
      estado          = v_nuevo_estado,
      recibido_por    = v_usuario_id,
      fecha_recepcion = NOW(),
      updated_at      = NOW()
    WHERE id = p_traspaso_id;

    RETURN jsonb_build_object(
      'ok',             true,
      'estado',         v_nuevo_estado,
      'hay_diferencia', v_hay_diferencia
    );

  -- ══════════════════════════════════════════════════════════
  ELSE
    RAISE EXCEPTION
      'Acción no válida: %. Opciones: iniciar_picking, actualizar_items, verificar, enviar, recibir',
      p_accion;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_procesar_traspaso(UUID, TEXT, JSONB) TO authenticated;
