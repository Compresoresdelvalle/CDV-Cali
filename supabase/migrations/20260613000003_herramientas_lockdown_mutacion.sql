-- Paso 2 — HERRAMIENTAS-01/02 (CRÍTICA): cerrar el bypass de UPDATE REST directo
--
-- Problema: la policy hp_update permite a cualquier autenticado de la sede cambiar
-- CUALQUIER columna de herramientas_prestamo, incluidas `estado` y `activo`. Eso permitía
-- (probado, ROLLBACK):
--   · HERRAMIENTAS-01: devolver una herramienta INVENTARIABLE con un UPDATE directo
--     (estado='disponible') saltándose fn_devolver_herramienta → la unidad nunca regresa a
--     `cantidad_insumo` ni se asienta el movimiento → pérdida real de inventario.
--   · HERRAMIENTAS-02: consumir (dar de baja) una inventariable con UPDATE directo
--     (estado='consumido', activo=false) sin ser Admin y sin movimiento.
-- La tabla no tenía ningún trigger.
--
-- Fix: trigger BEFORE UPDATE que rechaza las mutaciones peligrosas hechas por escritura
-- directa, salvo que provengan de una RPC de confianza (fn_devolver_herramienta /
-- fn_consumir_herramienta) que marca un flag de sesión local — mismo patrón que
-- `cdv.anulando_venta`. Lo benigno sigue libre por REST: prestar (disponible→prestada),
-- devolver MANUAL (no inventariable), y editar campos no sensibles (observaciones, fechas).
--
-- Transiciones bloqueadas por REST directo:
--   1. cambiar `activo`               (solo RPC: retiro de inventariable / consumo)
--   2. cambiar `producto_id`          (inmutable por REST)
--   3. estado → 'consumido'           (solo fn_consumir_herramienta, Admin)
--   4. inventariable → 'disponible'   (solo fn_devolver_herramienta, Admin; acredita insumo)

-- ── Trigger de protección ────────────────────────────────────────────────────────
create or replace function public.trg_hp_proteger_mutacion()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Las RPC server-authoritative marcan este flag local antes de su UPDATE.
  if coalesce(current_setting('cdv.herramienta_rpc', true), 'off') = 'on' then
    return new;
  end if;

  -- A partir de aquí: UPDATE REST directo → se bloquean las mutaciones peligrosas.
  if new.activo is distinct from old.activo then
    raise exception 'No se permite cambiar el estado activo de una herramienta por escritura directa; usa la función de devolución o consumo';
  end if;

  if new.producto_id is distinct from old.producto_id then
    raise exception 'No se permite cambiar el producto vinculado de una herramienta por escritura directa';
  end if;

  if new.estado = 'consumido' and old.estado is distinct from 'consumido' then
    raise exception 'Marcar una herramienta como consumida requiere la función fn_consumir_herramienta (solo Admin)';
  end if;

  if old.producto_id is not null
     and new.estado = 'disponible' and old.estado is distinct from 'disponible' then
    raise exception 'Devolver una herramienta inventariable al stock de insumo requiere la función fn_devolver_herramienta (solo Admin)';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_hp_proteger_mutacion on public.herramientas_prestamo;
create trigger trg_hp_proteger_mutacion
  before update on public.herramientas_prestamo
  for each row execute function public.trg_hp_proteger_mutacion();

-- ── fn_devolver_herramienta: marca el flag alrededor de sus UPDATE ────────────────
create or replace function public.fn_devolver_herramienta(p_herramienta_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text; v_sede text;
  v_h record;
  v_insumo_ant int; v_insumo_post int;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;

  select * into v_h from herramientas_prestamo
   where id = p_herramienta_id for update;
  if not found then raise exception 'Herramienta no encontrada'; end if;
  if v_h.activo is not true then
    raise exception 'La herramienta ya no está activa';
  end if;
  if v_rol is distinct from 'Admin' and v_h.sede_id is distinct from v_sede then
    raise exception 'No tienes permiso sobre esta herramienta';
  end if;

  -- Manual (no inventariable): préstamo normal → disponible. Admin o misma sede.
  if v_h.producto_id is null then
    if v_h.estado <> 'prestada' then
      raise exception 'La herramienta no está prestada';
    end if;
    perform set_config('cdv.herramienta_rpc', 'on', true);
    update herramientas_prestamo
       set estado = 'disponible', estado_prestamo = 'devuelto',
           fecha_devolucion_real = now(), prestada_a = null, updated_at = now()
     where id = p_herramienta_id;
    perform set_config('cdv.herramienta_rpc', 'off', true);
    return jsonb_build_object('herramienta_id', p_herramienta_id,
      'inventariable', false, 'estado', 'disponible');
  end if;

  -- Inventariable: regresar a insumo retira la herramienta del catálogo → solo Admin.
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo el Admin puede regresar una herramienta inventariable al stock de insumo';
  end if;

  if v_h.estado not in ('prestada', 'disponible') then
    raise exception 'Solo se puede regresar a insumo una herramienta prestada o disponible (estado actual: %)', v_h.estado;
  end if;

  insert into inventario (producto_id, sede_id, cantidad, cantidad_insumo)
  values (v_h.producto_id, v_h.sede_id, 0, 1)
  on conflict (producto_id, sede_id) do update
     set cantidad_insumo = inventario.cantidad_insumo + 1,
         ultimo_movimiento = now(), updated_at = now()
  returning cantidad_insumo into v_insumo_post;
  v_insumo_ant := v_insumo_post - 1;

  perform set_config('cdv.herramienta_rpc', 'on', true);
  update herramientas_prestamo
     set estado = 'disponible', estado_prestamo = 'devuelto',
         fecha_devolucion_real = now(), prestada_a = null,
         activo = false, updated_at = now()
   where id = p_herramienta_id;
  perform set_config('cdv.herramienta_rpc', 'off', true);

  insert into movimientos (
    tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_tipo, referencia_id, usuario_id, observaciones
  ) values (
    'ajuste', v_h.producto_id, v_h.sede_id, 1, v_insumo_ant, v_insumo_post,
    'herramienta', p_herramienta_id, v_uid,
    format('Herramienta → insumo: "%s" regresó al stock de insumo', v_h.herramienta_nombre)
  );

  perform fn_actualizar_estado_stock(v_h.producto_id, v_h.sede_id);

  return jsonb_build_object('herramienta_id', p_herramienta_id,
    'inventariable', true, 'cantidad_insumo', v_insumo_post, 'retirada', true);
end $function$;

-- ── fn_consumir_herramienta: marca el flag alrededor de su UPDATE ─────────────────
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

  perform set_config('cdv.herramienta_rpc', 'on', true);
  update herramientas_prestamo
     set estado = 'consumido', estado_prestamo = 'devuelto',
         fecha_devolucion_real = now(), activo = false, updated_at = now()
   where id = p_herramienta_id;
  perform set_config('cdv.herramienta_rpc', 'off', true);

  return jsonb_build_object('herramienta_id', p_herramienta_id, 'estado', 'consumido');
end;
$function$;
