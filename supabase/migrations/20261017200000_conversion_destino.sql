-- Bloque 2 (trazabilidad de insumos): para qué se convirtió cada unidad a insumo.
--
-- `movimientos` no deja editar ni borrar, así que el destino va en una tabla
-- aparte, amarrada al movimiento de la conversión. Decisión de la clienta
-- (2026-10-17): el destino es opcional para el Admin y obligatorio para los
-- demás roles, en OT, ensambles y préstamos de herramienta.

insert into public.parametros_sistema (key, value, tipo, descripcion) values
  ('conversion_destino_obligatorio', 'false', 'bool',
   'Si es true, vendedoras, bodega y técnicos deben decir para qué convierten a insumo')
on conflict (key) do nothing;

create table if not exists public.conversion_destino (
  id            bigint generated always as identity primary key,
  movimiento_id uuid not null unique references public.movimientos(id),
  tipo          text not null check (tipo in ('orden','ensamble','prestamo','otro')),
  orden_id      uuid references public.ordenes_servicio(id),
  ensamble_id   uuid references public.ensambles(id),
  prestamo_id   uuid references public.herramientas_prestamo(id),
  nota          text,
  -- true = amarrado después por cercanía en el tiempo (histórico), no
  -- registrado por quien convirtió. La pantalla lo dice así.
  inferido      boolean not null default false,
  created_by    uuid references public.usuarios(id),
  created_at    timestamptz not null default now(),
  constraint conversion_destino_doc_ok check (
       (tipo = 'orden'    and orden_id is not null)
    or (tipo = 'ensamble' and (ensamble_id is not null or nullif(trim(nota),'') is not null))
    or (tipo = 'prestamo' and (prestamo_id is not null or nullif(trim(nota),'') is not null))
    or (tipo = 'otro'     and nullif(trim(nota),'') is not null)
  )
);

create index if not exists conversion_destino_orden_idx    on public.conversion_destino (orden_id)    where orden_id is not null;
create index if not exists conversion_destino_ensamble_idx on public.conversion_destino (ensamble_id) where ensamble_id is not null;
create index if not exists conversion_destino_prestamo_idx on public.conversion_destino (prestamo_id) where prestamo_id is not null;

alter table public.conversion_destino enable row level security;

-- Se ve lo mismo que el movimiento: la subconsulta pasa por la RLS de
-- movimientos (Admin todo; los demás, su sede).
drop policy if exists conversion_destino_select on public.conversion_destino;
create policy conversion_destino_select on public.conversion_destino
  for select to authenticated
  using (exists (select 1 from public.movimientos m where m.id = movimiento_id));

-- Sin políticas de escritura: solo se escribe desde las funciones de abajo.
revoke all on public.conversion_destino from anon, public;
revoke insert, update, delete, truncate on public.conversion_destino from authenticated;
grant select on public.conversion_destino to authenticated;
grant all on public.conversion_destino to service_role;


-- La firma cambia (p_destino nuevo): se baja la vieja para no dejar sobrecarga.
drop function if exists public.fn_convertir_a_insumo(uuid, text, integer);

