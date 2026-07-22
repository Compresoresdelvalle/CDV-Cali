-- FALTANTE EN TRASPASO: devolver a origen vs. merma
--
-- Antes: cuando un traspaso se recibía con `recibido < enviado`, el faltante
-- (enviado − recibido) SIEMPRE se daba de baja como merma/pérdida en la sede
-- destino. Esa regla asume que lo que falta se perdió en el tránsito. Pero el
-- caso real observado (traspaso #368, 2026-07-22) fue un RECHAZO: la vendedora
-- marcó recibido=0 esperando que la mercancía volviera a BODEGA, y en cambio se
-- registró como pérdida. La empresa quedó con 10 unidades menos en los libros
-- aunque físicamente seguían en BODEGA.
--
-- Ahora: quien recibe decide, por línea, qué pasa con el faltante:
--   * faltante_a_origen = true  (DEFAULT, seguro): el faltante se ACREDITA de
--     vuelta en la sede origen. La empresa no pierde nada (neto 0).
--   * faltante_a_origen = false: merma/pérdida en el destino (comportamiento
--     anterior, ahora explícito y con aviso en la UI).
--
-- Invariante preservada: inventario = SUM(movimientos) por (producto, sede).
-- La rama de merma queda idéntica a antes (cero regresión). Ambas correcciones
-- usan tipo 'ajuste' con observación rotulada, sin enums nuevos ni cambios de UI
-- de reportes (en Auditoría 'ajuste' ya se agrupa como "Inventario").

-- 1) Columna de decisión por línea. Default true = no perder plata por defecto.
alter table public.detalle_traspaso
  add column if not exists faltante_a_origen boolean not null default true;

