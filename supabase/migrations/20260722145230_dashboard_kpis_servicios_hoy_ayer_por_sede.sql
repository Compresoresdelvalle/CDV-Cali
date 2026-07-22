-- Agrega servicios_hoy y servicios_ayer a fn_dashboard_kpis, filtrados por sede
-- igual que ingresos_servicios_mes (v_rol='Admin' o o.sede_id=v_sede).
--
-- Motivo: el Dashboard del vendedor solo mostraba "Ventas hoy" (mostrador de su
-- sede) y no reflejaba los servicios (abonos de OT) de su sede. Con estos dos
-- campos el frontend muestra "Mostrador hoy" y "Servicios hoy" por separado,
-- ambos del día y de la sede del vendedor. Para el Admin son el total de todas
-- las sedes, como el resto de KPIs.
--
-- (Se aplicó en prod por replace() sobre la definición viva; aquí queda la
-- función completa resultante para que la migración sea determinista.)
CREATE OR REPLACE FUNCTION public.fn_dashboard_kpis()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_rol text; v_sede text;
  v_result jsonb;
  v_hoy           date := (now() at time zone 'America/Bogota')::date;
  v_semana_inicio date := date_trunc('week',  (now() at time zone 'America/Bogota'))::date;
  v_mes_inicio    date := date_trunc('month', (now() at time zone 'America/Bogota'))::date;
