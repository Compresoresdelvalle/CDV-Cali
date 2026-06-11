-- FEATURE (solicitud cliente 2026-06-11): el rol Bodeguero debe poder usar el módulo
-- de Herramientas casi por completo (crear, prestar, marcar devuelta de su sede). Solo el
-- Admin puede CONSUMIR (retiro irreversible) y REGRESAR A INSUMO una herramienta
-- inventariable (retira la unidad del catálogo y la devuelve al stock de insumo).
--
-- Cambios server-side (fuente de verdad; el frontend espeja el gating):
--  (1) fn_crear_herramienta_desde_insumo: Admin O Bodeguero (Bodeguero solo en su sede).
--  (2) Política hp_insert (alta manual): Admin O Bodeguero (Bodeguero solo en su sede).
--  (3) fn_devolver_herramienta: el camino INVENTARIABLE (regresar a insumo) pasa a
--      Admin-only; el camino MANUAL (préstamo normal → disponible) sigue Admin/misma-sede.
--  (4) fn_consumir_herramienta: Admin-only.
-- Prestar (UPDATE vía RLS hp_update misma-sede) ya estaba disponible para Bodeguero.

-- (1) Crear desde insumo: Admin o Bodeguero (sede propia) ------------------------------
create or replace function public.fn_crear_herramienta_desde_insumo(p_producto_id uuid, p_sede_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
  IF v_rol NOT IN ('Admin','Bodeguero') THEN
    RAISE EXCEPTION 'Solo Admin o Bodeguero pueden crear herramientas';
  END IF;
  IF v_rol <> 'Admin' AND p_sede_id IS DISTINCT FROM get_my_sede_id() THEN
    RAISE EXCEPTION 'Solo puedes crear herramientas en tu propia sede';
  END IF;

  SELECT nombre, COALESCE(NULLIF(TRIM(codigo_interno), ''), referencia)
    INTO v_nombre, v_codigo
    FROM productos WHERE id = p_producto_id AND activo = true;
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado o inactivo';
  END IF;

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

-- (2) Alta manual: Admin o Bodeguero (sede propia) ------------------------------------
drop policy if exists hp_insert on public.herramientas_prestamo;
create policy hp_insert on public.herramientas_prestamo
  for insert
  with check (
    (select get_my_rol()) = 'Admin'
    or ((select get_my_rol()) = 'Bodeguero' and sede_id = (select get_my_sede_id()))
  );

-- (3) Devolver: inventariable (regresar a insumo) → Admin-only ------------------------
create or replace function public.fn_devolver_herramienta(p_herramienta_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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

  -- Manual (no inventariable): préstamo normal → disponible. Admin o misma sede.
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

  -- Inventariable: regresar a insumo retira la herramienta del catálogo → solo Admin.
  IF v_rol IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Solo el Admin puede regresar una herramienta inventariable al stock de insumo';
  END IF;

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

-- (4) Consumir: Admin-only ------------------------------------------------------------
create or replace function public.fn_consumir_herramienta(p_herramienta_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_rol  text;
  v_h    record;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text into v_rol from usuarios where id = v_uid;
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo el Admin puede marcar una herramienta como consumida';
  end if;

  select * into v_h from herramientas_prestamo
   where id = p_herramienta_id for update;
  if not found then raise exception 'Herramienta no encontrada'; end if;
  if v_h.activo is not true then
    raise exception 'La herramienta ya no está activa';
  end if;
  if v_h.estado <> 'prestada' then
    raise exception 'Solo se puede consumir una herramienta prestada (estado actual: %)', v_h.estado;
  end if;

  update herramientas_prestamo
     set estado = 'consumido', estado_prestamo = 'devuelto',
         fecha_devolucion_real = now(), activo = false, updated_at = now()
   where id = p_herramienta_id;

  return jsonb_build_object('herramienta_id', p_herramienta_id, 'estado', 'consumido');
end;
$function$;
