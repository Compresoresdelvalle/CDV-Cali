-- ============================================================
-- fn_procesar_traspaso  v3
--
-- Diferencias respecto a versiones anteriores:
--   • Usa FOR v_row IN SELECT ... FOR UPDATE LOOP en lugar de
--     SELECT ... INTO ... FROM ... para evitar el error 42P01
--     que Supabase SQL Editor produce al confundir esa sintaxis
--     con SQL "SELECT INTO" (creación de tabla).
--   • Usa `:= (SELECT ...)` para asignaciones escalares.
--   • Clave JSONB correcta: 'detalle_id' en lugar de 'id'.
--   • Incluye ADD COLUMN IF NOT EXISTS para idempotencia.
-- ============================================================

-- ── Columnas nuevas (idempotentes) ───────────────────────────
ALTER TABLE traspasos
  ADD COLUMN IF NOT EXISTS picker_id     UUID REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS fecha_picking TIMESTAMPTZ;

ALTER TABLE ubicaciones
  ADD COLUMN IF NOT EXISTS prioridad_picking INTEGER NOT NULL DEFAULT 999;

-- ── Función ──────────────────────────────────────────────────
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
  v_row      RECORD;          -- fila del traspaso con FOR UPDATE
  v_mi_sede  TEXT;
  v_mi_rol   TEXT;
  v_item     JSONB;
  v_hay_diff BOOLEAN;
  v_nuevo_est TEXT;
  v_count    INT;
BEGIN
  -- ── Autenticación ─────────────────────────────────────────
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- ── Leer traspaso con FOR UPDATE mediante FOR LOOP ────────
  -- (Evita SELECT ... INTO que Supabase SQL Editor interpreta
  --  como CREATE TABLE con ese nombre)
  FOR v_row IN
    SELECT estado::TEXT AS estado,
           picker_id,
           sede_origen_id,
           sede_destino_id
      FROM traspasos
     WHERE id = p_traspaso_id
       FOR UPDATE
  LOOP

    -- Datos del usuario (asignación escalar, sin INTO)
    v_mi_sede := (SELECT sede_id    FROM usuarios WHERE id = v_uid);
    v_mi_rol  := (SELECT rol::TEXT  FROM usuarios WHERE id = v_uid);

    -- ════════════════════════════════════════════════════════
    -- ACCIÓN: iniciar_picking   borrador → picking
    -- ════════════════════════════════════════════════════════
    IF p_accion = 'iniciar_picking' THEN

      IF v_row.estado <> 'borrador' THEN
        RAISE EXCEPTION
          'Solo se puede iniciar picking en estado Pendiente. Estado actual: %',
          v_row.estado;
      END IF;

      UPDATE traspasos SET
        estado        = 'picking',
        picker_id     = v_uid,
        fecha_picking = NOW(),
        updated_at    = NOW()
      WHERE id = p_traspaso_id;

      RETURN jsonb_build_object('ok', true, 'estado', 'picking');

    -- ════════════════════════════════════════════════════════
    -- ACCIÓN: actualizar_items  (picker guarda progreso)
    -- p_items: [{detalle_id, cantidad_enviada, picking_completado}]
    -- ════════════════════════════════════════════════════════
    ELSIF p_accion = 'actualizar_items' THEN

      IF v_row.estado <> 'picking' THEN
        RAISE EXCEPTION 'Solo se puede actualizar items en estado En Picking';
      END IF;

      IF v_uid <> v_row.picker_id THEN
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

    -- ════════════════════════════════════════════════════════
    -- ACCIÓN: verificar         picking → verificado
    -- ════════════════════════════════════════════════════════
    ELSIF p_accion = 'verificar' THEN

      IF v_row.estado <> 'picking' THEN
        RAISE EXCEPTION
          'Solo se puede verificar un traspaso En Picking. Estado actual: %',
          v_row.estado;
      END IF;

      IF v_uid = v_row.picker_id THEN
        RAISE EXCEPTION
          'El verificador no puede ser la misma persona que realizó el picking';
      END IF;

      v_count := (
        SELECT COUNT(*)
          FROM detalle_traspaso
         WHERE traspaso_id       = p_traspaso_id
           AND picking_completado = false
      );

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

    -- ════════════════════════════════════════════════════════
    -- ACCIÓN: enviar            verificado → en_transito
    -- (trg_traspaso_salida descuenta stock origen)
    -- ════════════════════════════════════════════════════════
    ELSIF p_accion = 'enviar' THEN

      IF v_row.estado <> 'verificado' THEN
        RAISE EXCEPTION
          'Solo se puede enviar un traspaso Verificado. Estado actual: %',
          v_row.estado;
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

    -- ════════════════════════════════════════════════════════
    -- ACCIÓN: recibir           en_transito → recibido / con_diferencia
    -- p_items: [{detalle_id, cantidad_recibida}]
    -- (trg_traspaso_entrada suma stock destino)
    -- ════════════════════════════════════════════════════════
    ELSIF p_accion = 'recibir' THEN

      IF v_row.estado <> 'en_transito' THEN
        RAISE EXCEPTION
          'Solo se puede recibir un traspaso En Tránsito. Estado actual: %',
          v_row.estado;
      END IF;

      IF v_mi_rol <> 'Admin' AND v_mi_sede <> v_row.sede_destino_id THEN
        RAISE EXCEPTION
          'Solo usuarios de la sede destino (%) pueden confirmar la recepción',
          v_row.sede_destino_id;
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

      v_hay_diff := (
        SELECT EXISTS(
          SELECT 1 FROM detalle_traspaso
           WHERE traspaso_id       = p_traspaso_id
             AND cantidad_recibida <> cantidad_enviada
        )
      );

      v_nuevo_est := CASE WHEN v_hay_diff
                          THEN 'con_diferencia'
                          ELSE 'recibido' END;

      UPDATE traspasos SET
        estado          = v_nuevo_est,
        recibido_por    = v_uid,
        fecha_recepcion = NOW(),
        updated_at      = NOW()
      WHERE id = p_traspaso_id;

      RETURN jsonb_build_object(
        'ok',             true,
        'estado',         v_nuevo_est,
        'hay_diferencia', v_hay_diff
      );

    -- ════════════════════════════════════════════════════════
    ELSE
      RAISE EXCEPTION
        'Acción no válida: %. Opciones: iniciar_picking, actualizar_items, verificar, enviar, recibir',
        p_accion;
    END IF;

  END LOOP;

  -- Si llegamos aquí el traspaso no existe (loop nunca se ejecutó)
  RAISE EXCEPTION 'Traspaso no encontrado';
END;
$$;

GRANT EXECUTE ON FUNCTION fn_procesar_traspaso(UUID, TEXT, JSONB) TO authenticated;
