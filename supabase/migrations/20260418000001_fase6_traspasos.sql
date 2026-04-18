-- ============================================================
-- FASE 6: TRASPASOS + PICKING
-- Agrega picker_id / fecha_picking a traspasos,
-- prioridad_picking a ubicaciones,
-- y la función fn_procesar_traspaso que gestiona el flujo
-- de estados con validaciones de negocio.
--
-- TRIGGERS existentes (NO se reimplementan aquí):
--   trg_traspaso_salida  → verificado → en_transito (descuenta stock origen)
--   trg_traspaso_entrada → en_transito → recibido/con_diferencia (suma stock destino)
-- ============================================================

-- ── Columnas nuevas ──────────────────────────────────────────
ALTER TABLE traspasos
  ADD COLUMN IF NOT EXISTS picker_id     UUID REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS fecha_picking TIMESTAMPTZ;

ALTER TABLE ubicaciones
  ADD COLUMN IF NOT EXISTS prioridad_picking INTEGER NOT NULL DEFAULT 999;

-- ── fn_procesar_traspaso ─────────────────────────────────────
--
-- Acciones:
--   'iniciar_picking'   borrador → picking        (quien inicia = picker)
--   'actualizar_items'  sin cambio de estado       (picker guarda progreso)
--   'verificar'         picking → verificado       (picker ≠ verificador)
--   'enviar'            verificado → en_transito   (trigger sale stock)
--   'recibir'           en_transito → recibido/con_diferencia (trigger entra stock)
--
-- p_items JSONB:
--   actualizar_items: [{id, cantidad_enviada, picking_completado}]
--   recibir:          [{id, cantidad_recibida}]
-- ─────────────────────────────────────────────────────────────
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
  v_usuario_id     UUID;
  v_estado_actual  estado_traspaso;
  v_picker_id      UUID;
  v_sede_origen    TEXT;
  v_sede_destino   TEXT;
  v_mi_sede        TEXT;
  v_mi_rol         TEXT;
  v_item           JSONB;
  v_hay_diferencia BOOLEAN := false;
  v_nuevo_estado   estado_traspaso;
  v_items_sin_completar INT;
