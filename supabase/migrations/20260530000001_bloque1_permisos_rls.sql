-- ============================================================================
-- Bloque 1 — Permisos y roles (parte 1: RLS + funciones)  #3, #4, #6
-- Rama: fix/correcciones-post-deploy
-- Aditiva y reversible (ver supabase/backups/20260530_bloque1_permisos_RESTORE.sql).
-- Aplicada vía MCP apply_migration sobre PRODUCCIÓN.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- #3  Inventario global + vender desde cualquier sede
-- ─────────────────────────────────────────────────────────────────────────

-- Ver TODO el inventario de todas las sedes (la escritura sigue bloqueada a
-- Admin por inv_modify_block, que NO se toca).
ALTER POLICY inv_select ON public.inventario
  USING (true);

-- Insertar venta: cualquier Admin/Vendedor (sin atar a su sede).
ALTER POLICY ventas_insert ON public.ventas
  WITH CHECK ((SELECT get_my_rol()) = ANY (ARRAY['Admin', 'Vendedor']));

-- Ver ventas: Admin todo; el vendedor ve LAS SUYAS (de cualquier sede) +
-- las de su sede.
ALTER POLICY ventas_select ON public.ventas
  USING (
    (SELECT get_my_rol()) = 'Admin'
    OR vendedor_id = (SELECT auth.uid())
    OR sede_id = (SELECT get_my_sede_id())
  );

-- Detalle de venta: ver el detalle de mis ventas aunque sean de otra sede.
ALTER POLICY dv_select ON public.detalle_venta
  USING (EXISTS (
    SELECT 1 FROM ventas v
    WHERE v.id = detalle_venta.venta_id
      AND ((SELECT get_my_rol()) = 'Admin'
           OR v.vendedor_id = (SELECT auth.uid())
           OR v.sede_id = (SELECT get_my_sede_id()))
  ));