begin
  if v_uid is null then return jsonb_build_object('error', 'no_session'); end if;
  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;
  select jsonb_build_object(
    'ventas_hoy', (select coalesce(sum(total),0) from ventas where (fecha at time zone 'America/Bogota')::date = v_hoy and anulada = false and origen = 'directa' and (v_rol = 'Admin' or sede_id = v_sede)),
    'ventas_ayer', (select coalesce(sum(total),0) from ventas where (fecha at time zone 'America/Bogota')::date = v_hoy - 1 and anulada = false and origen = 'directa' and (v_rol = 'Admin' or sede_id = v_sede)),
    'ventas_semana', (select coalesce(sum(total),0) from ventas where (fecha at time zone 'America/Bogota')::date >= v_semana_inicio and anulada = false and origen = 'directa' and (v_rol = 'Admin' or sede_id = v_sede)),
    'ventas_semana_prev', (select coalesce(sum(total),0) from ventas where (fecha at time zone 'America/Bogota')::date >= v_semana_inicio - 7 and (fecha at time zone 'America/Bogota')::date < v_semana_inicio and anulada = false and origen = 'directa' and (v_rol = 'Admin' or sede_id = v_sede)),
    'ventas_mes', (select coalesce(sum(total),0) from ventas where (fecha at time zone 'America/Bogota')::date >= v_mes_inicio and anulada = false and origen = 'directa' and (v_rol = 'Admin' or sede_id = v_sede)),
    'ventas_mes_prev', (select coalesce(sum(total),0) from ventas where (fecha at time zone 'America/Bogota')::date >= (v_mes_inicio - interval '1 month')::date and (fecha at time zone 'America/Bogota')::date < v_mes_inicio and anulada = false and origen = 'directa' and (v_rol = 'Admin' or sede_id = v_sede)),
    'ticket_promedio_mes', (select coalesce(avg(total),0)::integer from ventas where (fecha at time zone 'America/Bogota')::date >= v_mes_inicio and anulada = false and origen = 'directa' and total > 0 and (v_rol = 'Admin' or sede_id = v_sede)),
    'devoluciones_mes', (
      select coalesce(sum(d.cantidad * coalesce(
               (select avg(dv.precio_unitario) from detalle_venta dv where dv.venta_id = d.venta_id and dv.producto_id = d.producto_id),
               p.precio_venta, 0)),0)::bigint
      from devoluciones d
      left join productos p on p.id = d.producto_id
      where d.estado = 'procesada'
        and (d.fecha at time zone 'America/Bogota')::date >= v_mes_inicio
        and (v_rol = 'Admin' or d.sede_id = v_sede)
    ),
    'devoluciones_mes_sin_venta', (
      select coalesce(sum(d.cantidad * coalesce(p.precio_venta, 0)),0)::bigint
      from devoluciones d
      left join productos p on p.id = d.producto_id
      where d.estado = 'procesada'
        and d.venta_id is null
        and (d.fecha at time zone 'America/Bogota')::date >= v_mes_inicio
        and (v_rol = 'Admin' or d.sede_id = v_sede)
    ),
    'compras_mes', (select coalesce(sum(total),0) from compras where (fecha at time zone 'America/Bogota')::date >= v_mes_inicio and estado <> 'cancelada' and (v_rol = 'Admin' or sede_destino_id = v_sede)),
    'ingresos_servicios_mes', (
      select coalesce(sum(a.monto),0) from abonos a join ordenes_servicio o on o.id = a.orden_id
      where o.estado <> 'cancelada' and (a.fecha at time zone 'America/Bogota')::date >= v_mes_inicio and (v_rol = 'Admin' or o.sede_id = v_sede)
    ),
    'anticipos_ot_sin_facturar', (
      select coalesce(sum(a.monto),0)::bigint from abonos a join ordenes_servicio o on o.id = a.orden_id
      where o.estado <> 'cancelada' and o.venta_id is null
        and (a.fecha at time zone 'America/Bogota')::date >= v_mes_inicio
        and (v_rol = 'Admin' or o.sede_id = v_sede)
    ),
    'servicios_hoy', (select coalesce(sum(a.monto),0) from abonos a join ordenes_servicio o on o.id=a.orden_id where o.estado <> 'cancelada' and (a.fecha at time zone 'America/Bogota')::date = v_hoy and (v_rol = 'Admin' or o.sede_id = v_sede)),
    'servicios_ayer', (select coalesce(sum(a.monto),0) from abonos a join ordenes_servicio o on o.id=a.orden_id where o.estado <> 'cancelada' and (a.fecha at time zone 'America/Bogota')::date = v_hoy - 1 and (v_rol = 'Admin' or o.sede_id = v_sede)),
    'total_productos_activos', (select count(*) from productos where activo = true),
    'valor_inventario', (select coalesce(sum(i.cantidad * p.costo_promedio),0)::bigint from inventario i join productos p on p.id = i.producto_id where (v_rol = 'Admin' or i.sede_id = v_sede)),
    'stock_bajo_count', (select count(*) from inventario where estado_stock = 'Bajo' and (v_rol = 'Admin' or sede_id = v_sede)),
    'stock_agotado_count', (select count(*) from inventario where estado_stock = 'Agotado' and (v_rol = 'Admin' or sede_id = v_sede)),
    'alertas_count', (select count(*) from inventario where estado_stock in ('Bajo','Agotado') and (v_rol = 'Admin' or sede_id = v_sede)),
    'ordenes_abiertas', (select count(*) from ordenes_servicio where estado not in ('entregada','cancelada') and (v_rol = 'Admin' or sede_id = v_sede)),
    'cotizaciones_vigentes', (select count(*) from cotizaciones where estado in ('borrador','enviada','aprobada') and (v_rol = 'Admin' or sede_id = v_sede)),
    'traspasos_en_transito', (select count(*) from traspasos where estado in ('en_transito','picking','verificado') and (v_rol = 'Admin' or sede_origen_id = v_sede or sede_destino_id = v_sede)),
    'herramientas_prestadas', (select count(*) from herramientas_prestamo where estado = 'prestada' and (v_rol = 'Admin' or sede_id = v_sede)),
    'ensambles_pendientes', (select count(*) from ensambles where completado = false and (v_rol = 'Admin' or sede_id = v_sede)),
    'alertas', (select coalesce(jsonb_agg(a order by (a->>'severity' = 'danger') desc), '[]'::jsonb) from (select jsonb_build_object('inventario_id', i.id, 'message', p.nombre || ' (' || i.cantidad || ' uds) — ' || s.nombre, 'severity', case i.estado_stock when 'Agotado' then 'danger' else 'warning' end) as a from inventario i join productos p on p.id = i.producto_id join sedes s on s.id = i.sede_id where i.estado_stock in ('Bajo','Agotado') and (v_rol = 'Admin' or i.sede_id = v_sede) order by (i.estado_stock = 'Agotado') desc, i.cantidad asc limit 10) sub),
    'actividad_reciente', (select coalesce(jsonb_agg(act order by act->>'created_at' desc), '[]'::jsonb) from (
      select jsonb_build_object('id', m.id, 'action', case m.tipo
        when 'venta' then 'Venta — ' || coalesce(p.nombre, '?')
        when 'compra' then 'Compra — ' || coalesce(p.nombre, '?')
        when 'traspaso_salida' then 'Traspaso salida — ' || coalesce(p.nombre, '?')
        when 'traspaso_entrada' then 'Traspaso entrada — ' || coalesce(p.nombre, '?')
        when 'devolucion' then 'Devolución — ' || coalesce(p.nombre, '?')
        when 'ajuste' then 'Ajuste — ' || coalesce(p.nombre, '?')
        when 'orden_consumo' then 'Orden — ' || coalesce(p.nombre, '?')
        when 'ensamble_consumo' then 'Ensamble (consumo) — ' || coalesce(p.nombre, '?')
        when 'ensamble_produccion' then 'Ensamble (producción) — ' || coalesce(p.nombre, '?')
        when 'conteo_ajuste' then 'Conteo — ' || coalesce(p.nombre, '?')
        else m.tipo || ' — ' || coalesce(p.nombre, '?') end,
        'user', coalesce(u.nombre, '(sistema)'),
        'type', m.tipo, 'cantidad', m.cantidad, 'created_at', m.created_at
      ) as act
      from movimientos m
      left join productos p on p.id = m.producto_id
      left join usuarios u on u.id = m.usuario_id
      where (v_rol = 'Admin' or m.sede_id = v_sede)
      order by m.created_at desc limit 15
    ) sub),
    'tendencia_7d', (select coalesce(jsonb_agg(t order by (t->>'fecha')::date), '[]'::jsonb) from (select jsonb_build_object('fecha', d::date, 'total', coalesce(sum(v.total), 0)) as t from generate_series(v_hoy - 6, v_hoy, '1 day'::interval) d left join ventas v on (v.fecha at time zone 'America/Bogota')::date = d::date and v.anulada = false and v.origen = 'directa' and (v_rol = 'Admin' or v.sede_id = v_sede) group by d) sub),
    'ventas_por_sede', (select coalesce(jsonb_agg(t order by (t->>'total')::numeric desc), '[]'::jsonb) from (select jsonb_build_object('sede', s.nombre, 'total', coalesce(sum(v.total), 0)) as t from sedes s left join ventas v on v.sede_id = s.id and (v.fecha at time zone 'America/Bogota')::date >= v_mes_inicio and v.anulada = false and v.origen = 'directa' where s.activa = true and (v_rol = 'Admin' or s.id = v_sede) group by s.id, s.nombre) sub),
    'top5_productos_mes', (select coalesce(jsonb_agg(t order by (t->>'unidades')::int desc), '[]'::jsonb) from (select jsonb_build_object('producto_id', p.id, 'nombre', p.nombre, 'referencia', p.referencia, 'unidades', sum(dv.cantidad), 'total', sum(dv.subtotal)) as t from detalle_venta dv join ventas v on v.id = dv.venta_id join productos p on p.id = dv.producto_id where (v.fecha at time zone 'America/Bogota')::date >= v_mes_inicio and v.anulada = false and v.origen = 'directa' and (v_rol = 'Admin' or v.sede_id = v_sede) group by p.id, p.nombre, p.referencia order by sum(dv.cantidad) desc limit 5) sub)
  ) into v_result;
  return v_result;
end;
$function$;