BEGIN
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- Leer estado actual con lock
  SELECT estado, picker_id, sede_origen_id, sede_destino_id
    INTO v_estado_actual, v_picker_id, v_sede_origen, v_sede_destino
    FROM traspasos
   WHERE id = p_traspaso_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Traspaso no encontrado';
  END IF;

  -- Obtener sede y rol del usuario activo
  SELECT sede_id, rol INTO v_mi_sede, v_mi_rol
    FROM usuarios
   WHERE id = v_usuario_id;

  -- ── INICIAR PICKING ─────────────────────────────────────────
  IF p_accion = 'iniciar_picking' THEN
    IF v_estado_actual <> 'borrador' THEN
      RAISE EXCEPTION 'Solo se puede iniciar picking en estado Pendiente. Estado actual: %', v_estado_actual;
    END IF;

    UPDATE traspasos SET
      estado        = 'picking',
      picker_id     = v_usuario_id,
      fecha_picking = NOW(),
      updated_at    = NOW()
    WHERE id = p_traspaso_id;

    RETURN jsonb_build_object('ok', true, 'estado', 'picking');

  -- ── ACTUALIZAR ITEMS (progreso de picking) ──────────────────
  ELSIF p_accion = 'actualizar_items' THEN
    IF v_estado_actual <> 'picking' THEN
      RAISE EXCEPTION 'Solo se puede actualizar items en estado En Picking';
    END IF;
    IF v_usuario_id <> v_picker_id THEN
      RAISE EXCEPTION 'Solo el picker asignado puede actualizar los items del picking';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB))
    LOOP
      UPDATE detalle_traspaso SET
        cantidad_enviada   = COALESCE((v_item->>'cantidad_enviada')::INTEGER, cantidad_enviada),
        picking_completado = COALESCE((v_item->>'picking_completado')::BOOLEAN, picking_completado)
      WHERE id = (v_item->>'id')::UUID
        AND traspaso_id = p_traspaso_id;
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'accion', 'actualizar_items');

  -- ── VERIFICAR ───────────────────────────────────────────────
  ELSIF p_accion = 'verificar' THEN
    IF v_estado_actual <> 'picking' THEN
      RAISE EXCEPTION 'Solo se puede verificar un traspaso en estado En Picking. Estado actual: %', v_estado_actual;
    END IF;

    -- REGLA CRÍTICA: picker ≠ verificador
    IF v_usuario_id = v_picker_id THEN
      RAISE EXCEPTION 'El verificador no puede ser la misma persona que realizó el picking';
    END IF;

    -- Todos los items deben estar picking_completado = true
    SELECT COUNT(*) INTO v_items_sin_completar
      FROM detalle_traspaso
     WHERE traspaso_id = p_traspaso_id
       AND picking_completado = false;

    IF v_items_sin_completar > 0 THEN
      RAISE EXCEPTION 'Hay % item(s) que no han sido completados en el picking', v_items_sin_completar;
    END IF;

    UPDATE traspasos SET
      estado             = 'verificado',
      verificado_por     = v_usuario_id,
      fecha_verificacion = NOW(),
      updated_at         = NOW()
    WHERE id = p_traspaso_id;

    RETURN jsonb_build_object('ok', true, 'estado', 'verificado');

  -- ── ENVIAR (verificado → en_transito) ───────────────────────
  ELSIF p_accion = 'enviar' THEN
    IF v_estado_actual <> 'verificado' THEN
      RAISE EXCEPTION 'Solo se puede enviar un traspaso Verificado. Estado actual: %', v_estado_actual;
    END IF;

    -- Validar que hay cantidad_enviada en todos los items
    IF EXISTS (
      SELECT 1 FROM detalle_traspaso
       WHERE traspaso_id = p_traspaso_id
         AND (cantidad_enviada IS NULL OR cantidad_enviada = 0)
    ) THEN
      RAISE EXCEPTION 'Todos los items deben tener cantidad enviada antes de enviar el traspaso';
    END IF;

    UPDATE traspasos SET
      estado     = 'en_transito',
      updated_at = NOW()
    WHERE id = p_traspaso_id;
    -- trg_traspaso_salida se dispara aquí y descuenta stock de sede_origen

    RETURN jsonb_build_object('ok', true, 'estado', 'en_transito');

  -- ── RECIBIR (en_transito → recibido / con_diferencia) ───────
  ELSIF p_accion = 'recibir' THEN
    IF v_estado_actual <> 'en_transito' THEN
      RAISE EXCEPTION 'Solo se puede recibir un traspaso En Tránsito. Estado actual: %', v_estado_actual;
    END IF;

    -- Validar que el usuario es de la sede destino (o Admin)
    IF v_mi_rol <> 'Admin' AND v_mi_sede <> v_sede_destino THEN
      RAISE EXCEPTION 'Solo usuarios de la sede destino (%) pueden confirmar la recepción', v_sede_destino;
    END IF;

    -- Actualizar cantidad_recibida por item
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB))
    LOOP
      UPDATE detalle_traspaso SET
        cantidad_recibida = COALESCE((v_item->>'cantidad_recibida')::INTEGER, 0)
      WHERE id = (v_item->>'id')::UUID
        AND traspaso_id = p_traspaso_id;
    END LOOP;

    -- Detectar diferencias
    SELECT EXISTS(
      SELECT 1 FROM detalle_traspaso
       WHERE traspaso_id = p_traspaso_id
         AND cantidad_recibida <> cantidad_enviada
    ) INTO v_hay_diferencia;

    v_nuevo_estado := CASE WHEN v_hay_diferencia THEN 'con_diferencia' ELSE 'recibido' END;

    UPDATE traspasos SET
      estado          = v_nuevo_estado,
      recibido_por    = v_usuario_id,
      fecha_recepcion = NOW(),
      updated_at      = NOW()
    WHERE id = p_traspaso_id;
    -- trg_traspaso_entrada se dispara aquí y suma stock en sede_destino

    RETURN jsonb_build_object(
      'ok',            true,
      'estado',        v_nuevo_estado::TEXT,
      'hay_diferencia', v_hay_diferencia
    );

  ELSE
    RAISE EXCEPTION 'Acción no válida: %. Opciones: iniciar_picking, actualizar_items, verificar, enviar, recibir', p_accion;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_procesar_traspaso(UUID, TEXT, JSONB) TO authenticated;
