-- MEDIO (auditoría 2026-06-09, M3): trg_venta_descontar_stock restaba del
-- inventario SIN validar disponibilidad (a diferencia de trg_traspaso_salida, que
-- sí hace RAISE 'Stock insuficiente'). Por REST directo o ventas concurrentes sobre
-- el mismo producto/sede, el inventario podía quedar NEGATIVO (sobreventa),
-- ensuciando reorden/ABC. No hay política de backorder en el modelo (la UI ya
-- bloquea vender sin stock), así que la barrera correcta es rechazar la venta.
--
-- Fix: (1) validar stock suficiente con FOR UPDATE antes de descontar (cierra la
-- ventana TOCTOU de concurrencia y el bypass por RPC/PostgREST); (2) CHECK duro
-- inventario.cantidad >= 0 como garantía a nivel BD (verificado: 0 filas negativas).

create or replace function public.trg_venta_descontar_stock()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_inv   record;
  v_venta record;
begin
  if NEW.producto_id is null then
    return NEW;
  end if;

  select sede_id, vendedor_id into v_venta from ventas where id = NEW.venta_id;

  select id, cantidad into v_inv
  from inventario
  where producto_id = NEW.producto_id and sede_id = v_venta.sede_id
  for update;

  if not found then
    insert into inventario (producto_id, sede_id, cantidad)
    values (NEW.producto_id, v_venta.sede_id, 0)
    on conflict (producto_id, sede_id) do nothing;

    select id, cantidad into v_inv
    from inventario
    where producto_id = NEW.producto_id and sede_id = v_venta.sede_id
    for update;
  end if;

  -- Integridad: no permitir sobreventa (simetría con trg_traspaso_salida).
  if coalesce(v_inv.cantidad, 0) < NEW.cantidad then
    raise exception 'Stock insuficiente en sede % para el producto % (disponible %, requerido %)',
      v_venta.sede_id, NEW.producto_id, coalesce(v_inv.cantidad, 0), NEW.cantidad;
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

alter table public.inventario
  add constraint inventario_cantidad_nonneg check (cantidad >= 0);
