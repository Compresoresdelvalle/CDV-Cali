-- ============================================================================
-- Herramientas: permitir dar de alta VARIAS unidades a la vez + auditoría al
-- consumir.
--
-- Problema reportado: "no deja prestar más de una herramienta". La lógica de
-- préstamo por lote (fn_prestar_herramientas_lote, REQ7) ya funciona bien —
-- probado en prod con filas duplicadas de prueba (rollback). El problema real
-- está upstream: fn_crear_herramienta_desde_insumo solo crea 1 fila por
-- llamada, y el modo "manual" del frontend también inserta 1 sola fila. Como
-- cada fila = 1 unidad física, casi nunca existe más de 1 unidad disponible
-- de la misma referencia, así que el selector de cantidad al prestar queda
-- permanentemente topado en 1 (el botón "+" se ve pero está deshabilitado).
--
-- Fix: fn_crear_herramienta_desde_insumo acepta p_cantidad (default 1) y crea
-- esa cantidad de filas en una sola transacción, descontando el insumo de una
-- vez. El modo "manual" se arregla en el frontend (inserta N filas iguales).
--
-- Bonus: fn_consumir_herramienta no dejaba ningún rastro en `movimientos` al
-- dar de baja una herramienta inventariable (a diferencia de devolver a
-- insumo, que sí audita). Se agrega un movimiento informativo (cantidad 0,
-- no toca el stock) para que quede registro de la baja.
-- ============================================================================

create or replace function public.fn_crear_herramienta_desde_insumo(
  p_producto_id uuid,
  p_sede_id text,
  p_cantidad integer default 1
)
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
  v_ids uuid[];
  v_primer_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::text INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol NOT IN ('Admin','Bodeguero') THEN
    RAISE EXCEPTION 'Solo Admin o Bodeguero pueden crear herramientas';
  END IF;
  IF v_rol <> 'Admin' AND p_sede_id IS DISTINCT FROM get_my_sede_id() THEN
    RAISE EXCEPTION 'Solo puedes crear herramientas en tu propia sede';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad < 1 THEN
    RAISE EXCEPTION 'La cantidad a crear debe ser mayor a 0';
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
  IF NOT FOUND OR v_insumo_ant IS NULL OR v_insumo_ant < p_cantidad THEN
    RAISE EXCEPTION 'No hay stock de insumo suficiente en la sede % (hay %, pediste %)',
      p_sede_id, COALESCE(v_insumo_ant, 0), p_cantidad;
  END IF;

  v_insumo_post := v_insumo_ant - p_cantidad;
  UPDATE inventario
     SET cantidad_insumo = v_insumo_post,
         ultimo_movimiento = now(), updated_at = now()
   WHERE producto_id = p_producto_id AND sede_id = p_sede_id;

  WITH ins AS (
    INSERT INTO herramientas_prestamo (
      herramienta_nombre, herramienta_codigo, sede_id, estado, producto_id, activo
    )
    SELECT v_nombre, v_codigo, p_sede_id, 'disponible', p_producto_id, true
    FROM generate_series(1, p_cantidad)
    RETURNING id
  )
  SELECT array_agg(id) INTO v_ids FROM ins;
  v_primer_id := v_ids[1];

  INSERT INTO movimientos (
    tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_tipo, referencia_id, usuario_id, observaciones
  ) VALUES (
    'ajuste', p_producto_id, p_sede_id, -p_cantidad, v_insumo_ant, v_insumo_post,
    'herramienta', v_primer_id, v_uid,
    format('Insumo → herramienta: %s ud(s) de "%s" salieron del stock de insumo', p_cantidad, v_nombre)
  );

  PERFORM fn_actualizar_estado_stock(p_producto_id, p_sede_id);

  RETURN jsonb_build_object(
    'herramienta_ids', to_jsonb(v_ids), 'producto_id', p_producto_id,
    'sede_id', p_sede_id, 'cantidad_creada', p_cantidad,
    'cantidad_insumo', v_insumo_post, 'inventariable', true
  );
END $function$;

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
  v_insumo int;
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

  perform set_config('cdv.herramienta_rpc', 'on', true);
  update herramientas_prestamo
     set estado = 'consumido', estado_prestamo = 'devuelto',
         fecha_devolucion_real = now(), activo = false, updated_at = now()
   where id = p_herramienta_id;
  perform set_config('cdv.herramienta_rpc', 'off', true);

  -- Auditoría: antes esta baja no dejaba ningún rastro en `movimientos`
  -- (a diferencia de devolver a insumo, que sí lo hace). Movimiento
  -- informativo de cantidad 0: no toca el stock, solo deja constancia.
  if v_h.producto_id is not null then
    select cantidad_insumo into v_insumo from inventario
     where producto_id = v_h.producto_id and sede_id = v_h.sede_id;
    insert into movimientos (
      tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
      referencia_tipo, referencia_id, usuario_id, observaciones
    ) values (
      'ajuste', v_h.producto_id, v_h.sede_id, 0,
      coalesce(v_insumo, 0), coalesce(v_insumo, 0),
      'herramienta', p_herramienta_id, v_uid,
      format('Herramienta "%s" marcada como consumida/dada de baja (no regresa al insumo)', v_h.herramienta_nombre)
    );
  end if;

  return jsonb_build_object('herramienta_id', p_herramienta_id, 'estado', 'consumido');
end;
$function$;
