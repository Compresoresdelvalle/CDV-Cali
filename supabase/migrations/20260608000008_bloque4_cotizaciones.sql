-- Bloque 4 — Cotizaciones: precio editable, descuento en $, domicilio,
-- vender servicio y abonos (ligados a la futura venta).
--
-- RETROCOMPATIBLE: se conservan descuento_pct (legado) y se agregan
-- descuento_valor ($) + domicilio en cotizaciones; detalle_cotizacion admite
-- servicios (producto_id NULL + servicio_id + descripcion, check XOR). Los RPC
-- de registrar/editar conservan su firma previa (la UI desplegada sigue
-- funcionando) y solo agregan 2 args nuevos con default al final. fn_convertir
-- traslada descuento_valor + domicilio + líneas de servicio a la venta; los
-- abonos quedan ligados a la venta vía cotizaciones.venta_id.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Esquema cotizaciones: descuento_valor ($) + domicilio.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.cotizaciones
  add column if not exists descuento_valor numeric,
  add column if not exists domicilio numeric not null default 0
    check (domicilio >= 0);

-- 2) Esquema detalle_cotizacion: servicios (XOR con producto), precio editable.
alter table public.detalle_cotizacion
  alter column producto_id drop not null;

alter table public.detalle_cotizacion
  add column if not exists servicio_id bigint references public.servicios(id),
  add column if not exists descripcion text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.detalle_cotizacion'::regclass
      and conname = 'detalle_cotizacion_producto_xor_servicio'
  ) then
    alter table public.detalle_cotizacion
      add constraint detalle_cotizacion_producto_xor_servicio
      check ((producto_id is not null) <> (servicio_id is not null));
  end if;
end $$;

-- 3) Tabla nueva: abonos de cotización (ligados a la venta vía cotizacion).
create table if not exists public.abonos_cotizacion (
  id             bigint generated always as identity primary key,
  cotizacion_id  uuid not null references public.cotizaciones(id) on delete cascade,
  fecha          timestamptz not null default now(),
  monto          numeric not null check (monto > 0),
  metodo_pago    text not null
    check (metodo_pago in ('efectivo', 'transferencia', 'tarjeta', 'otro')),
  observaciones  text,
  registrado_por uuid not null references public.usuarios(id),
  created_at     timestamptz not null default now()
);
create index if not exists idx_abonos_cotizacion_cot
  on public.abonos_cotizacion (cotizacion_id);

alter table public.abonos_cotizacion enable row level security;

-- RLS con alcance por sede (igual patrón que abonos de OT, pero vía cotización).
drop policy if exists abonos_cotizacion_read on public.abonos_cotizacion;
create policy abonos_cotizacion_read on public.abonos_cotizacion
  for select to authenticated
  using (exists (
    select 1 from public.cotizaciones c
    where c.id = abonos_cotizacion.cotizacion_id
      and ((select get_my_rol()) = 'Admin' or c.sede_id = (select get_my_sede_id()))
  ));

drop policy if exists abonos_cotizacion_insert on public.abonos_cotizacion;
create policy abonos_cotizacion_insert on public.abonos_cotizacion
  for insert to authenticated
  with check (
    registrado_por = auth.uid()
    and (select get_my_rol()) = any (array['Admin', 'Vendedor'])
    and exists (
      select 1 from public.cotizaciones c
      where c.id = abonos_cotizacion.cotizacion_id
        and ((select get_my_rol()) = 'Admin' or c.sede_id = (select get_my_sede_id()))
    )
  );

drop policy if exists abonos_cotizacion_delete on public.abonos_cotizacion;
create policy abonos_cotizacion_delete on public.abonos_cotizacion
  for delete to authenticated
  using ((select get_my_rol()) = 'Admin');

grant select, insert, delete on public.abonos_cotizacion to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) fn_registrar_cotizacion: honra precio por línea, descuento $ + domicilio
--    y líneas de servicio. +2 args al final (drop+recreate por nueva aridad).
-- ─────────────────────────────────────────────────────────────────────────
drop function if exists public.fn_registrar_cotizacion(
  text, text, text, text, text, numeric, integer, numeric, text, text, text, jsonb, bigint[], uuid
);

