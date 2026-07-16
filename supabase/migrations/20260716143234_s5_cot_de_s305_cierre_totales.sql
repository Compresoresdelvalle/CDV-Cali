-- S3-05 (COT-D/E): los anticipos de cotización (abonos_cotizacion) se vuelven
-- VISIBLES para el motor de cierres. Se clasifican como PRODUCTOS (una cotización
-- convertida nace como venta de productos/servicios a 'Crédito'; su total nunca
-- entra el día de conversión, el dinero entra por abonos_cotizacion + pagos_cuenta,
-- una sola vez). Espeja el patrón de los abonos de OT (tabla abonos) pero
-- clasificándolos como productos en lugar de servicios.
--
-- NO-DOBLE-CONTEO: la venta convertida siempre nace 'Crédito' (ver
-- fn_convertir_cotizacion), por lo que su total queda excluido del bloque de
-- ventas por total. El anticipo se cuenta el día real del abono (ac.fecha) con su
-- método real; el saldo entra luego por pagos_cuenta. Cada peso se cuenta una vez.
--
-- ANULACIÓN: abonos_cotizacion no tiene columna de anulación y
-- fn_eliminar_abono_cotizacion hace DELETE físico (solo si la cotización no fue
-- convertida). Por lo tanto no hay filas anuladas que excluir: la presencia de la
-- fila = dinero recibido y aún retenido. No se filtra por estado de la cotización
-- (a diferencia de OT que filtra estado<>'cancelada') porque el abono es dinero
-- físico recibido; si se reembolsa, la fila se elimina.
--
-- REGRESIÓN: con abonos_cotizacion en 0 filas todos los términos añadidos suman 0,
-- por lo que los cierres históricos son byte-idénticos (probado antes de aplicar).
CREATE OR REPLACE FUNCTION public._fn_cierre_totales(p_desde date, p_hasta date, p_sede text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_productos numeric := 0; v_servicios numeric := 0; v_egresos numeric := 0;
  v_anticipos numeric := 0; v_cv int := 0; v_ca int := 0; v_cc int := 0;
  v_por_sede jsonb; v_por_metodo jsonb; v_por_sede_metodo jsonb; v_por_cuenta jsonb;
  v_egresos_detalle jsonb; v_por_producto jsonb; v_arqueo_esp jsonb;
begin
  select
    coalesce((select sum(total) from ventas
       where anulada=false and origen='directa' and metodo_pago <> 'Crédito'
         and (fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
         and (p_sede is null or sede_id=p_sede)),0)
  + coalesce((select sum(pc.monto) from pagos_cuenta pc join ventas v on v.id=pc.venta_id
       where pc.tipo='cobro' and coalesce(pc.anulado,false)=false
         and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
         and (p_sede is null or v.sede_id=p_sede)),0)
  + coalesce((select sum(ac.monto) from abonos_cotizacion ac join cotizaciones co on co.id=ac.cotizacion_id
       where (ac.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
         and (p_sede is null or co.sede_id=p_sede)),0)
  into v_productos;

  select count(*) into v_cv from ventas
   where anulada=false and origen='directa' and metodo_pago <> 'Crédito'
     and (fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
     and (p_sede is null or sede_id=p_sede);

  select coalesce(sum(a.monto),0), count(*) into v_servicios, v_ca
  from abonos a join ordenes_servicio o on o.id=a.orden_id
  where o.estado <> 'cancelada'
    and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or o.sede_id=p_sede);

  v_anticipos := v_servicios;

  select
    coalesce((select sum(total) from compras
       where estado <> 'cancelada' and metodo_pago <> 'Crédito'
         and (fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
         and (p_sede is null or sede_destino_id=p_sede)),0)
  + coalesce((select sum(pc.monto) from pagos_cuenta pc join compras c on c.id=pc.compra_id
       where pc.tipo='pago' and coalesce(pc.anulado,false)=false
         and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
         and (p_sede is null or c.sede_destino_id=p_sede)),0)
  into v_egresos;

  select count(*) into v_cc from compras
   where estado <> 'cancelada' and metodo_pago <> 'Crédito'
     and (fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
     and (p_sede is null or sede_destino_id=p_sede);

  select coalesce(jsonb_agg(jsonb_build_object('sede_id', d.id, 'sede_nombre', d.nombre,
           'productos', d.productos, 'servicios', d.servicios, 'egresos', d.egresos) order by d.nombre), '[]'::jsonb)
    into v_por_sede
  from (select se.id, se.nombre,
      coalesce((select sum(v.total) from ventas v where v.sede_id=se.id and v.anulada=false and v.origen='directa' and v.metodo_pago<>'Crédito'
                  and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
      + coalesce((select sum(pc.monto) from pagos_cuenta pc join ventas v on v.id=pc.venta_id where v.sede_id=se.id and pc.tipo='cobro' and coalesce(pc.anulado,false)=false
                  and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
      + coalesce((select sum(ac.monto) from abonos_cotizacion ac join cotizaciones co on co.id=ac.cotizacion_id where co.sede_id=se.id
                  and (ac.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0) as productos,
      coalesce((select sum(a.monto) from abonos a join ordenes_servicio o on o.id=a.orden_id where o.sede_id=se.id and o.estado<>'cancelada'
                  and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0) as servicios,
      coalesce((select sum(c.total) from compras c where c.sede_destino_id=se.id and c.estado<>'cancelada' and c.metodo_pago<>'Crédito'
                  and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
      + coalesce((select sum(pc.monto) from pagos_cuenta pc join compras c on c.id=pc.compra_id where c.sede_destino_id=se.id and pc.tipo='pago' and coalesce(pc.anulado,false)=false
                  and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0) as egresos
    from sedes se where se.activa=true and (p_sede is null or se.id=p_sede)) d;

  select coalesce(jsonb_agg(jsonb_build_object('metodo', m.metodo, 'productos', m.productos, 'servicios', m.servicios) order by m.metodo), '[]'::jsonb)
    into v_por_metodo
  from (select lower(t.metodo) as metodo, sum(t.productos) as productos, sum(t.servicios) as servicios
    from (
      select v.metodo_pago as metodo, v.total as productos, 0::numeric as servicios from ventas v
        where v.anulada=false and v.origen='directa' and v.metodo_pago not in ('Crédito','Mixto') and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or v.sede_id=p_sede)
      union all select pv.metodo_pago, pv.monto, 0::numeric from pagos_venta pv join ventas v on v.id=pv.venta_id
        where v.anulada=false and v.origen='directa' and v.metodo_pago='Mixto' and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or v.sede_id=p_sede)
      union all select pc.metodo_pago, pc.monto, 0::numeric from pagos_cuenta pc join ventas v on v.id=pc.venta_id
        where pc.tipo='cobro' and coalesce(pc.anulado,false)=false and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or v.sede_id=p_sede)
      union all select a.metodo_pago, 0::numeric, a.monto from abonos a join ordenes_servicio o on o.id=a.orden_id
        where o.estado<>'cancelada' and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or o.sede_id=p_sede)
      union all select ac.metodo_pago, ac.monto, 0::numeric from abonos_cotizacion ac join cotizaciones co on co.id=ac.cotizacion_id
        where (ac.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or co.sede_id=p_sede)
    ) t where t.metodo is not null group by lower(t.metodo)) m;

  select coalesce(jsonb_agg(jsonb_build_object('sede_id', x.sede_id, 'sede_nombre', x.sede_nombre,
           'metodo', x.metodo, 'ingresos', x.ingresos, 'egresos', x.egresos) order by x.sede_nombre, x.metodo), '[]'::jsonb)
    into v_por_sede_metodo
  from (select se.id as sede_id, se.nombre as sede_nombre, m.metodo,
           coalesce(sum(m.ingresos),0) as ingresos, coalesce(sum(m.egresos),0) as egresos
    from sedes se join (
        select v.sede_id as sede_id, lower(v.metodo_pago) as metodo, v.total as ingresos, 0::numeric as egresos from ventas v
         where v.anulada=false and v.origen='directa' and v.metodo_pago not in ('Crédito','Mixto') and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select v.sede_id, lower(pv.metodo_pago), pv.monto, 0::numeric from pagos_venta pv join ventas v on v.id=pv.venta_id
         where v.anulada=false and v.origen='directa' and v.metodo_pago='Mixto' and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select v.sede_id, lower(pc.metodo_pago), pc.monto, 0::numeric from pagos_cuenta pc join ventas v on v.id=pc.venta_id
         where pc.tipo='cobro' and coalesce(pc.anulado,false)=false and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select o.sede_id, lower(a.metodo_pago), a.monto, 0::numeric from abonos a join ordenes_servicio o on o.id=a.orden_id
         where o.estado<>'cancelada' and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select co.sede_id, lower(ac.metodo_pago), ac.monto, 0::numeric from abonos_cotizacion ac join cotizaciones co on co.id=ac.cotizacion_id
         where (ac.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select c.sede_destino_id, lower(c.metodo_pago), 0::numeric, c.total from compras c
         where c.estado<>'cancelada' and c.metodo_pago<>'Crédito' and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select c.sede_destino_id, lower(pc.metodo_pago), 0::numeric, pc.monto from pagos_cuenta pc join compras c on c.id=pc.compra_id
         where pc.tipo='pago' and coalesce(pc.anulado,false)=false and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    ) m on m.sede_id = se.id where se.activa=true and (p_sede is null or se.id=p_sede) and m.metodo is not null
    group by se.id, se.nombre, m.metodo) x;

  select coalesce(jsonb_agg(jsonb_build_object('sede_id', x.sede_id, 'sede_nombre', x.sede_nombre,
           'cuenta', x.cuenta, 'ingresos', x.ingresos, 'egresos', x.egresos) order by x.sede_nombre, x.cuenta nulls first), '[]'::jsonb)
    into v_por_cuenta
  from (select se.id as sede_id, se.nombre as sede_nombre, m.cuenta,
           coalesce(sum(m.ingresos),0) as ingresos, coalesce(sum(m.egresos),0) as egresos
    from sedes se join (
        select v.sede_id, nullif(trim(v.cuenta_bancaria),'') as cuenta, v.total as ingresos, 0::numeric as egresos from ventas v
         where v.anulada=false and v.origen='directa' and v.metodo_pago not in ('Crédito','Mixto') and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select v.sede_id, nullif(trim(pv.cuenta_bancaria),''), pv.monto, 0::numeric from pagos_venta pv join ventas v on v.id=pv.venta_id
         where v.anulada=false and v.origen='directa' and v.metodo_pago='Mixto' and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select v.sede_id, nullif(trim(pc.cuenta_bancaria),''), pc.monto, 0::numeric from pagos_cuenta pc join ventas v on v.id=pc.venta_id
         where pc.tipo='cobro' and coalesce(pc.anulado,false)=false and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select o.sede_id, null::text, a.monto, 0::numeric from abonos a join ordenes_servicio o on o.id=a.orden_id
         where o.estado<>'cancelada' and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select co.sede_id, null::text, ac.monto, 0::numeric from abonos_cotizacion ac join cotizaciones co on co.id=ac.cotizacion_id
         where (ac.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select c.sede_destino_id, nullif(trim(c.cuenta_bancaria),''), 0::numeric, c.total from compras c
         where c.estado<>'cancelada' and c.metodo_pago<>'Crédito' and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select c.sede_destino_id, nullif(trim(pc.cuenta_bancaria),''), 0::numeric, pc.monto from pagos_cuenta pc join compras c on c.id=pc.compra_id
         where pc.tipo='pago' and coalesce(pc.anulado,false)=false and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    ) m on m.sede_id = se.id where se.activa=true and (p_sede is null or se.id=p_sede)
    group by se.id, se.nombre, m.cuenta) x;

  select coalesce(jsonb_agg(e.obj order by e.sede_nombre, e.fecha), '[]'::jsonb) into v_egresos_detalle
  from (
    select se.nombre as sede_nombre, (c.fecha at time zone 'America/Bogota')::date as fecha,
      jsonb_build_object('sede_id', c.sede_destino_id, 'sede_nombre', se.nombre,
        'proveedor', c.proveedor, 'concepto', c.concepto, 'es_caja_menor', c.es_caja_menor, 'factura', c.factura_proveedor,
        'metodo', lower(c.metodo_pago), 'cuenta', nullif(trim(c.cuenta_bancaria),''),
        'total', c.total, 'fecha', (c.fecha at time zone 'America/Bogota')::date) as obj
    from compras c join sedes se on se.id=c.sede_destino_id
    where c.estado<>'cancelada' and c.metodo_pago<>'Crédito'
      and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or c.sede_destino_id=p_sede)
    union all
    select se.nombre, (pc.fecha at time zone 'America/Bogota')::date,
      jsonb_build_object('sede_id', c.sede_destino_id, 'sede_nombre', se.nombre,
        'proveedor', c.proveedor, 'concepto', 'Pago compra a crédito #'||c.numero, 'es_caja_menor', false, 'factura', c.factura_proveedor,
        'metodo', lower(pc.metodo_pago), 'cuenta', nullif(trim(pc.cuenta_bancaria),''),
        'total', pc.monto, 'fecha', (pc.fecha at time zone 'America/Bogota')::date)
    from pagos_cuenta pc join compras c on c.id=pc.compra_id join sedes se on se.id=c.sede_destino_id
    where pc.tipo='pago' and coalesce(pc.anulado,false)=false
      and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or c.sede_destino_id=p_sede)
  ) e;

  select coalesce(jsonb_agg(jsonb_build_object('sede_id', x.sede_id, 'sede_nombre', x.sede_nombre,
           'referencia', x.referencia, 'nombre', x.nombre, 'unidades', x.unidades, 'ingreso', x.ingreso) order by x.sede_nombre, x.ingreso desc), '[]'::jsonb)
    into v_por_producto
  from (select v.sede_id, se.nombre as sede_nombre, p.referencia, p.nombre, sum(dv.cantidad) as unidades,
          round(sum(dv.subtotal
            * case when coalesce(v.subtotal,0) > 0
                   then (v.subtotal - greatest(0, least(coalesce(v.descuento_valor, v.subtotal * coalesce(v.descuento_pct,0)/100.0), v.subtotal))) / v.subtotal
                   else 1 end)) as ingreso
    from detalle_venta dv join ventas v on v.id=dv.venta_id join sedes se on se.id=v.sede_id join productos p on p.id=dv.producto_id
    where dv.producto_id is not null and v.anulada=false and v.origen = 'directa' and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or v.sede_id=p_sede)
    group by v.sede_id, se.nombre, p.referencia, p.nombre) x;

  select coalesce(jsonb_agg(jsonb_build_object('sede_id', x.sede_id, 'sede_nombre', x.sede_nombre, 'efectivo_esperado', x.esperado) order by x.sede_nombre), '[]'::jsonb)
    into v_arqueo_esp
  from (select se.id as sede_id, se.nombre as sede_nombre,
      coalesce((select sum(v.total) from ventas v where v.sede_id=se.id and v.anulada=false and v.origen='directa' and lower(v.metodo_pago)='efectivo'
                  and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
     + coalesce((select sum(pv.monto) from pagos_venta pv join ventas v on v.id=pv.venta_id where v.sede_id=se.id and v.anulada=false and v.origen='directa' and v.metodo_pago='Mixto' and lower(pv.metodo_pago)='efectivo'
                  and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
     + coalesce((select sum(case when lower(a.metodo_pago)='efectivo' then a.monto else 0 end) from abonos a join ordenes_servicio o on o.id=a.orden_id
                where o.sede_id=se.id and o.estado<>'cancelada' and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
     + coalesce((select sum(case when lower(ac.metodo_pago)='efectivo' then ac.monto else 0 end) from abonos_cotizacion ac join cotizaciones co on co.id=ac.cotizacion_id
                where co.sede_id=se.id and (ac.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
     + coalesce((select sum(case when lower(pc.metodo_pago)='efectivo' then pc.monto else 0 end) from pagos_cuenta pc join ventas v on v.id=pc.venta_id
                where v.sede_id=se.id and pc.tipo='cobro' and coalesce(pc.anulado,false)=false and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
     - coalesce((select sum(case when lower(c.metodo_pago)='efectivo' then c.total else 0 end) from compras c where c.sede_destino_id=se.id and c.estado<>'cancelada'
                  and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
     - coalesce((select sum(case when lower(pc.metodo_pago)='efectivo' then pc.monto else 0 end) from pagos_cuenta pc join compras c on c.id=pc.compra_id
                where c.sede_destino_id=se.id and pc.tipo='pago' and coalesce(pc.anulado,false)=false and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0) as esperado
    from sedes se where se.activa=true and (p_sede is null or se.id=p_sede)) x;

  return jsonb_build_object('ingresos_productos', v_productos, 'ingresos_servicios', v_servicios,
    'ingresos_total', v_productos + v_servicios, 'egresos', v_egresos, 'margen', v_productos + v_servicios - v_egresos,
    'anticipos_recibidos', v_anticipos, 'count_ventas', v_cv, 'count_abonos', v_ca, 'count_compras', v_cc,
    'detalle', jsonb_build_object('por_sede', v_por_sede, 'por_metodo_pago', v_por_metodo, 'por_sede_metodo', v_por_sede_metodo,
      'por_cuenta', v_por_cuenta, 'egresos_detalle', v_egresos_detalle, 'por_producto', v_por_producto,
      'arqueo_esperado', v_arqueo_esp, 'generado_en', now(), 'tz', 'America/Bogota'));
end; $function$;
