-- ============================================================================
-- Cierres — Vista Avanzada (Task 1): desgloses nuevos en _fn_cierre_totales.
-- Aditivo y retrocompatible: conserva los campos existentes del jsonb `detalle`
-- (por_sede, por_metodo_pago) y agrega:
--   - por_sede_metodo : matriz sede × método (ingresos y egresos)
--   - por_cuenta      : sede × cuenta bancaria (ingresos y egresos)
--   - egresos_detalle : cada compra (en qué se fue el dinero)
--   - por_producto    : productos vendidos por sede
--   - arqueo_esperado : efectivo esperado por sede (derivado)
-- La base de ingresos por método/cuenta es la misma que los totales
-- (ventas directa+ot + abonos sin venta) para no descuadrar.
-- ============================================================================

create or replace function public._fn_cierre_totales(p_desde date, p_hasta date, p_sede text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_productos numeric := 0;
  v_servicios numeric := 0;
  v_egresos   numeric := 0;
  v_anticipos numeric := 0;
  v_cv int := 0; v_ca int := 0; v_cc int := 0;
  v_por_sede jsonb; v_por_metodo jsonb;
  v_por_sede_metodo jsonb; v_por_cuenta jsonb;
  v_egresos_detalle jsonb; v_por_producto jsonb; v_arqueo_esp jsonb;
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

  -- ── por_sede (existente) ───────────────────────────────────────────────
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

  -- ── por_metodo_pago (existente) ────────────────────────────────────────
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

  -- ── por_sede_metodo (NUEVO): matriz sede × método ─────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
           'sede_id', x.sede_id, 'sede_nombre', x.sede_nombre,
           'metodo', x.metodo, 'ingresos', x.ingresos, 'egresos', x.egresos
         ) order by x.sede_nombre, x.metodo), '[]'::jsonb)
    into v_por_sede_metodo
  from (
    select se.id as sede_id, se.nombre as sede_nombre, m.metodo,
           coalesce(sum(m.ingresos),0) as ingresos, coalesce(sum(m.egresos),0) as egresos
    from sedes se
    join (
        select v.sede_id as sede_id, lower(v.metodo_pago) as metodo, v.total as ingresos, 0::numeric as egresos
          from ventas v
         where v.anulada=false and v.origen in ('directa','ot')
           and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all
        select o.sede_id, lower(a.metodo_pago), a.monto, 0::numeric
          from abonos a join ordenes_servicio o on o.id=a.orden_id
         where a.venta_id is null and o.estado<>'cancelada'
           and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all
        select c.sede_destino_id, lower(c.metodo_pago), 0::numeric, c.total
          from compras c
         where c.estado<>'cancelada'
           and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    ) m on m.sede_id = se.id
    where se.activa=true and (p_sede is null or se.id=p_sede)
      and m.metodo is not null
    group by se.id, se.nombre, m.metodo
  ) x;

  -- ── por_cuenta (NUEVO): sede × cuenta bancaria ────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
           'sede_id', x.sede_id, 'sede_nombre', x.sede_nombre,
           'cuenta', x.cuenta, 'ingresos', x.ingresos, 'egresos', x.egresos
         ) order by x.sede_nombre, x.cuenta nulls first), '[]'::jsonb)
    into v_por_cuenta
  from (
    select se.id as sede_id, se.nombre as sede_nombre, m.cuenta,
           coalesce(sum(m.ingresos),0) as ingresos, coalesce(sum(m.egresos),0) as egresos
    from sedes se
    join (
        select v.sede_id, nullif(trim(v.cuenta_bancaria),'') as cuenta, v.total as ingresos, 0::numeric as egresos
          from ventas v
         where v.anulada=false and v.origen in ('directa','ot')
           and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all
        select c.sede_destino_id, nullif(trim(c.cuenta_bancaria),''), 0::numeric, c.total
          from compras c
         where c.estado<>'cancelada'
           and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    ) m on m.sede_id = se.id
    where se.activa=true and (p_sede is null or se.id=p_sede)
    group by se.id, se.nombre, m.cuenta
  ) x;

  -- ── egresos_detalle (NUEVO): cada compra (en qué se fue el dinero) ─────
  select coalesce(jsonb_agg(jsonb_build_object(
           'sede_id', c.sede_destino_id, 'sede_nombre', se.nombre,
           'proveedor', c.proveedor, 'concepto', c.concepto,
           'es_caja_menor', c.es_caja_menor, 'factura', c.factura_proveedor,
           'metodo', lower(c.metodo_pago), 'cuenta', nullif(trim(c.cuenta_bancaria),''),
           'total', c.total, 'fecha', (c.fecha at time zone 'America/Bogota')::date
         ) order by se.nombre, c.fecha), '[]'::jsonb)
    into v_egresos_detalle
  from compras c join sedes se on se.id=c.sede_destino_id
  where c.estado<>'cancelada'
    and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or c.sede_destino_id=p_sede);

  -- ── por_producto (NUEVO): productos vendidos por sede ─────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
           'sede_id', x.sede_id, 'sede_nombre', x.sede_nombre,
           'referencia', x.referencia, 'nombre', x.nombre,
           'unidades', x.unidades, 'ingreso', x.ingreso
         ) order by x.sede_nombre, x.ingreso desc), '[]'::jsonb)
    into v_por_producto
  from (
    select v.sede_id, se.nombre as sede_nombre, p.referencia, p.nombre,
           sum(dv.cantidad) as unidades, sum(dv.subtotal) as ingreso
    from detalle_venta dv
    join ventas v on v.id=dv.venta_id
    join sedes se on se.id=v.sede_id
    join productos p on p.id=dv.producto_id
    where dv.producto_id is not null and v.anulada=false
      and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
      and (p_sede is null or v.sede_id=p_sede)
    group by v.sede_id, se.nombre, p.referencia, p.nombre
  ) x;

  -- ── arqueo_esperado (NUEVO): efectivo esperado por sede ───────────────
  select coalesce(jsonb_agg(jsonb_build_object(
           'sede_id', x.sede_id, 'sede_nombre', x.sede_nombre,
           'efectivo_esperado', x.esperado
         ) order by x.sede_nombre), '[]'::jsonb)
    into v_arqueo_esp
  from (
    select se.id as sede_id, se.nombre as sede_nombre,
      coalesce((select sum(case when lower(v.metodo_pago)='efectivo' then v.total else 0 end)
                from ventas v where v.sede_id=se.id and v.anulada=false and v.origen='directa'
                  and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
     + coalesce((select sum(case when lower(a.metodo_pago)='efectivo' then a.monto else 0 end)
                from abonos a join ordenes_servicio o on o.id=a.orden_id
                where o.sede_id=se.id and a.venta_id is null and o.estado<>'cancelada'
                  and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
     - coalesce((select sum(case when lower(c.metodo_pago)='efectivo' then c.total else 0 end)
                from compras c where c.sede_destino_id=se.id and c.estado<>'cancelada'
                  and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
        as esperado
    from sedes se
    where se.activa=true and (p_sede is null or se.id=p_sede)
  ) x;

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
      'por_sede_metodo', v_por_sede_metodo,
      'por_cuenta',      v_por_cuenta,
      'egresos_detalle', v_egresos_detalle,
      'por_producto',    v_por_producto,
      'arqueo_esperado', v_arqueo_esp,
      'generado_en',     now(),
      'tz',              'America/Bogota'
    )
  );
end;
$function$;
