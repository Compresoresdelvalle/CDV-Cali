-- ============================================================================
-- Rediseño OT — Opción A — FASE 5: Cierre y KPIs sin doble conteo (MODO DUAL).
--   ingresos_productos = ventas origen='directa'
--   ingresos_servicios = ventas origen='ot'  +  abonos aún NO conciliados
--                        (a.venta_id IS NULL) de OT no canceladas
--   → una OT convertida cuenta por su venta; sus abonos (ya con venta_id) se
--     excluyen → nunca se cuenta dos veces. Las OT viejas (sin venta) siguen
--     contando por sus abonos. Se agrega 'anticipos_recibidos' (caja, informativo).
-- ============================================================================

create or replace function public._fn_cierre_totales(p_desde date, p_hasta date, p_sede text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare
  v_productos numeric := 0;
  v_servicios numeric := 0;
  v_egresos   numeric := 0;
  v_anticipos numeric := 0;
  v_cv int := 0; v_ca int := 0; v_cc int := 0;
  v_por_sede jsonb; v_por_metodo jsonb;
begin
  select coalesce(sum(total),0), count(*) into v_productos, v_cv
  from ventas
  where anulada = false and origen = 'directa'
    and (fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or sede_id = p_sede);

  select coalesce(sum(total),0) into v_servicios
  from ventas
  where anulada = false and origen = 'ot'
    and (fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or sede_id = p_sede);

  select v_servicios + coalesce(sum(a.monto),0), count(*) into v_servicios, v_ca
  from abonos a join ordenes_servicio o on o.id = a.orden_id
  where a.venta_id is null and o.estado <> 'cancelada'
    and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or o.sede_id = p_sede);

  select coalesce(sum(a.monto),0) into v_anticipos
  from abonos a join ordenes_servicio o on o.id = a.orden_id
  where o.estado <> 'cancelada'
    and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or o.sede_id = p_sede);

  select coalesce(sum(total),0), count(*) into v_egresos, v_cc
  from compras
  where (fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and estado <> 'cancelada'
    and (p_sede is null or sede_destino_id = p_sede);

  select coalesce(jsonb_agg(jsonb_build_object(
           'sede_id', d.id, 'sede_nombre', d.nombre,
           'productos', d.productos, 'servicios', d.servicios, 'egresos', d.egresos
         ) order by d.nombre), '[]'::jsonb)
    into v_por_sede
  from (
    select se.id, se.nombre,
      coalesce((select sum(v.total) from ventas v
                where v.sede_id = se.id and v.anulada = false and v.origen = 'directa'
                  and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta), 0) as productos,
      coalesce((select sum(v.total) from ventas v
                where v.sede_id = se.id and v.anulada = false and v.origen = 'ot'
                  and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta), 0)
      + coalesce((select sum(a.monto) from abonos a join ordenes_servicio o on o.id = a.orden_id
                where o.sede_id = se.id and a.venta_id is null and o.estado <> 'cancelada'
                  and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta), 0) as servicios,
      coalesce((select sum(c.total) from compras c
                where c.sede_destino_id = se.id and c.estado <> 'cancelada'
                  and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta), 0) as egresos
    from sedes se
    where se.activa = true and (p_sede is null or se.id = p_sede)
  ) d;

  select coalesce(jsonb_agg(jsonb_build_object(
           'metodo', m.metodo, 'productos', m.productos, 'servicios', m.servicios
         ) order by m.metodo), '[]'::jsonb)
    into v_por_metodo
  from (
    select lower(t.metodo) as metodo, sum(t.productos) as productos, sum(t.servicios) as servicios
    from (
      select v.metodo_pago as metodo, v.total as productos, 0::numeric as servicios
        from ventas v
       where v.anulada = false and v.origen = 'directa'
         and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
         and (p_sede is null or v.sede_id = p_sede)
      union all
      select v.metodo_pago, 0::numeric, v.total
        from ventas v
       where v.anulada = false and v.origen = 'ot'
         and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
         and (p_sede is null or v.sede_id = p_sede)
      union all
      select a.metodo_pago, 0::numeric, a.monto
        from abonos a join ordenes_servicio o on o.id = a.orden_id
       where a.venta_id is null and o.estado <> 'cancelada'
         and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
         and (p_sede is null or o.sede_id = p_sede)
    ) t
    where t.metodo is not null
    group by lower(t.metodo)
  ) m;

  return jsonb_build_object(
    'ingresos_productos', v_productos,
    'ingresos_servicios', v_servicios,
    'ingresos_total',     v_productos + v_servicios,
    'egresos',            v_egresos,
    'margen',             v_productos + v_servicios - v_egresos,
    'anticipos_recibidos', v_anticipos,
    'count_ventas',       v_cv,
    'count_abonos',       v_ca,
    'count_compras',      v_cc,
    'detalle', jsonb_build_object(
      'por_sede',        v_por_sede,
      'por_metodo_pago', v_por_metodo,
      'generado_en',     now(),
      'tz',              'America/Bogota'
    )
  );
end;
$function$;
