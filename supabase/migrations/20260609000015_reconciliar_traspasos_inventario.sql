-- Reconciliación de inventario por el bug del trigger de salida de traspasos:
-- 19 traspasos 'recibido' sumaron al destino pero NUNCA restaron del origen
-- (iban picking->en_transito y el trigger de salida solo restaba desde
-- 'verificado'). El trigger ya está corregido para los traspasos nuevos; esto
-- corrige el stock histórico.
--
-- Por cada línea de esos traspasos resta del ORIGEN lo enviado y registra el
-- movimiento 'traspaso_salida' que faltó. Nunca baja de 0 (no hay stock físico
-- negativo): si el origen ya no tiene lo suficiente, resta lo disponible y lo
-- anota como parcial. Idempotente: solo afecta traspasos que aún no tienen
-- salida registrada.

do $$
declare
  r        record;
  v_cant   integer;   -- stock actual en origen
  v_enviar integer;   -- lo que se envió
  v_sub    integer;   -- lo que efectivamente se puede restar
begin
  for r in
    select t.id as traspaso_id, t.sede_origen_id, t.solicitado_por,
           d.producto_id, coalesce(d.cantidad_enviada, d.cantidad_solicitada) as enviar
    from traspasos t
    join detalle_traspaso d on d.traspaso_id = t.id
    where t.estado in ('en_transito','recibido','con_diferencia')
      and exists (select 1 from movimientos m where m.referencia_id=t.id and m.tipo::text='traspaso_entrada')
      and not exists (select 1 from movimientos m where m.referencia_id=t.id and m.tipo::text='traspaso_salida')
    order by t.numero, d.producto_id
  loop
    v_enviar := coalesce(r.enviar, 0);
    if v_enviar <= 0 then continue; end if;

    select cantidad into v_cant
      from inventario where producto_id=r.producto_id and sede_id=r.sede_origen_id
      for update;
    v_cant := coalesce(v_cant, 0);
    v_sub  := least(v_enviar, v_cant);   -- nunca por debajo de 0

    if v_sub > 0 then
      update inventario set cantidad = cantidad - v_sub,
        ultimo_movimiento = now(), updated_at = now()
       where producto_id=r.producto_id and sede_id=r.sede_origen_id;
      perform fn_actualizar_estado_stock(r.producto_id, r.sede_origen_id);
    end if;

    insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, observaciones)
    values ('traspaso_salida', r.producto_id, r.sede_origen_id, -v_sub,
      v_cant, v_cant - v_sub, r.traspaso_id, 'traspaso', r.solicitado_por,
      'Reconciliación salida no aplicada (bug picking->en_transito)'
      || case when v_sub < v_enviar
              then ' — PARCIAL: faltaron ' || (v_enviar - v_sub) || ' por stock insuficiente'
              else '' end);
  end loop;
end $$;
