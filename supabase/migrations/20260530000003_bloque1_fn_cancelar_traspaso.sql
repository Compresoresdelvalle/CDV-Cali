-- ============================================================================
-- Bloque 1 — #5 Cancelar traspaso (parte 2b: validador de transición + función)
-- Solo Admin. Solo si NO está recibido. Si el stock ya salió de origen
-- (estado en_transito) se devuelve al origen.
-- Requiere que 20260530000002 (valor 'cancelado') ya esté aplicada y commiteada.
-- ============================================================================

-- 1) Permitir la transición  (no recibido) -> cancelado  en el validador.
CREATE OR REPLACE FUNCTION public.trg_traspaso_validar_transicion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.estado = NEW.estado THEN RETURN NEW; END IF;

  IF NOT (
    (OLD.estado = 'borrador'    AND NEW.estado = 'picking') OR
    (OLD.estado = 'picking'     AND NEW.estado = 'verificado') OR
    (OLD.estado = 'verificado'  AND NEW.estado = 'en_transito') OR
    (OLD.estado = 'en_transito' AND NEW.estado IN ('recibido', 'con_diferencia')) OR
    -- Bloque 1 (#5): cancelación por Admin desde cualquier estado no recibido.
    (OLD.estado IN ('borrador', 'picking', 'verificado', 'en_transito')
       AND NEW.estado = 'cancelado')
  ) THEN
    RAISE EXCEPTION 'Transición de estado de traspaso inválida: % -> %', OLD.estado, NEW.estado;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) Función de cancelación.
CREATE OR REPLACE FUNCTION public.fn_cancelar_traspaso(
  p_traspaso_id uuid,
  p_motivo text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid      UUID;
  v_rol      TEXT;
  v_estado   TEXT;
  v_origen   TEXT;
  v_det      RECORD;
  v_stock    INTEGER;
  v_devolver INTEGER;
  v_revertido BOOLEAN := false;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT rol::TEXT INTO v_rol FROM usuarios WHERE id = v_uid;
  -- #5: cancelar es exclusivo de Admin.
  IF v_rol IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Solo un Admin puede cancelar traspasos';
  END IF;

  SELECT estado::TEXT, sede_origen_id
    INTO v_estado, v_origen
    FROM traspasos
   WHERE id = p_traspaso_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Traspaso no encontrado';
  END IF;

  IF v_estado = 'cancelado' THEN
    RAISE EXCEPTION 'El traspaso ya está cancelado';
  END IF;
  -- "Recibido" = el stock ya entró a destino → no se puede cancelar.
  IF v_estado IN ('recibido', 'con_diferencia') THEN
    RAISE EXCEPTION 'No se puede cancelar un traspaso ya recibido (estado %)', v_estado;
  END IF;

  -- Si el stock YA salió del origen (en_transito) se devuelve al origen.
  IF v_estado = 'en_transito' THEN
    PERFORM pg_advisory_xact_lock(hashtext('traspaso:' || p_traspaso_id::text));
    FOR v_det IN SELECT * FROM detalle_traspaso WHERE traspaso_id = p_traspaso_id LOOP
      v_devolver := COALESCE(v_det.cantidad_enviada, v_det.cantidad_solicitada);
      IF v_devolver IS NULL OR v_devolver <= 0 THEN
        CONTINUE;
      END IF;
      SELECT cantidad INTO v_stock
        FROM inventario
       WHERE producto_id = v_det.producto_id AND sede_id = v_origen
        FOR UPDATE;
      v_stock := COALESCE(v_stock, 0);
      INSERT INTO inventario (producto_id, sede_id, cantidad)
      VALUES (v_det.producto_id, v_origen, v_devolver)
      ON CONFLICT (producto_id, sede_id) DO UPDATE SET
        cantidad          = inventario.cantidad + v_devolver,
        ultimo_movimiento = now(),
        updated_at        = now();
      INSERT INTO movimientos (
        tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id
      ) VALUES (
        'ajuste', v_det.producto_id, v_origen, v_devolver,
        v_stock, v_stock + v_devolver, p_traspaso_id, 'traspaso', v_uid
      );
      PERFORM fn_actualizar_estado_stock(v_det.producto_id, v_origen);
    END LOOP;
    v_revertido := true;
  END IF;

  UPDATE traspasos SET
    estado        = 'cancelado',
    observaciones = NULLIF(TRIM(BOTH FROM
                      COALESCE(observaciones, '')
                      || CASE
                           WHEN COALESCE(TRIM(p_motivo), '') <> ''
                             THEN ' | Cancelado por Admin: ' || TRIM(p_motivo)
                           ELSE ' | Cancelado por Admin'
                         END
                    ), ''),
    updated_at    = now()
  WHERE id = p_traspaso_id;

  RETURN jsonb_build_object(
    'ok', true,
    'estado', 'cancelado',
    'stock_revertido', v_revertido
  );
END;
$function$;

-- Defensa en profundidad: solo authenticated puede invocarla (la función ya
-- valida Admin internamente; anon quedaría bloqueado por auth.uid() NULL).
REVOKE EXECUTE ON FUNCTION public.fn_cancelar_traspaso(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cancelar_traspaso(uuid, text) TO authenticated;