-- 2) fn_procesar_traspaso: guardar la decisión por línea en 'recibir'.
create or replace function public.fn_procesar_traspaso(p_traspaso_id uuid, p_accion text, p_items jsonb default null::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid; v_estado text; v_picker uuid; v_origen text; v_destino text;
  v_mi_sede text; v_mi_rol text; v_item jsonb; v_hay_diff boolean; v_count int;
  v_env integer; v_rec integer; v_envia integer; v_sol integer;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select estado::text, picker_id, sede_origen_id, sede_destino_id
    into v_estado, v_picker, v_origen, v_destino from traspasos where id = p_traspaso_id for update;
  if not found then raise exception 'Traspaso no encontrado'; end if;
  select sede_id, rol::text into v_mi_sede, v_mi_rol from usuarios where id = v_uid;
  if v_mi_rol not in ('Admin','Bodeguero','Vendedor') then raise exception 'No tienes permiso para operar traspasos (rol %)', v_mi_rol; end if;

  if p_accion = 'iniciar_picking' then
    if v_estado <> 'borrador' then raise exception 'Solo se puede iniciar picking en estado Pendiente. Estado actual: %', v_estado; end if;
    if v_mi_rol <> 'Admin' and v_mi_sede <> v_origen then raise exception 'Solo personal de la sede origen (%) puede hacer picking', v_origen; end if;
    update traspasos set estado = 'picking', picker_id = v_uid, fecha_picking = now(), updated_at = now() where id = p_traspaso_id;
    return jsonb_build_object('ok', true, 'estado', 'picking');

  elsif p_accion = 'actualizar_items' then
    if v_estado <> 'picking' then raise exception 'Solo se puede actualizar items en estado En Picking'; end if;
    if v_uid <> v_picker and v_mi_rol <> 'Admin' then
      raise exception 'Solo el picker asignado o un Admin puede actualizar los items del picking';
    end if;
    for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
      v_env := (v_item->>'cantidad_enviada')::integer;
      if v_env is not null and v_env < 0 then raise exception 'cantidad_enviada no puede ser negativa (recibido %)', v_env; end if;
      if v_env is not null then
        select cantidad_solicitada into v_sol from detalle_traspaso where id = (v_item->>'detalle_id')::uuid and traspaso_id = p_traspaso_id;
        if v_sol is null then raise exception 'Ítem de traspaso no encontrado'; end if;
        if v_env > v_sol then
          raise exception 'No puedes enviar más de lo solicitado (solicitado %, intentas enviar %)', v_sol, v_env;
        end if;
      end if;
      update detalle_traspaso set
        cantidad_enviada = coalesce(v_env, cantidad_enviada),
        picking_completado = coalesce((v_item->>'picking_completado')::boolean, picking_completado)
      where id = (v_item->>'detalle_id')::uuid and traspaso_id = p_traspaso_id;
    end loop;
    return jsonb_build_object('ok', true, 'accion', 'actualizar_items');

  elsif p_accion = 'verificar' then
    if v_estado <> 'picking' then raise exception 'Solo se puede verificar un traspaso En Picking. Estado actual: %', v_estado; end if;
    if v_mi_rol <> 'Admin' and v_mi_sede <> v_origen then raise exception 'Solo personal de la sede origen (%) puede verificar', v_origen; end if;
    select count(*) into v_count from detalle_traspaso where traspaso_id = p_traspaso_id and picking_completado = false;
    if v_count > 0 then raise exception 'Hay % item(s) que no han sido completados en el picking', v_count; end if;
    update traspasos set estado = 'verificado', verificado_por = v_uid, fecha_verificacion = now(), updated_at = now() where id = p_traspaso_id;
    return jsonb_build_object('ok', true, 'estado', 'verificado');

  elsif p_accion = 'enviar' then
    if v_estado not in ('picking','verificado') then raise exception 'Solo se puede enviar un traspaso en Picking o Verificado. Estado actual: %', v_estado; end if;
    if v_mi_rol <> 'Admin' and v_mi_sede <> v_origen then raise exception 'Solo personal de la sede origen (%) puede enviar', v_origen; end if;
    if v_estado = 'picking' then
      select count(*) into v_count from detalle_traspaso where traspaso_id = p_traspaso_id and picking_completado = false;
      if v_count > 0 then raise exception 'Hay % item(s) sin completar en el picking antes de enviar', v_count; end if;
    end if;
    update detalle_traspaso set cantidad_enviada = cantidad_solicitada
     where traspaso_id = p_traspaso_id and picking_completado = true and coalesce(cantidad_enviada,0) <= 0 and cantidad_solicitada > 0;
    if exists (select 1 from detalle_traspaso where traspaso_id = p_traspaso_id and (cantidad_enviada is null or cantidad_enviada <= 0)) then
      raise exception 'Todos los items deben tener cantidad enviada (> 0) antes de enviar';
    end if;
    update traspasos set estado = 'en_transito', verificado_por = coalesce(verificado_por, v_uid), fecha_verificacion = coalesce(fecha_verificacion, now()), updated_at = now() where id = p_traspaso_id;
    return jsonb_build_object('ok', true, 'estado', 'en_transito');

  elsif p_accion = 'recibir' then
    if v_estado <> 'en_transito' then raise exception 'Solo se puede recibir un traspaso En Tránsito. Estado actual: %', v_estado; end if;
    if v_mi_rol <> 'Admin' and v_mi_sede <> v_destino then raise exception 'Solo usuarios de la sede destino (%) pueden confirmar la recepción', v_destino; end if;
    for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
      v_rec := coalesce((v_item->>'cantidad_recibida')::integer, 0);
      select cantidad_enviada into v_envia from detalle_traspaso where id = (v_item->>'detalle_id')::uuid and traspaso_id = p_traspaso_id;
      if not found then raise exception 'Ítem de traspaso no encontrado'; end if;
      if v_rec < 0 or v_rec > coalesce(v_envia,0) then raise exception 'cantidad_recibida (%) debe estar entre 0 y lo enviado (%)', v_rec, coalesce(v_envia,0); end if;
      update detalle_traspaso set
        cantidad_recibida = v_rec,
        -- Decisión sobre el faltante. Default seguro: vuelve a origen (true).
        faltante_a_origen = coalesce((v_item->>'faltante_a_origen')::boolean, true)
      where id = (v_item->>'detalle_id')::uuid and traspaso_id = p_traspaso_id;
    end loop;
    select exists(select 1 from detalle_traspaso where traspaso_id = p_traspaso_id and cantidad_recibida <> cantidad_enviada) into v_hay_diff;
    if v_hay_diff then
      update traspasos set estado = 'con_diferencia', recibido_por = v_uid, fecha_recepcion = now(), updated_at = now() where id = p_traspaso_id;
      return jsonb_build_object('ok', true, 'estado', 'con_diferencia', 'hay_diferencia', true);
    else
      update traspasos set estado = 'recibido', recibido_por = v_uid, fecha_recepcion = now(), updated_at = now() where id = p_traspaso_id;
      return jsonb_build_object('ok', true, 'estado', 'recibido', 'hay_diferencia', false);
    end if;
  else
    raise exception 'Acción no válida: %. Opciones: iniciar_picking, actualizar_items, verificar, enviar, recibir', p_accion;
  end if;
end;
$function$;

-- 3) trg_traspaso_entrada: manejar el faltante según faltante_a_origen.
--    * Rama merma (false): IDÉNTICA al comportamiento anterior.
--    * Rama a-origen (true): baja el faltante en destino y lo acredita de vuelta
--      en la sede origen. Neto empresa = 0.
create or replace function public.trg_traspaso_entrada()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_det record; v_stock_ant integer; v_enviada integer; v_recibida integer;
  v_faltante integer; v_stock_post integer; v_a_origen boolean; v_stock_ori integer;
