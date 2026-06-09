-- Bloque 3 — Ventas: descuento en valor absoluto ($) + domicilio.
--
-- RETROCOMPATIBLE: se conserva descuento_pct (legado) y se agrega
-- descuento_valor ($) y domicilio. El trigger usa descuento_valor si viene; si
-- no, cae al % legado. Así esta migración se puede aplicar a producción sin
-- romper la UI desplegada (que aún manda p_descuento_pct); la UI nueva usará
-- descuento_valor + domicilio. El descuento reduce la base gravable; el
-- domicilio se suma DESPUÉS del IVA (no se grava).

alter table public.ventas
  add column if not exists descuento_valor numeric,
  add column if not exists domicilio numeric not null default 0
    check (domicilio >= 0);

-- Trigger de totales (retrocompatible).
create or replace function public.trg_recalcular_total_venta()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $function$
declare
  v_subtotal numeric(12,2);
  v_venta    record;
  v_desc     numeric;
begin
  select coalesce(sum(subtotal), 0) into v_subtotal
  from detalle_venta where venta_id = coalesce(NEW.venta_id, OLD.venta_id);

  select descuento_pct, descuento_valor, iva_pct, coalesce(domicilio, 0) as domicilio
    into v_venta
  from ventas where id = coalesce(NEW.venta_id, OLD.venta_id);

  -- Descuento efectivo en $: el valor absoluto si viene; si no, el % legado.
  -- Clamp a [0, subtotal] para no generar base negativa.
  v_desc := coalesce(
    v_venta.descuento_valor,
    v_subtotal * coalesce(v_venta.descuento_pct, 0) / 100
  );
  v_desc := greatest(0, least(v_desc, v_subtotal));

  update ventas set
    subtotal = v_subtotal,
    total = (v_subtotal - v_desc) * (1 + coalesce(v_venta.iva_pct, 0) / 100)
            + v_venta.domicilio
  where id = coalesce(NEW.venta_id, OLD.venta_id);

  return coalesce(NEW, OLD);
end; $function$;

-- RPC: se reemplaza por una versión con 2 parámetros nuevos (con default), de
-- modo que la UI vieja (9 args nombrados) y la nueva (con descuento_valor +
-- domicilio) llamen a la misma función sin ambigüedad.
drop function if exists public.fn_registrar_venta(
  text, text, text, text, numeric, text, jsonb, numeric, text
);

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
  p_domicilio numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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
  v_cantidad    numeric;
  v_precio      numeric;
  v_precio_cat  numeric;
  v_precio_in   numeric;
  v_costo       numeric;
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
    v_prod_id  := (item->>'producto_id')::uuid;
    v_cantidad := (item->>'cantidad')::numeric;

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cantidad inválida para el producto %', v_prod_id;
    end if;

    v_precio_in := nullif(item->>'precio_unitario', '')::numeric;

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
  end loop;

  return (
    select jsonb_build_object(
      'venta_id', v.id, 'numero', v.numero, 'total', v.total, 'fecha', v.fecha
    ) from ventas v where v.id = v_venta_id
  );
end;
$function$;

grant execute on function public.fn_registrar_venta(
  text, text, text, text, numeric, text, jsonb, numeric, text, numeric, numeric
) to authenticated;
