-- S4-D2: fn_crear_producto — recalcular estado_stock tras insertar inventario (cantidad=0 => 'Agotado')
CREATE OR REPLACE FUNCTION public.fn_crear_producto(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT; v_id UUID;
  v_referencia TEXT;
  v_codigo_interno TEXT;
  v_proveedor_inicial TEXT;
  v_inv RECORD;
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
    vendible, stand, posicion, en_piso, ensamblable
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
    COALESCE((p_payload->>'en_piso')::BOOLEAN, FALSE),
    COALESCE((p_payload->>'ensamblable')::BOOLEAN, FALSE)
  ) RETURNING id INTO v_id;

  INSERT INTO inventario (producto_id, sede_id, cantidad)
  SELECT v_id, s.id, 0 FROM sedes s WHERE COALESCE(s.activa, TRUE) = TRUE
  ON CONFLICT DO NOTHING;

  -- S4-D2: recalcular estado_stock de las filas recién insertadas (cantidad=0 => 'Agotado')
  FOR v_inv IN SELECT sede_id FROM inventario WHERE producto_id = v_id LOOP
    PERFORM fn_actualizar_estado_stock(v_id, v_inv.sede_id);
  END LOOP;

  v_proveedor_inicial := NULLIF(TRIM(p_payload->>'proveedor_inicial'), '');
  IF v_proveedor_inicial IS NOT NULL THEN
    INSERT INTO productos_proveedores (producto_id, proveedor)
    VALUES (v_id, v_proveedor_inicial)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_id;
END $function$;
