-- ============================================================================
-- Compras · categorizar cada producto comprado como VENTA o INSUMO.
--
-- Hasta ahora toda compra recibida sumaba a inventario.cantidad (stock de
-- venta). Ahora cada ítem lleva un `destino`:
--   · 'venta'  → suma a inventario.cantidad        (stock vendible)
--   · 'insumo' → suma a inventario.cantidad_insumo (stock para OT/ensambles)
--
-- El costo promedio del producto se actualiza igual en ambos casos, ponderado
-- por el stock TOTAL (venta + insumo) de todas las sedes (decisión de negocio).
-- ============================================================================

-- 1) Columna destino en el detalle (compras viejas quedan como 'venta').
ALTER TABLE public.detalle_compra
  ADD COLUMN IF NOT EXISTS destino text NOT NULL DEFAULT 'venta';

ALTER TABLE public.detalle_compra
  DROP CONSTRAINT IF EXISTS detalle_compra_destino_check;
ALTER TABLE public.detalle_compra
  ADD CONSTRAINT detalle_compra_destino_check
  CHECK (destino IN ('venta', 'insumo'));

-- 2) fn_registrar_compra: lee y guarda `destino` por ítem (default 'venta').
CREATE OR REPLACE FUNCTION public.fn_registrar_compra(
  p_sede_id text,
  p_proveedor text,
  p_factura_proveedor text DEFAULT NULL::text,
  p_observaciones text DEFAULT NULL::text,
  p_recibir boolean DEFAULT false,
  p_items jsonb DEFAULT '[]'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_usuario_id UUID;
  v_mi_sede    TEXT;
  v_mi_rol     TEXT;
  v_compra_id  UUID;
  v_numero     INT;
  item         JSONB;
  v_prod_id    UUID;
  v_cantidad   INTEGER;
  v_costo      NUMERIC;
  v_destino    TEXT;
  v_subtotal   NUMERIC := 0;
  v_iva        NUMERIC;
  v_total      NUMERIC;
BEGIN
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La compra debe tener al menos un ítem';
  END IF;

  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT sede_id, rol::TEXT INTO v_mi_sede, v_mi_rol
    FROM usuarios WHERE id = v_usuario_id;

  IF v_mi_rol NOT IN ('Admin', 'Bodeguero', 'Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar compras';
  END IF;
  IF v_mi_rol <> 'Admin' AND v_mi_sede IS DISTINCT FROM p_sede_id THEN
    RAISE EXCEPTION 'No puedes registrar compras en una sede distinta a la tuya';
  END IF;
  IF p_proveedor IS NULL OR TRIM(p_proveedor) = '' THEN
    RAISE EXCEPTION 'El proveedor es obligatorio';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_prod_id  := (item->>'producto_id')::UUID;
    v_cantidad := (item->>'cantidad')::INTEGER;
    v_costo    := (item->>'costo_unitario')::NUMERIC;
    IF v_cantidad IS NULL OR v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida para el producto %', v_prod_id;
    END IF;
    IF v_costo IS NULL OR v_costo < 0 THEN
      RAISE EXCEPTION 'Costo inválido para el producto %', v_prod_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM productos WHERE id = v_prod_id AND activo = true) THEN
      RAISE EXCEPTION 'Producto % no encontrado o inactivo', v_prod_id;
    END IF;
    v_subtotal := v_subtotal + v_cantidad * v_costo;
  END LOOP;

  v_iva   := round(v_subtotal * 0.19, 2);
  v_total := v_subtotal + v_iva;

  INSERT INTO compras (
    proveedor, registrado_por, sede_destino_id, subtotal, iva, total,
    factura_proveedor, observaciones, recibida
  ) VALUES (
    TRIM(p_proveedor), v_usuario_id, p_sede_id, v_subtotal, v_iva, v_total,
    NULLIF(TRIM(COALESCE(p_factura_proveedor, '')), ''),
    NULLIF(TRIM(COALESCE(p_observaciones, '')), ''),
    false
  ) RETURNING id, numero INTO v_compra_id, v_numero;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_prod_id  := (item->>'producto_id')::UUID;
    v_cantidad := (item->>'cantidad')::INTEGER;
    v_costo    := (item->>'costo_unitario')::NUMERIC;
    -- destino: 'venta' (default) | 'insumo'; cualquier otro valor → 'venta'.
    v_destino  := lower(COALESCE(NULLIF(TRIM(item->>'destino'), ''), 'venta'));
    IF v_destino NOT IN ('venta', 'insumo') THEN
      v_destino := 'venta';
    END IF;
    INSERT INTO detalle_compra (compra_id, producto_id, cantidad, costo_unitario, subtotal, destino)
    VALUES (v_compra_id, v_prod_id, v_cantidad, v_costo, v_cantidad * v_costo, v_destino);
  END LOOP;

  IF p_recibir THEN
    UPDATE compras SET recibida = true, fecha_recepcion = now()
     WHERE id = v_compra_id;
  END IF;

  RETURN jsonb_build_object(
    'compra_id', v_compra_id, 'numero', v_numero,
    'subtotal', v_subtotal, 'iva', v_iva, 'total', v_total,
    'recibida', p_recibir
  );
END;
$function$;

-- 3) trg_compra_sumar_stock: enruta a cantidad (venta) o cantidad_insumo
--    (insumo) según el destino del ítem. Costo promedio ponderado por stock
--    total (venta + insumo) en ambos casos.
CREATE OR REPLACE FUNCTION public.trg_compra_sumar_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_compra RECORD;
  v_det RECORD;
  v_stock_ant INTEGER;          -- stock de venta previo (sede destino)
  v_stock_insumo_ant INTEGER;   -- stock de insumo previo (sede destino)
  v_stock_global_prev INTEGER;  -- total previo (venta+insumo, todas las sedes)
