-- Paso 9 (parte 2) — TRASPASOS-01 (MEDIA): cancelar traspaso idempotente/consistente
--
-- fn_cancelar_traspaso revertía stock al origen asumiendo que estado='en_transito' implica
-- que el stock salió. En el flujo normal eso es cierto (RLS bloquea UPDATE directo de
-- traspasos; en_transito solo se alcanza por fn_procesar_traspaso 'enviar', que dispara
-- trg_traspaso_salida). Pero la función confiaba en el estado en vez de en el ledger.
--
-- Fix (defensa en profundidad): revertir un ítem SOLO si existe el movimiento 'traspaso_salida'
-- que pruebe que esa cantidad realmente salió del origen para este traspaso. Si no salió, no
-- se revierte → nunca crea stock fantasma, sea cual sea el camino por el que llegó a en_transito.

create or replace function public.fn_cancelar_traspaso(p_traspaso_id uuid, p_motivo text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
  IF v_estado IN ('recibido', 'con_diferencia') THEN
    RAISE EXCEPTION 'No se puede cancelar un traspaso ya recibido (estado %)', v_estado;
  END IF;

  IF v_estado = 'en_transito' THEN
    PERFORM pg_advisory_xact_lock(hashtext('traspaso:' || p_traspaso_id::text));
    FOR v_det IN SELECT * FROM detalle_traspaso WHERE traspaso_id = p_traspaso_id LOOP
      v_devolver := COALESCE(v_det.cantidad_enviada, v_det.cantidad_solicitada);
      IF v_devolver IS NULL OR v_devolver <= 0 THEN
        CONTINUE;
      END IF;

      -- TRASPASOS-01: solo revertir si el stock REALMENTE salió (existe el movimiento de
      -- salida de este traspaso para este producto en el origen). Evita stock fantasma.
      IF NOT EXISTS (
        SELECT 1 FROM movimientos
         WHERE referencia_id = p_traspaso_id
           AND referencia_tipo = 'traspaso'
           AND tipo = 'traspaso_salida'
           AND producto_id = v_det.producto_id
           AND sede_id = v_origen
      ) THEN
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
        referencia_id, referencia_tipo, usuario_id, observaciones
      ) VALUES (
        'ajuste', v_det.producto_id, v_origen, v_devolver,
        v_stock, v_stock + v_devolver, p_traspaso_id, 'traspaso', v_uid,
        'Reversa por cancelación de traspaso en tránsito'
      );
      PERFORM fn_actualizar_estado_stock(v_det.producto_id, v_origen);
      v_revertido := true;
    END LOOP;
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
