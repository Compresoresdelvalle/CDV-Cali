-- ============================================================================
-- Herramientas inventariables — ciclo insumo ⇄ herramienta (préstamo de 1 ciclo)
--
-- Una herramienta puede crearse de dos formas:
--   1. DESDE INSUMOS (inventariable): se toma 1 unidad del stock de insumo de
--      la sede (cantidad_insumo − 1) y queda vinculada al producto vía
--      `producto_id`. Al "Marcar devuelta" la unidad REGRESA al stock de insumo
--      (cantidad_insumo + 1) y la herramienta se retira (activo = false).
--   2. MANUAL (no inventariable): texto libre, `producto_id` NULL, sin tocar
--      stock — comportamiento clásico (devuelta = vuelve a 'disponible').
--
-- Las operaciones de stock van por funciones SECURITY DEFINER con FOR UPDATE y
-- registran `movimientos` (append-only), calcando fn_convertir_a_insumo.
-- El movimiento usa tipo 'ajuste' + referencia_tipo='herramienta' para no
-- tocar el enum tipo_movimiento ni la Auditoría; la trazabilidad va por
-- referencia_id (= id de la herramienta).
-- ============================================================================

-- 1 ─ Columnas nuevas en herramientas_prestamo
ALTER TABLE public.herramientas_prestamo
  ADD COLUMN IF NOT EXISTS producto_id uuid REFERENCES public.productos(id),
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_herramientas_prestamo_producto
  ON public.herramientas_prestamo (producto_id) WHERE producto_id IS NOT NULL;