BEGIN
  IF NEW.recibida = true AND (OLD.recibida = false OR OLD.recibida IS NULL) THEN
    -- Advisory lock: serializa recepciones concurrentes de la misma compra
    PERFORM pg_advisory_xact_lock(hashtext('compra:' || NEW.id::text));

    SELECT sede_destino_id, registrado_por, recibida INTO v_compra
      FROM compras WHERE id = NEW.id FOR UPDATE;

    IF v_compra.recibida IS DISTINCT FROM NEW.recibida THEN
      RETURN NEW;
    END IF;

    FOR v_det IN SELECT * FROM detalle_compra WHERE compra_id = NEW.id LOOP
      -- Asegura que exista la fila de inventario para bloquearla (anti-race,
      -- patrón F6-04).
      INSERT INTO inventario (producto_id, sede_id, cantidad)
      VALUES (v_det.producto_id, v_compra.sede_destino_id, 0)
      ON CONFLICT (producto_id, sede_id) DO NOTHING;

      SELECT COALESCE(cantidad, 0), COALESCE(cantidad_insumo, 0)
        INTO v_stock_ant, v_stock_insumo_ant
        FROM inventario
       WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id
       FOR UPDATE;

      -- Stock total previo (venta + insumo, todas las sedes) para ponderar costo
      SELECT COALESCE(SUM(cantidad + COALESCE(cantidad_insumo, 0)), 0)
        INTO v_stock_global_prev
        FROM inventario WHERE producto_id = v_det.producto_id;

      IF v_det.destino = 'insumo' THEN
        UPDATE inventario SET
          cantidad_insumo = COALESCE(inventario.cantidad_insumo, 0) + v_det.cantidad,
          ultimo_movimiento = now(), updated_at = now()
        WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id;

        INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
                                referencia_id, referencia_tipo, usuario_id)
        VALUES ('compra', v_det.producto_id, v_compra.sede_destino_id, v_det.cantidad,
                COALESCE(v_stock_insumo_ant, 0), COALESCE(v_stock_insumo_ant, 0) + v_det.cantidad,
                NEW.id, 'compra', v_compra.registrado_por);
      ELSE
        UPDATE inventario SET
          cantidad = inventario.cantidad + v_det.cantidad,
          ultimo_movimiento = now(), updated_at = now()
        WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id;

        INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
                                referencia_id, referencia_tipo, usuario_id)
        VALUES ('compra', v_det.producto_id, v_compra.sede_destino_id, v_det.cantidad,
                COALESCE(v_stock_ant, 0), COALESCE(v_stock_ant, 0) + v_det.cantidad,
                NEW.id, 'compra', v_compra.registrado_por);

        PERFORM fn_actualizar_estado_stock(v_det.producto_id, v_compra.sede_destino_id);
      END IF;

      -- Costo promedio ponderado por stock GLOBAL total (venta + insumo)
      UPDATE productos SET
        costo_promedio = CASE
          WHEN v_stock_global_prev = 0 THEN v_det.costo_unitario
          ELSE (costo_promedio * v_stock_global_prev + v_det.costo_unitario * v_det.cantidad)
               / NULLIF(v_stock_global_prev + v_det.cantidad, 0)
        END,
        updated_at = now()
      WHERE id = v_det.producto_id;
    END LOOP;

    UPDATE compras SET fecha_recepcion = COALESCE(fecha_recepcion, now()) WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;