create or replace function public.fn_registrar_cotizacion(
  p_sede_id text,
  p_cliente_nombre text default null,
  p_cliente_nit text default null,
  p_cliente_email text default null,
  p_cliente_telefono text default null,
  p_descuento_pct numeric default 0,
  p_vigencia_dias integer default null,
  p_iva_pct numeric default null,
  p_observaciones text default null,
  p_condiciones_pago text default null,
  p_tiempo_entrega_nota text default null,
  p_items jsonb default '[]'::jsonb,
  p_cuentas_ids bigint[] default '{}'::bigint[],
  p_ot_id uuid default null,
  p_descuento_valor numeric default null,
  p_domicilio numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_vendedor_id uuid; v_cot_id uuid; v_numero int;
  v_subtotal numeric := 0; v_total numeric; v_desc numeric;
  v_iva numeric; v_validez int;
  v_my_rol text; v_my_sede text;
  v_ot_sede text;
  item jsonb;
  v_prod_id uuid; v_cant numeric; v_precio numeric; v_precio_in numeric; v_precio_cat numeric;
  v_serv_id bigint; v_serv_nombre text; v_serv_precio numeric;
  v_cuenta_id bigint;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La cotización debe tener al menos un ítem';
  end if;
  if p_cliente_nombre is null or trim(p_cliente_nombre) = '' then
    raise exception 'El nombre del cliente es obligatorio';
  end if;
  v_vendedor_id := auth.uid();
  if v_vendedor_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  v_my_rol := get_my_rol();
  v_my_sede := get_my_sede_id();
  if v_my_rol <> 'Admin' and p_sede_id is distinct from v_my_sede then
    raise exception 'No puedes crear cotización en una sede distinta a la tuya';
  end if;

  if p_ot_id is not null then
    select sede_id into v_ot_sede from ordenes_servicio where id = p_ot_id;
    if v_ot_sede is null then
      raise exception 'OT vinculada no existe (id %)', p_ot_id;
    end if;
    if v_my_rol <> 'Admin' and v_ot_sede <> v_my_sede then
      raise exception 'No puedes vincular cotización a una OT de otra sede';
    end if;
  end if;

  v_iva := coalesce(p_iva_pct, nullif(fn_get_parametro('iva_pct'), '')::numeric, 19);
  v_validez := coalesce(p_vigencia_dias, nullif(fn_get_parametro('validez_cotizacion_dias'), '')::int, 15);
  if v_iva < 0 or v_iva > 100 then
    raise exception 'iva_pct debe estar entre 0 y 100 (recibido %)', v_iva;
  end if;
  if v_validez < 1 or v_validez > 365 then
    raise exception 'vigencia_dias debe estar entre 1 y 365 (recibido %)', v_validez;
  end if;

  -- Header primero (subtotal/total se ajustan tras insertar las líneas).
  insert into cotizaciones (
    vendedor_id, sede_id, cliente_nombre, cliente_nit, cliente_email, cliente_telefono,
    descuento_pct, descuento_valor, domicilio, iva_pct, vigencia_dias, subtotal, total, estado,
    observaciones, condiciones_pago, tiempo_entrega_nota, ot_id
  ) values (
    v_vendedor_id, p_sede_id, trim(p_cliente_nombre), p_cliente_nit, p_cliente_email, p_cliente_telefono,
    p_descuento_pct, p_descuento_valor, greatest(0, coalesce(p_domicilio, 0)), v_iva, v_validez, 0, 0, 'borrador',
    p_observaciones, p_condiciones_pago, p_tiempo_entrega_nota, p_ot_id
  ) returning id, numero into v_cot_id, v_numero;

  for item in select * from jsonb_array_elements(p_items) loop
    v_cant := (item->>'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then
      raise exception 'Cantidad de ítem debe ser > 0';
    end if;
    v_precio_in := nullif(item->>'precio_unitario', '')::numeric;
    v_serv_id   := nullif(item->>'servicio_id', '')::bigint;

    if v_serv_id is not null then
      select nombre, precio into v_serv_nombre, v_serv_precio
        from servicios where id = v_serv_id and activo = true;
      if v_serv_nombre is null then
        raise exception 'Servicio % no encontrado o inactivo', v_serv_id;
      end if;
      v_precio := case when v_precio_in is not null and v_precio_in >= 0 then v_precio_in else v_serv_precio end;
      insert into detalle_cotizacion (cotizacion_id, producto_id, servicio_id, descripcion, cantidad, precio_unitario, subtotal)
      values (v_cot_id, null, v_serv_id, v_serv_nombre, v_cant, v_precio, v_cant * v_precio);
    else
      v_prod_id := (item->>'producto_id')::uuid;
      select precio_venta into v_precio_cat from productos where id = v_prod_id and activo = true;
      if v_precio_cat is null then
        raise exception 'Producto % no encontrado o inactivo', v_prod_id;
      end if;
      v_precio := case when v_precio_in is not null and v_precio_in >= 0 then v_precio_in else v_precio_cat end;
      insert into detalle_cotizacion (cotizacion_id, producto_id, cantidad, precio_unitario, subtotal)
      values (v_cot_id, v_prod_id, v_cant, v_precio, v_cant * v_precio);
    end if;

    v_subtotal := v_subtotal + v_cant * v_precio;
  end loop;

  -- Descuento efectivo en $: valor absoluto si viene; si no, el % legado.
  v_desc := coalesce(p_descuento_valor, v_subtotal * coalesce(p_descuento_pct, 0) / 100);
  v_desc := greatest(0, least(v_desc, v_subtotal));
  v_total := (v_subtotal - v_desc) * (1 + v_iva / 100) + greatest(0, coalesce(p_domicilio, 0));

  update cotizaciones set subtotal = v_subtotal, total = v_total where id = v_cot_id;

  if array_length(p_cuentas_ids, 1) > 0 then
    foreach v_cuenta_id in array p_cuentas_ids loop
      insert into cotizacion_cuentas_bancarias (cotizacion_id, cuenta_id)
      values (v_cot_id, v_cuenta_id) on conflict do nothing;
    end loop;
  end if;

  return jsonb_build_object('cotizacion_id', v_cot_id, 'numero', v_numero, 'total', v_total);
end;
$function$;

grant execute on function public.fn_registrar_cotizacion(
  text, text, text, text, text, numeric, integer, numeric, text, text, text, jsonb, bigint[], uuid, numeric, numeric
) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) fn_editar_cotizacion: misma lógica nueva. +2 args al final.
-- ─────────────────────────────────────────────────────────────────────────
drop function if exists public.fn_editar_cotizacion(
  uuid, text, text, text, text, numeric, integer, numeric, text, text, text, jsonb, bigint[]
);

create or replace function public.fn_editar_cotizacion(
  p_cotizacion_id uuid,
  p_cliente_nombre text default null,
  p_cliente_nit text default null,
  p_cliente_email text default null,
  p_cliente_telefono text default null,
  p_descuento_pct numeric default 0,
  p_vigencia_dias integer default null,
  p_iva_pct numeric default null,
  p_observaciones text default null,
  p_condiciones_pago text default null,
  p_tiempo_entrega_nota text default null,
  p_items jsonb default '[]'::jsonb,
  p_cuentas_ids bigint[] default '{}'::bigint[],
  p_descuento_valor numeric default null,
  p_domicilio numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid; v_my_rol text; v_my_sede text;
  v_estado text; v_sede text; v_venta_id uuid;
  v_iva numeric; v_validez int;
  v_subtotal numeric := 0; v_total numeric; v_desc numeric;
  item jsonb;
  v_prod_id uuid; v_cant numeric; v_precio numeric; v_precio_in numeric; v_precio_cat numeric;
  v_serv_id bigint; v_serv_nombre text; v_serv_precio numeric;
  v_cuenta_id bigint;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La cotización debe tener al menos un ítem';
  end if;
  if p_cliente_nombre is null or trim(p_cliente_nombre) = '' then
    raise exception 'El nombre del cliente es obligatorio';
  end if;
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Usuario no autenticado';
  end if;

  v_my_rol := get_my_rol();
  v_my_sede := get_my_sede_id();

  select estado::text, sede_id, venta_id into v_estado, v_sede, v_venta_id
    from cotizaciones where id = p_cotizacion_id for update;
  if not found then
    raise exception 'Cotización no encontrada';
  end if;
  if v_my_rol <> 'Admin' and v_sede is distinct from v_my_sede then
    raise exception 'No puedes editar una cotización de otra sede';
  end if;
  if v_venta_id is not null then
    raise exception 'No se puede editar una cotización ya convertida en venta';
  end if;
  if v_estado not in ('borrador', 'enviada', 'rechazada') then
    raise exception 'No se puede editar una cotización en estado %', v_estado;
  end if;

  v_iva := coalesce(p_iva_pct, nullif(fn_get_parametro('iva_pct'), '')::numeric, 19);
  v_validez := coalesce(p_vigencia_dias, nullif(fn_get_parametro('validez_cotizacion_dias'), '')::int, 15);
  if v_iva < 0 or v_iva > 100 then
    raise exception 'iva_pct debe estar entre 0 y 100 (recibido %)', v_iva;
  end if;
  if v_validez < 1 or v_validez > 365 then
    raise exception 'vigencia_dias debe estar entre 1 y 365 (recibido %)', v_validez;
  end if;

  delete from detalle_cotizacion where cotizacion_id = p_cotizacion_id;

  for item in select * from jsonb_array_elements(p_items) loop
    v_cant := (item->>'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then
      raise exception 'Cantidad de ítem debe ser > 0';
    end if;
    v_precio_in := nullif(item->>'precio_unitario', '')::numeric;
    v_serv_id   := nullif(item->>'servicio_id', '')::bigint;

    if v_serv_id is not null then
      select nombre, precio into v_serv_nombre, v_serv_precio
        from servicios where id = v_serv_id and activo = true;
      if v_serv_nombre is null then
        raise exception 'Servicio % no encontrado o inactivo', v_serv_id;
      end if;
      v_precio := case when v_precio_in is not null and v_precio_in >= 0 then v_precio_in else v_serv_precio end;
      insert into detalle_cotizacion (cotizacion_id, producto_id, servicio_id, descripcion, cantidad, precio_unitario, subtotal)
      values (p_cotizacion_id, null, v_serv_id, v_serv_nombre, v_cant, v_precio, v_cant * v_precio);
    else
      v_prod_id := (item->>'producto_id')::uuid;
      select precio_venta into v_precio_cat from productos where id = v_prod_id and activo = true;
      if v_precio_cat is null then
        raise exception 'Producto % no encontrado o inactivo', v_prod_id;
      end if;
      v_precio := case when v_precio_in is not null and v_precio_in >= 0 then v_precio_in else v_precio_cat end;
      insert into detalle_cotizacion (cotizacion_id, producto_id, cantidad, precio_unitario, subtotal)
      values (p_cotizacion_id, v_prod_id, v_cant, v_precio, v_cant * v_precio);
    end if;

    v_subtotal := v_subtotal + v_cant * v_precio;
  end loop;

  v_desc := coalesce(p_descuento_valor, v_subtotal * coalesce(p_descuento_pct, 0) / 100);
  v_desc := greatest(0, least(v_desc, v_subtotal));
  v_total := (v_subtotal - v_desc) * (1 + v_iva / 100) + greatest(0, coalesce(p_domicilio, 0));

  update cotizaciones set
    cliente_nombre      = trim(p_cliente_nombre),
    cliente_nit         = p_cliente_nit,
    cliente_email       = p_cliente_email,
    cliente_telefono    = p_cliente_telefono,
    descuento_pct       = p_descuento_pct,
    descuento_valor     = p_descuento_valor,
    domicilio           = greatest(0, coalesce(p_domicilio, 0)),
    iva_pct             = v_iva,
    vigencia_dias       = v_validez,
    subtotal            = v_subtotal,
    total               = v_total,
    estado              = 'borrador',
    observaciones       = p_observaciones,
    condiciones_pago    = p_condiciones_pago,
    tiempo_entrega_nota = p_tiempo_entrega_nota
  where id = p_cotizacion_id;

  delete from cotizacion_cuentas_bancarias where cotizacion_id = p_cotizacion_id;
  if array_length(p_cuentas_ids, 1) > 0 then
    foreach v_cuenta_id in array p_cuentas_ids loop
      insert into cotizacion_cuentas_bancarias (cotizacion_id, cuenta_id)
      values (p_cotizacion_id, v_cuenta_id) on conflict do nothing;
    end loop;
  end if;

  return jsonb_build_object('cotizacion_id', p_cotizacion_id, 'subtotal', v_subtotal, 'total', v_total);
end;
$function$;

grant execute on function public.fn_editar_cotizacion(
  uuid, text, text, text, text, numeric, integer, numeric, text, text, text, jsonb, bigint[], numeric, numeric
) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) fn_convertir_cotizacion: traslada descuento_valor + domicilio + servicios
--    a la venta. El total de la venta lo recalcula su trigger sobre el detalle.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_convertir_cotizacion(p_cotizacion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cot cotizaciones%rowtype;
  v_det record;
  v_venta_id uuid;
  v_uid uuid := auth.uid();
  v_rol text; v_sede text;
  v_costo_prod numeric;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;

  select * into v_cot from cotizaciones where id = p_cotizacion_id for update;
  if not found then raise exception 'Cotizacion no encontrada'; end if;
  if v_rol <> 'Admin' and v_cot.sede_id <> v_sede then
    raise exception 'No tienes permiso para esta operacion';
  end if;
  if v_cot.venta_id is not null then
    raise exception 'Esta cotizacion ya fue convertida en venta';
  end if;
  if v_cot.estado <> 'aprobada' then
    raise exception 'Solo se puede convertir una cotizacion APROBADA. Estado actual: %', v_cot.estado;
  end if;

  -- El trigger trg_recalcular_total_venta recalcula subtotal/total al insertar
  -- el detalle, usando descuento_valor/descuento_pct/iva/domicilio de la venta.
  insert into ventas (
    vendedor_id, sede_id, cliente_nombre, cliente_nit,
    subtotal, descuento_pct, descuento_valor, domicilio, iva_pct, total, metodo_pago
  )
  values (
    v_uid, v_cot.sede_id, v_cot.cliente_nombre, v_cot.cliente_nit,
    v_cot.subtotal, coalesce(v_cot.descuento_pct, 0), v_cot.descuento_valor,
    coalesce(v_cot.domicilio, 0), v_cot.iva_pct, v_cot.total, 'efectivo'
  )
  returning id into v_venta_id;

  for v_det in
    select producto_id, servicio_id, descripcion, cantidad, precio_unitario, subtotal
      from detalle_cotizacion where cotizacion_id = p_cotizacion_id
  loop
    if v_det.servicio_id is not null then
      -- Línea de servicio: no toca inventario.
      insert into detalle_venta (
        venta_id, producto_id, servicio_id, descripcion,
        cantidad, precio_unitario, costo_unitario, subtotal
      ) values (
        v_venta_id, null, v_det.servicio_id, v_det.descripcion,
        v_det.cantidad, v_det.precio_unitario, 0, v_det.subtotal
      );
    else
      select coalesce(p.costo_promedio, v_det.precio_unitario)
        into v_costo_prod from productos p where p.id = v_det.producto_id;
      insert into detalle_venta (
        venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal
      ) values (
        v_venta_id, v_det.producto_id, v_det.cantidad,
        v_det.precio_unitario, coalesce(v_costo_prod, v_det.precio_unitario), v_det.subtotal
      );
    end if;
  end loop;

  update cotizaciones set venta_id = v_venta_id, updated_at = now()
   where id = p_cotizacion_id;

  return jsonb_build_object('ok', true, 'venta_id', v_venta_id);
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Abonos de cotización: registrar, total y eliminar.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_registrar_abono_cotizacion(
  p_cotizacion_id uuid,
  p_monto numeric,
  p_metodo_pago text default 'efectivo',
  p_observaciones text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text; v_sede text;
  v_cot_sede text; v_venta_id uuid;
  v_abono_id bigint;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del abono debe ser mayor a 0';
  end if;
  if p_metodo_pago not in ('efectivo', 'transferencia', 'tarjeta', 'otro') then
    raise exception 'Método de pago inválido (%)', p_metodo_pago;
  end if;

  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;
  select sede_id, venta_id into v_cot_sede, v_venta_id
    from cotizaciones where id = p_cotizacion_id;
  if v_cot_sede is null then
    raise exception 'Cotización no encontrada';
  end if;
  if v_rol not in ('Admin', 'Vendedor') then
    raise exception 'No tienes permiso para registrar abonos';
  end if;
  if v_rol <> 'Admin' and v_cot_sede <> v_sede then
    raise exception 'No puedes abonar a una cotización de otra sede';
  end if;
  if v_venta_id is not null then
    raise exception 'La cotización ya fue convertida en venta; registra el abono en la venta';
  end if;

  insert into abonos_cotizacion (cotizacion_id, monto, metodo_pago, observaciones, registrado_por)
  values (p_cotizacion_id, p_monto, p_metodo_pago, p_observaciones, v_uid)
  returning id into v_abono_id;

  return jsonb_build_object('abono_id', v_abono_id);
end;
$function$;

create or replace function public.fn_total_abonos_cotizacion(p_cotizacion_id uuid)
returns numeric
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(sum(monto), 0) from abonos_cotizacion where cotizacion_id = p_cotizacion_id;
$function$;

create or replace function public.fn_eliminar_abono_cotizacion(p_abono_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text into v_rol from usuarios where id = v_uid;
  if v_rol <> 'Admin' then
    raise exception 'Solo un Admin puede eliminar abonos';
  end if;
  delete from abonos_cotizacion where id = p_abono_id;
end;
$function$;

grant execute on function public.fn_registrar_abono_cotizacion(uuid, numeric, text, text) to authenticated;
grant execute on function public.fn_total_abonos_cotizacion(uuid) to authenticated;
grant execute on function public.fn_eliminar_abono_cotizacion(bigint) to authenticated;
