-- Bloque 3 — Ventas: vender SERVICIO además de producto.
--
-- Un detalle_venta puede ser un producto (mueve inventario) o un servicio
-- (no mueve inventario, sale del catálogo `servicios`). Se modela con XOR:
-- exactamente uno de producto_id / servicio_id está presente. Para servicios se
-- guarda `descripcion` (snapshot del nombre) para que recibos y detalle no
-- dependan de un join a productos.
--
-- RETROCOMPATIBLE: las filas existentes tienen producto_id y servicio_id NULL,
-- por lo que el check XOR se cumple. fn_registrar_venta conserva su firma (la UI
-- desplegada sigue funcionando); el loop nuevo detecta servicio_id en cada ítem.

-- 1) Esquema: producto_id nullable + servicio_id + descripcion + XOR.
alter table public.detalle_venta
  alter column producto_id drop not null;

alter table public.detalle_venta
  add column if not exists servicio_id bigint references public.servicios(id),
  add column if not exists descripcion text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.detalle_venta'::regclass
      and conname = 'detalle_venta_producto_xor_servicio'
  ) then
    alter table public.detalle_venta
      add constraint detalle_venta_producto_xor_servicio
      check ((producto_id is not null) <> (servicio_id is not null));
  end if;
end $$;

-- 2) El trigger de stock salta servicios (sin producto_id no hay inventario).
create or replace function public.trg_venta_descontar_stock()
returns trigger language plpgsql security definer
set search_path to 'public', 'pg_temp' as $function$
declare
  v_inv   record;
  v_venta record;
begin
  -- B3: las líneas de servicio no mueven inventario.
  if NEW.producto_id is null then
    return NEW;
  end if;

  select sede_id, vendedor_id into v_venta from ventas where id = NEW.venta_id;

  select id, cantidad into v_inv
  from inventario
  where producto_id = NEW.producto_id and sede_id = v_venta.sede_id
  for update;

  -- #10: si no hay fila en esa sede, la creamos en 0 para poder ir a negativo.
  if not found then
    insert into inventario (producto_id, sede_id, cantidad)
    values (NEW.producto_id, v_venta.sede_id, 0)
    on conflict (producto_id, sede_id) do nothing;

    select id, cantidad into v_inv
    from inventario
    where producto_id = NEW.producto_id and sede_id = v_venta.sede_id
    for update;
  end if;

  update inventario
  set cantidad = cantidad - NEW.cantidad,
      ultimo_movimiento = now(),
      updated_at = now()
  where id = v_inv.id;

  insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
                          referencia_id, referencia_tipo, usuario_id)
  values ('venta', NEW.producto_id, v_venta.sede_id, -NEW.cantidad,
          v_inv.cantidad, v_inv.cantidad - NEW.cantidad,
          NEW.venta_id, 'venta', v_venta.vendedor_id);

  perform fn_actualizar_estado_stock(NEW.producto_id, v_venta.sede_id);
  return NEW;
end; $function$;

-- 3) RPC: mismo nombre y firma (11 args). Cada ítem puede traer producto_id o
--    servicio_id. Para servicios se toma el nombre/precio del catálogo (precio
--    editable por línea vía precio_unitario) y no se toca inventario.
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
  v_serv_id     bigint;
  v_serv_nombre text;
  v_serv_precio numeric;
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
    v_cantidad := (item->>'cantidad')::numeric;
    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cantidad inválida en un ítem de la venta';
    end if;

    v_precio_in := nullif(item->>'precio_unitario', '')::numeric;
    v_serv_id   := nullif(item->>'servicio_id', '')::bigint;

    if v_serv_id is not null then
      -- ── Línea de servicio (no toca inventario) ──────────────────────
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
      -- ── Línea de producto (descuenta inventario vía trigger) ────────
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
