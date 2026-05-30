-- ============================================================================
-- Parte 2 (rediseño de Ensambles) — A7:
--   1. productos.ensamblable: marca qué productos pueden ser RESULTADO de un
--      ensamble (se siembra true para todos los COMPRESORES; el Admin afina con
--      un check en el formulario).
--   2. trg_ensamble_stock: al completarse, además de consumir insumos y sumar el
--      resultado a `cantidad` (ya lo hacía), NOTIFICA al Admin para revisar
--      precio/costo del producto ensamblado.
--   3. fn_crear_producto: persiste `ensamblable` desde el payload.
-- ============================================================================

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS ensamblable BOOLEAN NOT NULL DEFAULT false;

UPDATE public.productos SET ensamblable = true
 WHERE categoria = 'COMPRESORES' AND ensamblable = false;

-- ── Trigger de ensamble: consumo de insumo + producción + notificación ──────
CREATE OR REPLACE FUNCTION public.trg_ensamble_stock()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_det RECORD; v_cant INTEGER; v_stock_resultado INTEGER;
  v_costo NUMERIC := 0; v_nombre_falta TEXT;
  v_prod_result TEXT; v_sede_nombre TEXT;
BEGIN
  IF NEW.completado = true AND (OLD.completado = false OR OLD.completado IS NULL) THEN
    PERFORM pg_advisory_xact_lock(hashtext('ensamble:' || NEW.id::text));
    PERFORM 1 FROM ensambles WHERE id = NEW.id FOR UPDATE;

    -- Componentes = insumos: se consumen del POOL DE INSUMO (cantidad_insumo).
    FOR v_det IN SELECT * FROM detalle_ensamble WHERE ensamble_id = NEW.id LOOP
      SELECT cantidad_insumo INTO v_cant FROM inventario
       WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_id FOR UPDATE;
      IF v_cant IS NULL OR v_cant < v_det.cantidad THEN
        SELECT nombre INTO v_nombre_falta FROM productos WHERE id = v_det.producto_id;
        RAISE EXCEPTION 'Stock de insumo insuficiente del componente "%" (necesita %, hay %). Convierte stock de venta a insumo primero.',
          COALESCE(v_nombre_falta, v_det.producto_id::text),
          v_det.cantidad, COALESCE(v_cant, 0);
      END IF;
      UPDATE inventario SET cantidad_insumo = cantidad_insumo - v_det.cantidad,
        ultimo_movimiento = now(), updated_at = now()
       WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_id;
      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id)
      VALUES ('ensamble_consumo', v_det.producto_id, NEW.sede_id, -v_det.cantidad,
        v_cant, v_cant - v_det.cantidad, NEW.id, 'ensamble', NEW.realizado_por);
      v_costo := v_costo + (v_det.costo_unitario * v_det.cantidad);
      PERFORM fn_actualizar_estado_stock(v_det.producto_id, NEW.sede_id);
    END LOOP;

    -- Producto resultante = terminado VENDIBLE: entra al stock de VENTA (cantidad).
    SELECT cantidad INTO v_stock_resultado FROM inventario
     WHERE producto_id = NEW.producto_resultado_id AND sede_id = NEW.sede_id FOR UPDATE;
    IF v_stock_resultado IS NULL THEN
      INSERT INTO inventario (producto_id, sede_id, cantidad)
      VALUES (NEW.producto_resultado_id, NEW.sede_id, NEW.cantidad_producida);
      v_stock_resultado := 0;
    ELSE
      UPDATE inventario SET cantidad = cantidad + NEW.cantidad_producida,
        ultimo_movimiento = now(), updated_at = now()
       WHERE producto_id = NEW.producto_resultado_id AND sede_id = NEW.sede_id;
    END IF;
    INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id)
    VALUES ('ensamble_produccion', NEW.producto_resultado_id, NEW.sede_id,
      NEW.cantidad_producida, v_stock_resultado, v_stock_resultado + NEW.cantidad_producida,
      NEW.id, 'ensamble', NEW.realizado_por);
    UPDATE ensambles SET costo_total = v_costo WHERE id = NEW.id;
    PERFORM fn_actualizar_estado_stock(NEW.producto_resultado_id, NEW.sede_id);

    -- Notificar al Admin para que revise precio/costo del producto ensamblado.
    SELECT nombre INTO v_prod_result FROM productos WHERE id = NEW.producto_resultado_id;
    SELECT nombre INTO v_sede_nombre FROM sedes WHERE id = NEW.sede_id;
    INSERT INTO notificaciones (tipo, titulo, mensaje, data, para_rol, created_by)
    VALUES (
      'ensamble_creado', 'Ensamble completado',
      format('Se ensamblaron %s ud(s) de "%s" en %s (costo de materiales: %s). Revisa el precio/costo del producto.',
        NEW.cantidad_producida, COALESCE(v_prod_result, NEW.producto_resultado_id::text),
        COALESCE(v_sede_nombre, NEW.sede_id), round(v_costo)),
      jsonb_build_object('producto_id', NEW.producto_resultado_id, 'producto', v_prod_result,
        'sede_id', NEW.sede_id, 'cantidad', NEW.cantidad_producida,
        'costo_materiales', v_costo, 'ensamble_id', NEW.id),
      'Admin', NEW.realizado_por
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- ── fn_crear_producto: persistir también `ensamblable` ──────────────────────
CREATE OR REPLACE FUNCTION public.fn_crear_producto(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT; v_id UUID;
  v_referencia TEXT;
  v_codigo_interno TEXT;
  v_proveedor_inicial TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'No tienes permiso para crear productos';
  END IF;

  IF COALESCE(TRIM(p_payload->>'nombre'),'') = '' THEN
    RAISE EXCEPTION 'El nombre es obligatorio';
  END IF;
  v_codigo_interno := TRIM(p_payload->>'codigo_interno');
  IF v_codigo_interno = '' OR v_codigo_interno IS NULL THEN
    RAISE EXCEPTION 'El codigo_interno es obligatorio';
  END IF;
  v_referencia := COALESCE(NULLIF(TRIM(p_payload->>'referencia'),''), v_codigo_interno);

  INSERT INTO productos (
    nombre, descripcion, referencia, codigo_interno, codigo_proveedor,
    categoria, subcategoria, marca, modelo,
    unidad_medida, precio_venta, costo_promedio,
    stock_minimo, stock_maximo, tipo, activo,
    vendible, stand, posicion, ensamblable
  ) VALUES (
    p_payload->>'nombre',
    NULLIF(TRIM(p_payload->>'descripcion'), ''),
    v_referencia,
    v_codigo_interno,
    NULLIF(TRIM(p_payload->>'codigo_proveedor'), ''),
    COALESCE(NULLIF(TRIM(p_payload->>'categoria'),''), 'General'),
    NULLIF(TRIM(p_payload->>'subcategoria'), ''),
    NULLIF(TRIM(p_payload->>'marca'), ''),
    NULLIF(TRIM(p_payload->>'modelo'), ''),
    COALESCE(NULLIF(TRIM(p_payload->>'unidad_medida'),''), 'unidad'),
    COALESCE((p_payload->>'precio_venta')::NUMERIC, 0),
    COALESCE((p_payload->>'costo_promedio')::NUMERIC, 0),
    COALESCE((p_payload->>'stock_minimo')::INT, 0),
    COALESCE((p_payload->>'stock_maximo')::INT, 0),
    COALESCE((p_payload->>'tipo')::tipo_producto, 'nuevo'),
    TRUE,
    COALESCE((p_payload->>'vendible')::BOOLEAN, TRUE),
    NULLIF(TRIM(p_payload->>'stand'), '')::SMALLINT,
    NULLIF(TRIM(p_payload->>'posicion'), '')::SMALLINT,
    COALESCE((p_payload->>'ensamblable')::BOOLEAN, FALSE)
  ) RETURNING id INTO v_id;

  INSERT INTO inventario (producto_id, sede_id, cantidad)
  SELECT v_id, s.id, 0 FROM sedes s WHERE COALESCE(s.activa, TRUE) = TRUE
  ON CONFLICT DO NOTHING;

  v_proveedor_inicial := NULLIF(TRIM(p_payload->>'proveedor_inicial'), '');
  IF v_proveedor_inicial IS NOT NULL THEN
    INSERT INTO productos_proveedores (producto_id, proveedor)
    VALUES (v_id, v_proveedor_inicial)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_id;
END $function$;