begin
  if new.estado in ('recibido','con_diferencia') and old.estado = 'en_transito' then
    perform pg_advisory_xact_lock(hashtext('traspaso:' || new.id::text));
    for v_det in select * from detalle_traspaso where traspaso_id = new.id loop
      v_enviada  := coalesce(v_det.cantidad_enviada, v_det.cantidad_solicitada);
      v_recibida := coalesce(v_det.cantidad_recibida, v_enviada);
      v_faltante := v_enviada - v_recibida;
      v_a_origen := coalesce(v_det.faltante_a_origen, true);

      if v_det.es_insumo then
        -- ENTRADA al destino: total despachado.
        select cantidad_insumo into v_stock_ant from inventario where producto_id = v_det.producto_id and sede_id = new.sede_destino_id for update;
        v_stock_ant := coalesce(v_stock_ant, 0);
        insert into inventario (producto_id, sede_id, cantidad_insumo) values (v_det.producto_id, new.sede_destino_id, v_enviada)
        on conflict (producto_id, sede_id) do update set cantidad_insumo = inventario.cantidad_insumo + v_enviada, ultimo_movimiento = now(), updated_at = now();
        insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
        values ('traspaso_entrada', v_det.producto_id, new.sede_destino_id, v_enviada, v_stock_ant, v_stock_ant + v_enviada, new.id, 'traspaso', new.solicitado_por, 'Insumo');

        if v_faltante > 0 then
          v_stock_post := v_stock_ant + v_enviada;
          -- Baja el faltante en destino (destino queda en lo realmente recibido).
          update inventario set cantidad_insumo = cantidad_insumo - v_faltante, ultimo_movimiento = now(), updated_at = now()
           where producto_id = v_det.producto_id and sede_id = new.sede_destino_id;

          if v_a_origen then
            insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
            values ('ajuste', v_det.producto_id, new.sede_destino_id, -v_faltante, v_stock_post, v_stock_post - v_faltante, new.id, 'traspaso',
                    coalesce(new.recibido_por, new.solicitado_por),
                    'Insumo - Devuelto a origen: no recibido en traspaso #' || new.numero || ' (enviado ' || v_enviada || ', recibido ' || v_recibida || ')');
            -- Acredita el faltante de vuelta en la sede origen.
            select cantidad_insumo into v_stock_ori from inventario where producto_id = v_det.producto_id and sede_id = new.sede_origen_id for update;
            v_stock_ori := coalesce(v_stock_ori, 0);
            insert into inventario (producto_id, sede_id, cantidad_insumo) values (v_det.producto_id, new.sede_origen_id, v_faltante)
            on conflict (producto_id, sede_id) do update set cantidad_insumo = inventario.cantidad_insumo + v_faltante, ultimo_movimiento = now(), updated_at = now();
            insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
            values ('ajuste', v_det.producto_id, new.sede_origen_id, v_faltante, v_stock_ori, v_stock_ori + v_faltante, new.id, 'traspaso',
                    coalesce(new.recibido_por, new.solicitado_por),
                    'Insumo - Devolución a origen: no recibido en traspaso #' || new.numero || ' (enviado ' || v_enviada || ', recibido ' || v_recibida || ')');
          else
            insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
            values ('ajuste', v_det.producto_id, new.sede_destino_id, -v_faltante, v_stock_post, v_stock_post - v_faltante, new.id, 'traspaso',
                    coalesce(new.recibido_por, new.solicitado_por),
                    'Insumo - Merma: faltante en traspaso #' || new.numero || ' (enviado ' || v_enviada || ', recibido ' || v_recibida || ')');
          end if;
        end if;
      else
        -- ENTRADA al destino: total despachado.
        select cantidad into v_stock_ant from inventario where producto_id = v_det.producto_id and sede_id = new.sede_destino_id for update;
        v_stock_ant := coalesce(v_stock_ant, 0);
        insert into inventario (producto_id, sede_id, cantidad) values (v_det.producto_id, new.sede_destino_id, v_enviada)
        on conflict (producto_id, sede_id) do update set cantidad = inventario.cantidad + v_enviada, ultimo_movimiento = now(), updated_at = now();
        insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id)
        values ('traspaso_entrada', v_det.producto_id, new.sede_destino_id, v_enviada, v_stock_ant, v_stock_ant + v_enviada, new.id, 'traspaso', new.solicitado_por);

        if v_faltante > 0 then
          v_stock_post := v_stock_ant + v_enviada;
          -- Baja el faltante en destino (destino queda en lo realmente recibido).
          update inventario set cantidad = cantidad - v_faltante, ultimo_movimiento = now(), updated_at = now()
           where producto_id = v_det.producto_id and sede_id = new.sede_destino_id;

          if v_a_origen then
            insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
            values ('ajuste', v_det.producto_id, new.sede_destino_id, -v_faltante, v_stock_post, v_stock_post - v_faltante, new.id, 'traspaso',
                    coalesce(new.recibido_por, new.solicitado_por),
                    'Devuelto a origen: no recibido en traspaso #' || new.numero || ' (enviado ' || v_enviada || ', recibido ' || v_recibida || ')');
            -- Acredita el faltante de vuelta en la sede origen.
            select cantidad into v_stock_ori from inventario where producto_id = v_det.producto_id and sede_id = new.sede_origen_id for update;
            v_stock_ori := coalesce(v_stock_ori, 0);
            insert into inventario (producto_id, sede_id, cantidad) values (v_det.producto_id, new.sede_origen_id, v_faltante)
            on conflict (producto_id, sede_id) do update set cantidad = inventario.cantidad + v_faltante, ultimo_movimiento = now(), updated_at = now();
            insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
            values ('ajuste', v_det.producto_id, new.sede_origen_id, v_faltante, v_stock_ori, v_stock_ori + v_faltante, new.id, 'traspaso',
                    coalesce(new.recibido_por, new.solicitado_por),
                    'Devolución a origen: no recibido en traspaso #' || new.numero || ' (enviado ' || v_enviada || ', recibido ' || v_recibida || ')');
            perform fn_actualizar_estado_stock(v_det.producto_id, new.sede_origen_id);
          else
            insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
            values ('ajuste', v_det.producto_id, new.sede_destino_id, -v_faltante, v_stock_post, v_stock_post - v_faltante, new.id, 'traspaso',
                    coalesce(new.recibido_por, new.solicitado_por),
                    'Merma: faltante en traspaso #' || new.numero || ' (enviado ' || v_enviada || ', recibido ' || v_recibida || ')');
          end if;
        end if;
        perform fn_actualizar_estado_stock(v_det.producto_id, new.sede_destino_id);
      end if;
    end loop;
  end if;
  return new;
end;
$function$;