-- Escribir detalle de mis ventas (cualquier sede): se identifica por vendedor_id.
ALTER POLICY dv_write ON public.detalle_venta
  USING (EXISTS (
    SELECT 1 FROM ventas v
    WHERE v.id = detalle_venta.venta_id
      AND ((SELECT get_my_rol()) = 'Admin' OR v.vendedor_id = (SELECT auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM ventas v
    WHERE v.id = detalle_venta.venta_id
      AND ((SELECT get_my_rol()) = 'Admin' OR v.vendedor_id = (SELECT auth.uid()))
  ));

-- fn_registrar_venta (SECURITY DEFINER → bypassa RLS): se QUITA el bloqueo de
-- sede y se reemplaza por un gate de rol (la RLS no aplica dentro del DEFINER).
CREATE OR REPLACE FUNCTION public.fn_registrar_venta(
  p_sede_id text,
  p_cliente_nombre text DEFAULT NULL::text,
  p_cliente_nit text DEFAULT NULL::text,
  p_metodo_pago text DEFAULT 'Efectivo'::text,
  p_descuento_pct numeric DEFAULT 0,
  p_observaciones text DEFAULT NULL::text,
  p_items jsonb DEFAULT '[]'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vendedor_id UUID;
  v_mi_sede     TEXT;
  v_mi_rol      TEXT;
  v_venta_id    UUID;
  v_numero      INT;
  item          JSONB;
  v_prod_id     UUID;
  v_cantidad    NUMERIC;
  v_precio      NUMERIC;
  v_costo       NUMERIC;
BEGIN
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta debe tener al menos un ítem';
  END IF;

  v_vendedor_id := auth.uid();
  IF v_vendedor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT sede_id, rol::TEXT INTO v_mi_sede, v_mi_rol
    FROM usuarios WHERE id = v_vendedor_id;

  -- Bloque 1 (#3): el Vendedor vende desde cualquier sede. Antes había un
  -- bloqueo por sede; ahora solo se exige un rol con permiso de venta.
  IF v_mi_rol IS NULL OR v_mi_rol NOT IN ('Admin', 'Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar ventas (rol %)', COALESCE(v_mi_rol, 'desconocido');
  END IF;

  INSERT INTO ventas (
    vendedor_id, sede_id, cliente_nombre, cliente_nit,
    metodo_pago, descuento_pct, iva_pct, observaciones, subtotal, total
  ) VALUES (
    v_vendedor_id, p_sede_id, p_cliente_nombre, p_cliente_nit,
    p_metodo_pago, p_descuento_pct, 19, p_observaciones, 0, 0
  )
  RETURNING id, numero INTO v_venta_id, v_numero;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id  := (item->>'producto_id')::UUID;
    v_cantidad := (item->>'cantidad')::NUMERIC;

    IF v_cantidad IS NULL OR v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida para el producto %', v_prod_id;
    END IF;

    SELECT precio_venta, COALESCE(costo_promedio, 0)
      INTO v_precio, v_costo
      FROM productos WHERE id = v_prod_id AND activo = true;

    IF v_precio IS NULL THEN
      RAISE EXCEPTION 'Producto % no encontrado o inactivo', v_prod_id;
    END IF;

    INSERT INTO detalle_venta (
      venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal
    ) VALUES (
      v_venta_id, v_prod_id, v_cantidad, v_precio, v_costo, v_cantidad * v_precio
    );
  END LOOP;

  RETURN (
    SELECT jsonb_build_object(
      'venta_id', v.id, 'numero', v.numero, 'total', v.total, 'fecha', v.fecha
    ) FROM ventas v WHERE v.id = v_venta_id
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- #4  Crear/editar/eliminar productos = SOLO Admin
-- ─────────────────────────────────────────────────────────────────────────

-- prod_modify cubría Admin+Bodeguero (INSERT/UPDATE/DELETE) → solo Admin.
ALTER POLICY prod_modify ON public.productos
  USING ((SELECT get_my_rol()) = 'Admin')
  WITH CHECK ((SELECT get_my_rol()) = 'Admin');

-- fn_crear_producto (SECURITY DEFINER): gate de rol → solo Admin.
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT INTO v_rol FROM usuarios WHERE id = v_uid;
  -- Bloque 1 (#4): crear producto pasa a ser exclusivo de Admin.
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
    stock_minimo, stock_maximo, tipo, activo
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
    TRUE
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

-- ─────────────────────────────────────────────────────────────────────────
-- #6  Vendedor en OT y Traslados
-- ─────────────────────────────────────────────────────────────────────────

-- OT: el vendedor puede CREAR órdenes en su sede (además de Admin/Tecnico).
ALTER POLICY os_insert ON public.ordenes_servicio
  WITH CHECK (
    ((SELECT get_my_rol()) = ANY (ARRAY['Admin', 'Tecnico', 'Vendedor']))
    AND ((SELECT get_my_rol()) = 'Admin' OR sede_id = (SELECT get_my_sede_id()))
  );

-- OT: el vendedor gestiona (edita) las OT no entregadas de su sede, como un
-- técnico. Borrar NO (no hay policy de DELETE → sigue vetado para todos).
ALTER POLICY os_update ON public.ordenes_servicio
  USING (
    estado <> 'entregada'::estado_orden
    AND (
      (SELECT get_my_rol()) = 'Admin'
      OR tecnico_id = (SELECT auth.uid())
      OR ((SELECT get_my_rol()) = 'Vendedor' AND sede_id = (SELECT get_my_sede_id()))
    )
  )
  WITH CHECK (
    (SELECT get_my_rol()) = 'Admin'
    OR (tecnico_id = (SELECT auth.uid()) AND sede_id = (SELECT get_my_sede_id()))
    OR ((SELECT get_my_rol()) = 'Vendedor' AND sede_id = (SELECT get_my_sede_id()))
  );

-- Traslados: el vendedor puede CREAR traslados (desde su propia sede origen).
CREATE OR REPLACE FUNCTION public.fn_crear_traspaso(
  p_sede_origen text,
  p_sede_destino text,
  p_tipo text DEFAULT 'normal'::text,
  p_observaciones text DEFAULT NULL::text,
  p_items jsonb DEFAULT '[]'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid         UUID;
  v_mi_sede     TEXT;
  v_mi_rol      TEXT;
  v_traspaso_id UUID;
  v_numero      INT;
  item          JSONB;
  v_prod_id     UUID;
  v_cant        INTEGER;
BEGIN
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El traspaso debe tener al menos un ítem';
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT sede_id, rol::TEXT INTO v_mi_sede, v_mi_rol
    FROM usuarios WHERE id = v_uid;

  -- Bloque 1 (#6): se añade Vendedor a los roles que pueden crear traslados.
  IF v_mi_rol NOT IN ('Admin', 'Bodeguero', 'Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para crear traspasos';
  END IF;
  IF v_mi_rol <> 'Admin' AND v_mi_sede IS DISTINCT FROM p_sede_origen THEN
    RAISE EXCEPTION 'Solo puedes crear traspasos desde tu propia sede';
  END IF;
  IF p_sede_origen = p_sede_destino THEN
    RAISE EXCEPTION 'La sede origen y destino no pueden ser la misma';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_prod_id := (item->>'producto_id')::UUID;
    v_cant    := (item->>'cantidad_solicitada')::INTEGER;
    IF v_cant IS NULL OR v_cant <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida para el producto %', v_prod_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM productos WHERE id = v_prod_id AND activo = true) THEN
      RAISE EXCEPTION 'Producto % no encontrado o inactivo', v_prod_id;
    END IF;
  END LOOP;

  INSERT INTO traspasos (
    sede_origen_id, sede_destino_id, solicitado_por, observaciones, estado, tipo
  ) VALUES (
    p_sede_origen, p_sede_destino, v_uid,
    NULLIF(TRIM(COALESCE(p_observaciones, '')), ''),
    'borrador', p_tipo::tipo_traspaso
  ) RETURNING id, numero INTO v_traspaso_id, v_numero;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO detalle_traspaso (
      traspaso_id, producto_id, cantidad_solicitada,
      cantidad_enviada, cantidad_recibida, picking_completado
    ) VALUES (
      v_traspaso_id, (item->>'producto_id')::UUID,
      (item->>'cantidad_solicitada')::INTEGER, 0, 0, false
    );
  END LOOP;

  RETURN jsonb_build_object('traspaso_id', v_traspaso_id, 'numero', v_numero);
END;
$function$;

-- Traslados: el vendedor puede OPERAR todo el flujo (picking, verificar,
-- enviar, recibir). Las validaciones internas por sede ya restringen cada
-- acción a la sede correcta (origen para enviar, destino para recibir).
CREATE OR REPLACE FUNCTION public.fn_procesar_traspaso(
  p_traspaso_id uuid,
  p_accion text,
  p_items jsonb DEFAULT NULL::jsonb
)
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
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT estado::TEXT, picker_id, sede_origen_id, sede_destino_id
    INTO v_estado, v_picker, v_origen, v_destino
    FROM traspasos
   WHERE id = p_traspaso_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Traspaso no encontrado';
  END IF;

  SELECT sede_id, rol::TEXT
    INTO v_mi_sede, v_mi_rol
    FROM usuarios
   WHERE id = v_uid;

  -- Bloque 1 (#6): se añade Vendedor a los roles que operan traslados.
  IF v_mi_rol NOT IN ('Admin', 'Bodeguero', 'Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para operar traspasos (rol %)', v_mi_rol;
  END IF;

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
