-- ============================================================================
-- Reporte clienta (#2): PAGO MIXTO — una venta pagada combinando varias formas
-- (efectivo + transferencia) en una sola factura.
--
-- Modelo: tabla pagos_venta con el desglose. Una venta mixta queda con
-- metodo_pago='Mixto' y sus filas en pagos_venta. Las ventas de un solo método
-- siguen igual (metodo_pago directo, sin filas en pagos_venta) → cero impacto en
-- lo existente. El cierre (migración siguiente) reparte las ventas 'Mixto' por
-- pagos_venta en los desgloses por método/cuenta y en el arqueo de efectivo.
-- ============================================================================

create table if not exists public.pagos_venta (
  id uuid primary key default uuid_generate_v4(),
  venta_id uuid not null references public.ventas(id) on delete cascade,
  metodo_pago text not null,
  cuenta_bancaria text,
  monto numeric not null check (monto > 0),
  created_at timestamptz default now()
);
create index if not exists idx_pagos_venta_venta on public.pagos_venta(venta_id);

alter table public.pagos_venta enable row level security;
-- Lectura: cualquier autenticado (es el detalle de pago de una venta que ya ve).
drop policy if exists pv_select on public.pagos_venta;
create policy pv_select on public.pagos_venta for select using (auth.uid() is not null);
-- Sin INSERT/UPDATE/DELETE directos: solo se crean vía fn_registrar_venta
-- (SECURITY DEFINER, salta RLS). No se definen políticas de escritura.

-- fn_registrar_venta: parámetro opcional p_pagos (array de {metodo, cuenta, monto}).
-- Si viene, la venta se marca 'Mixto', se valida que la suma = total y se guardan
-- las formas de pago en pagos_venta. Si no viene, comportamiento idéntico al actual.
-- Se DROPEA la versión de 11 parámetros para no dejar una sobrecarga ambigua;
-- la nueva (con p_pagos default null) atiende igual las llamadas de 11 argumentos.
drop function if exists public.fn_registrar_venta(text,text,text,text,numeric,text,jsonb,numeric,text,numeric,numeric);

create or replace function public.fn_registrar_venta(
  p_sede_id text,
  p_cliente_nombre text default null,
  p_cliente_nit text default null,
  p_metodo_pago text default 'Efectivo',
  p_descuento_pct numeric default 0,
  p_observaciones text default null,
  p_items jsonb default '[]'::jsonb,
  p_iva_pct numeric default 19,
  p_cuenta_bancaria text default null,
  p_descuento_valor numeric default null,
  p_domicilio numeric default 0,
  p_pagos jsonb default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_vendedor_id uuid;
  v_mi_sede     text;
  v_mi_rol      text;
  v_venta_id    uuid;
  v_numero      int;
  v_iva         numeric;
  item          jsonb;
  v_prod_id     uuid;
  v_serv_id     bigint;
  v_serv_nombre text;
  v_serv_precio numeric;
  v_cantidad    numeric;
  v_precio      numeric;
  v_precio_cat  numeric;
  v_precio_in   numeric;
  v_costo       numeric;
  pago          jsonb;
  v_pm          text;
  v_pmonto      numeric;
  v_suma        numeric := 0;
  v_total_real  numeric;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe tener al menos un ítem';
  end if;

  v_vendedor_id := auth.uid();
  if v_vendedor_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  select sede_id, rol::text into v_mi_sede, v_mi_rol
    from usuarios where id = v_vendedor_id;

  if v_mi_rol is null or v_mi_rol not in ('Admin', 'Vendedor') then
    raise exception 'No tienes permiso para registrar ventas (rol %)', coalesce(v_mi_rol, 'desconocido');
  end if;

  if v_mi_rol <> 'Admin' and v_mi_sede is distinct from p_sede_id then
    raise exception 'No puedes vender desde otra sede. Tu sede es %, la sede solicitada es %', v_mi_sede, p_sede_id;
  end if;

  v_iva := greatest(0, least(100, coalesce(p_iva_pct, 19)));

  insert into ventas (
    vendedor_id, sede_id, cliente_nombre, cliente_nit,
    metodo_pago, descuento_pct, descuento_valor, domicilio, iva_pct,
    observaciones, subtotal, total, cuenta_bancaria
  ) values (
    v_vendedor_id, p_sede_id, p_cliente_nombre, p_cliente_nit,
    p_metodo_pago, p_descuento_pct, p_descuento_valor, greatest(0, coalesce(p_domicilio, 0)), v_iva,
    p_observaciones, 0, 0, nullif(btrim(coalesce(p_cuenta_bancaria, '')), '')
  )
  returning id, numero into v_venta_id, v_numero;

  for item in select * from jsonb_array_elements(p_items)
  loop
    v_cantidad := (item->>'cantidad')::numeric;
    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cantidad inválida en un ítem de la venta';
    end if;

    v_precio_in := nullif(item->>'precio_unitario', '')::numeric;
    v_serv_id   := nullif(item->>'servicio_id', '')::bigint;

    if v_serv_id is not null then
      select nombre, precio into v_serv_nombre, v_serv_precio
        from servicios where id = v_serv_id and activo = true;

      if v_serv_nombre is null then
        raise exception 'Servicio % no encontrado o inactivo', v_serv_id;
      end if;

      v_precio := case
        when v_precio_in is not null and v_precio_in >= 0 then v_precio_in
        else v_serv_precio
      end;

      insert into detalle_venta (
        venta_id, producto_id, servicio_id, descripcion,
        cantidad, precio_unitario, costo_unitario, subtotal, precio_catalogo
      ) values (
        v_venta_id, null, v_serv_id, v_serv_nombre,
        v_cantidad, v_precio, 0, v_cantidad * v_precio, v_serv_precio
      );
    else
      v_prod_id := (item->>'producto_id')::uuid;

      select precio_venta, coalesce(costo_promedio, 0)
        into v_precio_cat, v_costo
        from productos where id = v_prod_id and activo = true;

      if v_precio_cat is null then
        raise exception 'Producto % no encontrado o inactivo', v_prod_id;
      end if;

      v_precio := case
        when v_precio_in is not null and v_precio_in >= 0 then v_precio_in
        else v_precio_cat
      end;

      insert into detalle_venta (
        venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal,
        precio_catalogo
      ) values (
        v_venta_id, v_prod_id, v_cantidad, v_precio, v_costo, v_cantidad * v_precio,
        v_precio_cat
      );
    end if;
  end loop;

  -- PAGO MIXTO: si vienen varias formas de pago, validar y registrar el desglose.
  if p_pagos is not null and jsonb_array_length(p_pagos) > 0 then
    select total into v_total_real from ventas where id = v_venta_id;
    for pago in select * from jsonb_array_elements(p_pagos)
    loop
      v_pm := btrim(coalesce(pago->>'metodo_pago', ''));
      v_pmonto := round(coalesce((pago->>'monto')::numeric, 0));
      if v_pm = '' then raise exception 'Cada pago debe indicar el método'; end if;
      if v_pmonto <= 0 then raise exception 'Cada pago debe tener un monto mayor a 0'; end if;
      insert into pagos_venta (venta_id, metodo_pago, cuenta_bancaria, monto)
      values (v_venta_id, v_pm, nullif(btrim(coalesce(pago->>'cuenta_bancaria','')), ''), v_pmonto);
      v_suma := v_suma + v_pmonto;
    end loop;
    if abs(v_suma - coalesce(v_total_real,0)) > 1 then
      raise exception 'La suma de los pagos (%) no coincide con el total de la venta (%)', v_suma, v_total_real;
    end if;
    -- Marcar la venta como mixta (el desglose real queda en pagos_venta).
    update ventas set metodo_pago = 'Mixto', cuenta_bancaria = null where id = v_venta_id;
  end if;

  return (
    select jsonb_build_object(
      'venta_id', v.id, 'numero', v.numero, 'total', v.total, 'fecha', v.fecha
    ) from ventas v where v.id = v_venta_id
  );
end;
$function$;

revoke execute on function public.fn_registrar_venta(text,text,text,text,numeric,text,jsonb,numeric,text,numeric,numeric,jsonb) from public, anon;
grant execute on function public.fn_registrar_venta(text,text,text,text,numeric,text,jsonb,numeric,text,numeric,numeric,jsonb) to authenticated;