create function public.fn_convertir_a_insumo(
  p_producto_id uuid,
  p_sede_id     text,
  p_cantidad    integer,
  p_destino     jsonb default null   -- {"tipo": "orden|ensamble|prestamo|otro", "id": uuid?, "nota": text?}
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rol text; v_usuario text;
  v_venta int; v_insumo int;
  v_prod text; v_sede text;
  v_notificar boolean;
  v_fecha date;
  v_key text;
  v_mov_id uuid;
  v_tipo text := nullif(trim(coalesce(p_destino->>'tipo','')), '');
  v_doc  uuid;
  v_nota text := nullif(trim(coalesce(p_destino->>'nota','')), '');
  v_doc_sede text;
  v_label text;
  v_dest_id bigint;
  v_det jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::text, nombre INTO v_rol, v_usuario FROM usuarios WHERE id = v_uid;
  IF v_rol IS NULL OR v_rol NOT IN ('Admin','Bodeguero','Tecnico','Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para convertir stock a insumo (rol %)', COALESCE(v_rol,'desconocido');
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad a convertir debe ser mayor a 0';
  END IF;

  -- ── Destino ───────────────────────────────────────────────────────────
  BEGIN
    v_doc := nullif(trim(coalesce(p_destino->>'id','')), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'El documento de destino no es válido';
  END;

  IF v_tipo IS NULL THEN
    -- El interruptor existe para no romper la app desplegada mientras la
    -- pantalla nueva no esté en producción: se prende al desplegarla.
    IF v_rol <> 'Admin'
       AND coalesce((SELECT value FROM parametros_sistema WHERE key = 'conversion_destino_obligatorio'), 'false') = 'true' THEN
      RAISE EXCEPTION 'Indica para qué es el insumo: una OT, un ensamble, un préstamo de herramienta u "Otro" con una nota. Así el administrador sabe en qué se usó.';
    END IF;
  ELSIF v_tipo NOT IN ('orden','ensamble','prestamo','otro') THEN
    RAISE EXCEPTION 'Destino desconocido (%). Escoge OT, ensamble, préstamo u "Otro".', v_tipo;
  ELSIF v_tipo = 'orden' THEN
    IF v_doc IS NULL THEN RAISE EXCEPTION 'Escoge la OT para la que es el insumo.'; END IF;
    SELECT sede_id, 'OT #' || numero || coalesce(' · ' || nullif(trim(cliente_nombre),''), '')
      INTO v_doc_sede, v_label
      FROM ordenes_servicio WHERE id = v_doc AND estado NOT IN ('entregada','cancelada');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Esa OT no existe o ya está cerrada (entregada o cancelada). Escoge una OT abierta.';
    END IF;
  ELSIF v_tipo = 'ensamble' THEN
    IF v_doc IS NOT NULL THEN
      SELECT e.sede_id, 'Ensamble #' || e.numero || coalesce(' · ' || p.nombre, '')
        INTO v_doc_sede, v_label
        FROM ensambles e LEFT JOIN productos p ON p.id = e.producto_resultado_id
       WHERE e.id = v_doc AND e.completado = false;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Ese ensamble no existe o ya está completado. Escoge un ensamble abierto.';
      END IF;
    ELSIF v_nota IS NULL THEN
      RAISE EXCEPTION 'Escoge el ensamble o escribe para qué ensamble es.';
    ELSE
      v_label := 'Ensamble nuevo · ' || v_nota;
    END IF;
  ELSIF v_tipo = 'prestamo' THEN
    IF v_doc IS NOT NULL THEN
      SELECT sede_id, 'Préstamo · ' || herramienta_nombre
        INTO v_doc_sede, v_label
        FROM herramientas_prestamo WHERE id = v_doc AND activo IS NOT FALSE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Ese préstamo de herramienta no existe.'; END IF;
    ELSIF v_nota IS NULL THEN
      RAISE EXCEPTION 'Escoge el préstamo o escribe para quién es la herramienta.';
    ELSE
      v_label := 'Préstamo · ' || v_nota;
    END IF;
  ELSE -- otro
    IF v_nota IS NULL OR length(v_nota) < 3 THEN
      RAISE EXCEPTION 'Con "Otro" escribe una nota corta de para qué es el insumo.';
    END IF;
    v_label := 'Otro · ' || v_nota;
  END IF;

  IF v_doc_sede IS NOT NULL AND v_doc_sede IS DISTINCT FROM p_sede_id THEN
    RAISE EXCEPTION 'El documento escogido es de otra sede (%). El insumo se convierte en %.', v_doc_sede, p_sede_id;
  END IF;

  -- ── Conversión (igual que antes) ─────────────────────────────────────
  SELECT cantidad, cantidad_insumo INTO v_venta, v_insumo
    FROM inventario WHERE producto_id = p_producto_id AND sede_id = p_sede_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no tiene inventario en la sede %', p_sede_id;
  END IF;
  IF v_venta < p_cantidad THEN
    RAISE EXCEPTION 'Stock de venta insuficiente (hay %, intentas convertir %)', v_venta, p_cantidad;
  END IF;

  UPDATE inventario
     SET cantidad = cantidad - p_cantidad,
         cantidad_insumo = cantidad_insumo + p_cantidad,
         ultimo_movimiento = now(), updated_at = now()
   WHERE producto_id = p_producto_id AND sede_id = p_sede_id;

  INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_tipo, usuario_id, observaciones)
  VALUES ('conversion_a_insumo', p_producto_id, p_sede_id, -p_cantidad,
    v_venta, v_venta - p_cantidad, 'conversion', v_uid,
    format('Convertidas %s uds de venta a insumo', p_cantidad) || coalesce(' · ' || v_label, ''))
  RETURNING id INTO v_mov_id;

  IF v_tipo IS NOT NULL THEN
    INSERT INTO conversion_destino (movimiento_id, tipo, orden_id, ensamble_id, prestamo_id, nota, created_by)
    VALUES (v_mov_id, v_tipo,
            CASE WHEN v_tipo = 'orden'    THEN v_doc END,
            CASE WHEN v_tipo = 'ensamble' THEN v_doc END,
            CASE WHEN v_tipo = 'prestamo' THEN v_doc END,
            v_nota, v_uid)
    RETURNING id INTO v_dest_id;
  END IF;

  PERFORM fn_actualizar_estado_stock(p_producto_id, p_sede_id);

  v_notificar := (v_rol <> 'Admin');
  IF v_notificar THEN
    SELECT nombre INTO v_prod FROM productos WHERE id = p_producto_id;
    SELECT nombre INTO v_sede FROM sedes WHERE id = p_sede_id;

    -- Día laboral en hora Colombia, no UTC: si se corta en UTC, todo lo que
    -- pasa después de las 7pm cae en el "día siguiente" y el agrupado miente.
    v_fecha := (now() AT TIME ZONE 'America/Bogota')::date;
    v_key := 'conversion_insumo:' || p_sede_id || ':' || v_fecha::text;

    -- Cada conversión deja su línea (quién, qué, para qué) en data.detalle,
    -- sin dejar de agrupar por día y sede para no llenar la campana.
    v_det := jsonb_build_object(
      'hora', to_char(now() AT TIME ZONE 'America/Bogota', 'HH24:MI'),
      'usuario', v_usuario, 'producto', v_prod, 'cantidad', p_cantidad,
      'destino', coalesce(v_label, 'Sin destino'), 'destino_tipo', v_tipo, 'destino_id', v_doc);

    INSERT INTO notificaciones (tipo, titulo, mensaje, data, para_rol, created_by,
                                dedupe_key, updated_at)
    VALUES (
      'conversion_insumo',
      'Conversiones a insumo',
      format('Hoy en %s: 1 conversión a insumo (%s ud). %s convirtió %s %s para %s.',
             COALESCE(v_sede, p_sede_id), p_cantidad,
             v_usuario, p_cantidad, v_prod, coalesce(v_label, 'sin destino')),
      jsonb_build_object('sede_id', p_sede_id, 'sede', v_sede,
                         'fecha', v_fecha::text, 'eventos', 1, 'unidades', p_cantidad,
                         'detalle', jsonb_build_array(v_det)),
      'Admin', v_uid, v_key, now()
    )
    -- El predicado repite el del índice parcial: ON CONFLICT no puede inferir
    -- un índice parcial sin él.
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE
      SET data = notificaciones.data || jsonb_build_object(
                   'eventos',  COALESCE((notificaciones.data->>'eventos')::int, 0) + 1,
                   'unidades', COALESCE((notificaciones.data->>'unidades')::int, 0) + p_cantidad,
                   -- las 40 más recientes primero
                   'detalle', (SELECT coalesce(jsonb_agg(x ORDER BY n), '[]'::jsonb) FROM (
                                 SELECT x, n FROM jsonb_array_elements(
                                   jsonb_build_array(v_det) || coalesce(notificaciones.data->'detalle', '[]'::jsonb)
                                 ) WITH ORDINALITY AS t(x, n) WHERE n <= 40) s)),
          mensaje = format('Hoy en %s: %s conversiones a insumo (%s ud). Última: %s convirtió %s %s para %s.',
                     COALESCE(v_sede, p_sede_id),
                     COALESCE((notificaciones.data->>'eventos')::int, 0) + 1,
                     COALESCE((notificaciones.data->>'unidades')::int, 0) + p_cantidad,
                     v_usuario, p_cantidad, v_prod, coalesce(v_label, 'sin destino')),
          -- Deliberado: si entran conversiones después de que el Admin revisó,
          -- el badge vuelve. Es lo pedido.
          leida = false,
          updated_at = now();
  END IF;

  RETURN jsonb_build_object('producto_id', p_producto_id, 'sede_id', p_sede_id,
    'cantidad_venta', v_venta - p_cantidad, 'cantidad_insumo', v_insumo + p_cantidad,
    'notificado_admin', v_notificar, 'movimiento_id', v_mov_id, 'destino_id', v_dest_id);
END $function$;

revoke all on function public.fn_convertir_a_insumo(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.fn_convertir_a_insumo(uuid, text, integer, jsonb) to authenticated, service_role;


-- Nuevo ensamble: el insumo se convierte ANTES de que el ensamble exista. La
-- pantalla convierte con {"tipo":"ensamble","nota":"<producto>"} y, al crear el
-- ensamble, amarra esas conversiones con esta función.
create or replace function public.fn_vincular_conversiones_ensamble(
  p_ensamble_id uuid,
  p_destino_ids bigint[]
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_sede text;
  v_n int;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select sede_id into v_sede from ensambles where id = p_ensamble_id;
  if not found then raise exception 'Ensamble no encontrado'; end if;

  update conversion_destino d
     set ensamble_id = p_ensamble_id
    from movimientos m
   where d.id = any(p_destino_ids)
     and m.id = d.movimiento_id
     and d.tipo = 'ensamble'
     and d.ensamble_id is null
     and d.created_by = v_uid
     and m.sede_id = v_sede;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

revoke all on function public.fn_vincular_conversiones_ensamble(uuid, bigint[]) from public, anon;
grant execute on function public.fn_vincular_conversiones_ensamble(uuid, bigint[]) to authenticated, service_role;


-- Histórico: se amarra cada conversión vieja al primer consumo del mismo
-- producto en la misma sede en las 2 horas siguientes (OT, ensamble o
-- préstamo de herramienta). Queda marcado inferido = true. Las que no tienen
-- pareja se quedan sin fila ("sin destino").
insert into public.conversion_destino (movimiento_id, tipo, orden_id, ensamble_id, prestamo_id, inferido, created_by, created_at)
select c.id,
       case p.referencia_tipo when 'orden_servicio' then 'orden' when 'ensamble' then 'ensamble' else 'prestamo' end,
       case when p.referencia_tipo = 'orden_servicio' then p.referencia_id end,
       case when p.referencia_tipo = 'ensamble'       then p.referencia_id end,
       case when p.referencia_tipo = 'herramienta'    then p.referencia_id end,
       true, c.usuario_id, c.fecha
  from movimientos c
  cross join lateral (
    select x.referencia_tipo, x.referencia_id
      from movimientos x
     where x.producto_id = c.producto_id and x.sede_id = c.sede_id
       and x.fecha >= c.fecha and x.fecha < c.fecha + interval '2 hours'
       and (x.tipo = 'orden_consumo' or x.tipo = 'ensamble_consumo'
            or (x.tipo = 'ajuste' and x.referencia_tipo = 'herramienta'))
       and x.referencia_id is not null
     order by x.fecha
     limit 1
  ) p
 where c.tipo = 'conversion_a_insumo'
   and not exists (select 1 from public.conversion_destino d where d.movimiento_id = c.id)
   and (p.referencia_tipo <> 'orden_servicio' or exists (select 1 from ordenes_servicio o where o.id = p.referencia_id))
   and (p.referencia_tipo <> 'ensamble'       or exists (select 1 from ensambles e where e.id = p.referencia_id))
   and (p.referencia_tipo <> 'herramienta'    or exists (select 1 from herramientas_prestamo h where h.id = p.referencia_id));

notify pgrst, 'reload schema';