-- 2 ─ Crear herramienta DESDE INSUMOS (Admin) — insumo −1
CREATE OR REPLACE FUNCTION public.fn_crear_herramienta_desde_insumo(
  p_producto_id uuid,
  p_sede_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rol text;
  v_insumo_ant int;
  v_insumo_post int;
  v_nombre text;
  v_codigo text;
  v_herr_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::text INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Solo el Admin puede crear herramientas';
  END IF;

  SELECT nombre, COALESCE(NULLIF(TRIM(codigo_interno), ''), referencia)
    INTO v_nombre, v_codigo
    FROM productos WHERE id = p_producto_id AND activo = true;
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado o inactivo';
  END IF;

  -- Lock de la fila de inventario de insumo en la sede
  SELECT cantidad_insumo INTO v_insumo_ant
    FROM inventario
   WHERE producto_id = p_producto_id AND sede_id = p_sede_id
   FOR UPDATE;
  IF NOT FOUND OR v_insumo_ant IS NULL OR v_insumo_ant < 1 THEN
    RAISE EXCEPTION 'No hay stock de insumo disponible en la sede %', p_sede_id;
  END IF;

  v_insumo_post := v_insumo_ant - 1;
  UPDATE inventario
     SET cantidad_insumo = v_insumo_post,
         ultimo_movimiento = now(), updated_at = now()
   WHERE producto_id = p_producto_id AND sede_id = p_sede_id;

  INSERT INTO herramientas_prestamo (
    herramienta_nombre, herramienta_codigo, sede_id, estado, producto_id, activo
  ) VALUES (
    v_nombre, v_codigo, p_sede_id, 'disponible', p_producto_id, true
  ) RETURNING id INTO v_herr_id;

  INSERT INTO movimientos (
    tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_tipo, referencia_id, usuario_id, observaciones
  ) VALUES (
    'ajuste', p_producto_id, p_sede_id, -1, v_insumo_ant, v_insumo_post,
    'herramienta', v_herr_id, v_uid,
    format('Insumo → herramienta: "%s" salió del stock de insumo', v_nombre)
  );

  PERFORM fn_actualizar_estado_stock(p_producto_id, p_sede_id);

  RETURN jsonb_build_object(
    'herramienta_id', v_herr_id, 'producto_id', p_producto_id,
    'sede_id', p_sede_id, 'cantidad_insumo', v_insumo_post, 'inventariable', true
  );
END $function$;

-- 3 ─ Devolver herramienta (Admin o misma sede)
--     · Inventariable (producto_id IS NOT NULL): insumo +1 y retiro (activo=false).
--     · Manual: vuelve a 'disponible' (clásico).
CREATE OR REPLACE FUNCTION public.fn_devolver_herramienta(
  p_herramienta_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rol text; v_sede text;
  v_h record;
  v_insumo_ant int; v_insumo_post int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::text, sede_id INTO v_rol, v_sede FROM usuarios WHERE id = v_uid;

  SELECT * INTO v_h FROM herramientas_prestamo
   WHERE id = p_herramienta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Herramienta no encontrada'; END IF;
  IF v_h.activo IS NOT TRUE THEN
    RAISE EXCEPTION 'La herramienta ya no está activa';
  END IF;
  IF v_rol IS DISTINCT FROM 'Admin' AND v_h.sede_id IS DISTINCT FROM v_sede THEN
    RAISE EXCEPTION 'No tienes permiso sobre esta herramienta';
  END IF;

  -- Manual (no inventariable): comportamiento clásico — solo cierra el préstamo.
  IF v_h.producto_id IS NULL THEN
    IF v_h.estado <> 'prestada' THEN
      RAISE EXCEPTION 'La herramienta no está prestada';
    END IF;
    UPDATE herramientas_prestamo
       SET estado = 'disponible', estado_prestamo = 'devuelto',
           fecha_devolucion_real = now(), prestada_a = NULL, updated_at = now()
     WHERE id = p_herramienta_id;
    RETURN jsonb_build_object('herramienta_id', p_herramienta_id,
      'inventariable', false, 'estado', 'disponible');
  END IF;

  -- Inventariable: regresar 1 al stock de insumo + retirar.
  -- Admite 'prestada' (cierre de préstamo) o 'disponible' (regreso directo,
  -- p.ej. una herramienta sacada de insumo que nunca se prestó).
  IF v_h.estado NOT IN ('prestada', 'disponible') THEN
    RAISE EXCEPTION 'Solo se puede regresar a insumo una herramienta prestada o disponible (estado actual: %)', v_h.estado;
  END IF;

  INSERT INTO inventario (producto_id, sede_id, cantidad, cantidad_insumo)
  VALUES (v_h.producto_id, v_h.sede_id, 0, 1)
  ON CONFLICT (producto_id, sede_id) DO UPDATE
     SET cantidad_insumo = inventario.cantidad_insumo + 1,
         ultimo_movimiento = now(), updated_at = now()
  RETURNING cantidad_insumo INTO v_insumo_post;
  v_insumo_ant := v_insumo_post - 1;

  UPDATE herramientas_prestamo
     SET estado = 'disponible', estado_prestamo = 'devuelto',
         fecha_devolucion_real = now(), prestada_a = NULL,
         activo = false, updated_at = now()
   WHERE id = p_herramienta_id;

  INSERT INTO movimientos (
    tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_tipo, referencia_id, usuario_id, observaciones
  ) VALUES (
    'ajuste', v_h.producto_id, v_h.sede_id, 1, v_insumo_ant, v_insumo_post,
    'herramienta', p_herramienta_id, v_uid,
    format('Herramienta → insumo: "%s" regresó al stock de insumo', v_h.herramienta_nombre)
  );

  PERFORM fn_actualizar_estado_stock(v_h.producto_id, v_h.sede_id);

  RETURN jsonb_build_object('herramienta_id', p_herramienta_id,
    'inventariable', true, 'cantidad_insumo', v_insumo_post, 'retirada', true);
END $function$;

-- 4 ─ Permisos (anon nunca escribe; solo authenticated + service_role)
REVOKE ALL ON FUNCTION public.fn_crear_herramienta_desde_insumo(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_crear_herramienta_desde_insumo(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.fn_devolver_herramienta(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_devolver_herramienta(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_crear_herramienta_desde_insumo(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_devolver_herramienta(uuid) TO authenticated, service_role;
