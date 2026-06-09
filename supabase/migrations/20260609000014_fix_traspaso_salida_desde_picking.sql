-- BUG: el traspaso sumaba al inventario del destino pero NO restaba del origen.
--
-- trg_traspaso_salida solo restaba del origen cuando OLD.estado = 'verificado'.
-- Desde el Bloque 6 (un solo vendedor: hace picking y envía) un traspaso va
-- 'picking' -> 'en_transito' directo, SIN pasar por 'verificado', así que el
-- trigger de salida nunca se disparaba y el stock del origen no se descontaba
-- (mientras el de entrada sí sumaba al destino → inventario inflado).
--
-- Fix: disparar la salida al entrar a 'en_transito' desde 'verificado' O
-- 'picking'. (en_transito solo se alcanza vía la acción 'enviar' desde esos dos
-- estados, así que no hay doble conteo.)

create or replace function public.trg_traspaso_salida()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_det record; v_cant integer; v_enviar integer;
begin
  if new.estado = 'en_transito' and old.estado in ('verificado', 'picking') then
    perform pg_advisory_xact_lock(hashtext('traspaso:' || new.id::text));
    for v_det in select * from detalle_traspaso where traspaso_id = new.id loop
      v_enviar := coalesce(v_det.cantidad_enviada, v_det.cantidad_solicitada);
      select cantidad into v_cant
        from inventario where producto_id = v_det.producto_id and sede_id = new.sede_origen_id
        for update;
      if v_cant is null or v_cant < v_enviar then
        raise exception 'Stock insuficiente en sede origen';
      end if;
      update inventario set cantidad = cantidad - v_enviar,
        ultimo_movimiento = now(), updated_at = now()
       where producto_id = v_det.producto_id and sede_id = new.sede_origen_id;
      insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id)
      values ('traspaso_salida', v_det.producto_id, new.sede_origen_id, -v_enviar,
        v_cant, v_cant - v_enviar, new.id, 'traspaso', new.solicitado_por);
      perform fn_actualizar_estado_stock(v_det.producto_id, new.sede_origen_id);
    end loop;
  end if;
  return new;
end; $function$;
