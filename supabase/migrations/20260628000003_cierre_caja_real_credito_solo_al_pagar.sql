-- Auditoría 2026-06-28 (3) — Cierre a CAJA REAL (reporte de la clienta, validado).
--
-- Problema: "Ingresos", "Egresos" y "Margen" del cierre usaban CAUSACIÓN — una compra
-- (o venta) a crédito contaba el día del documento aunque no se hubiera pagado/cobrado.
-- El arqueo (efectivo) ya estaba bien, pero los totales del cierre no.
--
-- Fix (caja real): el crédito SOLO toca el cierre cuando el dinero se mueve.
--   INGRESOS = ventas pagadas (NO crédito, por fecha) + cobros de cartera (pagos_cuenta
--              'cobro', por fecha) + abonos de OT (por fecha).
--   EGRESOS  = compras pagadas (NO crédito, por fecha) + pagos de cartera (pagos_cuenta
--              'pago', por fecha).
-- Una compra/venta a crédito NO afecta el cierre el día de ingreso; entra el día del
-- pago/cobro real. Caja menor sigue siendo egreso (es compra Efectivo). El arqueo no
-- cambia (ya era la porción efectivo de este mismo modelo).
-- Nota: abonos_cotizacion (anticipos de cotización) hoy = 0 filas; si se empiezan a usar,
-- habría que sumarlos como ingreso por fecha y excluir la venta convertida.

create or replace function public._fn_cierre_totales(p_desde date, p_hasta date, p_sede text default null)
 returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare
  v_productos numeric := 0; v_servicios numeric := 0; v_egresos numeric := 0;
  v_anticipos numeric := 0; v_cv int := 0; v_ca int := 0; v_cc int := 0;
  v_por_sede jsonb; v_por_metodo jsonb; v_por_sede_metodo jsonb; v_por_cuenta jsonb;
  v_egresos_detalle jsonb; v_por_producto jsonb; v_arqueo_esp jsonb;
begin
  -- INGRESOS PRODUCTOS (caja) = ventas pagadas (NO crédito) + cobros de cartera.
  select
    coalesce((select sum(total) from ventas
       where anulada=false and origen='directa' and metodo_pago <> 'Crédito'
         and (fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
         and (p_sede is null or sede_id=p_sede)),0)
  + coalesce((select sum(pc.monto) from pagos_cuenta pc join ventas v on v.id=pc.venta_id
       where pc.tipo='cobro' and coalesce(pc.anulado,false)=false
         and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
         and (p_sede is null or v.sede_id=p_sede)),0)
  into v_productos;

  select count(*) into v_cv from ventas
   where anulada=false and origen='directa' and metodo_pago <> 'Crédito'
     and (fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
     and (p_sede is null or sede_id=p_sede);

  -- INGRESOS SERVICIOS (OT) = abonos por fecha.
  select coalesce(sum(a.monto),0), count(*) into v_servicios, v_ca
  from abonos a join ordenes_servicio o on o.id=a.orden_id
  where o.estado <> 'cancelada'
    and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or o.sede_id=p_sede);

  v_anticipos := v_servicios;

  -- EGRESOS (caja) = compras pagadas (NO crédito) + pagos de cartera.
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

  -- por_sede
  select coalesce(jsonb_agg(jsonb_build_object('sede_id', d.id, 'sede_nombre', d.nombre,
           'productos', d.productos, 'servicios', d.servicios, 'egresos', d.egresos) order by d.nombre), '[]'::jsonb)
    into v_por_sede
  from (select se.id, se.nombre,
      coalesce((select sum(v.total) from ventas v where v.sede_id=se.id and v.anulada=false and v.origen='directa' and v.metodo_pago<>'Crédito'
                  and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
      + coalesce((select sum(pc.monto) from pagos_cuenta pc join ventas v on v.id=pc.venta_id where v.sede_id=se.id and pc.tipo='cobro' and coalesce(pc.anulado,false)=false
                  and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0) as productos,
      coalesce((select sum(a.monto) from abonos a join ordenes_servicio o on o.id=a.orden_id where o.sede_id=se.id and o.estado<>'cancelada'
                  and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0) as servicios,
      coalesce((select sum(c.total) from compras c where c.sede_destino_id=se.id and c.estado<>'cancelada' and c.metodo_pago<>'Crédito'
                  and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
      + coalesce((select sum(pc.monto) from pagos_cuenta pc join compras c on c.id=pc.compra_id where c.sede_destino_id=se.id and pc.tipo='pago' and coalesce(pc.anulado,false)=false
                  and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0) as egresos
    from sedes se where se.activa=true and (p_sede is null or se.id=p_sede)) d;

  -- por_metodo (ingresos por método: ventas pagadas + cobros = productos; abonos OT = servicios)
  select coalesce(jsonb_agg(jsonb_build_object('metodo', m.metodo, 'productos', m.productos, 'servicios', m.servicios) order by m.metodo), '[]'::jsonb)
    into v_por_metodo
  from (select lower(t.metodo) as metodo, sum(t.productos) as productos, sum(t.servicios) as servicios
    from (
      select v.metodo_pago as metodo, v.total as productos, 0::numeric as servicios from ventas v
        where v.anulada=false and v.origen='directa' and v.metodo_pago<>'Crédito' and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or v.sede_id=p_sede)
      union all select pc.metodo_pago, pc.monto, 0::numeric from pagos_cuenta pc join ventas v on v.id=pc.venta_id
        where pc.tipo='cobro' and coalesce(pc.anulado,false)=false and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or v.sede_id=p_sede)
      union all select a.metodo_pago, 0::numeric, a.monto from abonos a join ordenes_servicio o on o.id=a.orden_id
        where o.estado<>'cancelada' and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or o.sede_id=p_sede)
    ) t where t.metodo is not null group by lower(t.metodo)) m;

  -- por_sede_metodo (ingresos: ventas pagadas + cobros + abonos OT; egresos: compras pagadas + pagos)
  select coalesce(jsonb_agg(jsonb_build_object('sede_id', x.sede_id, 'sede_nombre', x.sede_nombre,
           'metodo', x.metodo, 'ingresos', x.ingresos, 'egresos', x.egresos) order by x.sede_nombre, x.metodo), '[]'::jsonb)
    into v_por_sede_metodo
  from (select se.id as sede_id, se.nombre as sede_nombre, m.metodo,
           coalesce(sum(m.ingresos),0) as ingresos, coalesce(sum(m.egresos),0) as egresos
    from sedes se join (
        select v.sede_id as sede_id, lower(v.metodo_pago) as metodo, v.total as ingresos, 0::numeric as egresos from ventas v
         where v.anulada=false and v.origen='directa' and v.metodo_pago<>'Crédito' and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select v.sede_id, lower(pc.metodo_pago), pc.monto, 0::numeric from pagos_cuenta pc join ventas v on v.id=pc.venta_id
         where pc.tipo='cobro' and coalesce(pc.anulado,false)=false and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select o.sede_id, lower(a.metodo_pago), a.monto, 0::numeric from abonos a join ordenes_servicio o on o.id=a.orden_id
         where o.estado<>'cancelada' and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select c.sede_destino_id, lower(c.metodo_pago), 0::numeric, c.total from compras c
         where c.estado<>'cancelada' and c.metodo_pago<>'Crédito' and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select c.sede_destino_id, lower(pc.metodo_pago), 0::numeric, pc.monto from pagos_cuenta pc join compras c on c.id=pc.compra_id
         where pc.tipo='pago' and coalesce(pc.anulado,false)=false and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    ) m on m.sede_id = se.id where se.activa=true and (p_sede is null or se.id=p_sede) and m.metodo is not null
    group by se.id, se.nombre, m.metodo) x;

  -- por_cuenta
  select coalesce(jsonb_agg(jsonb_build_object('sede_id', x.sede_id, 'sede_nombre', x.sede_nombre,
           'cuenta', x.cuenta, 'ingresos', x.ingresos, 'egresos', x.egresos) order by x.sede_nombre, x.cuenta nulls first), '[]'::jsonb)
    into v_por_cuenta
  from (select se.id as sede_id, se.nombre as sede_nombre, m.cuenta,
           coalesce(sum(m.ingresos),0) as ingresos, coalesce(sum(m.egresos),0) as egresos
    from sedes se join (
        select v.sede_id, nullif(trim(v.cuenta_bancaria),'') as cuenta, v.total as ingresos, 0::numeric as egresos from ventas v
         where v.anulada=false and v.origen='directa' and v.metodo_pago<>'Crédito' and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select v.sede_id, nullif(trim(pc.cuenta_bancaria),''), pc.monto, 0::numeric from pagos_cuenta pc join ventas v on v.id=pc.venta_id
         where pc.tipo='cobro' and coalesce(pc.anulado,false)=false and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select o.sede_id, null::text, a.monto, 0::numeric from abonos a join ordenes_servicio o on o.id=a.orden_id
         where o.estado<>'cancelada' and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select c.sede_destino_id, nullif(trim(c.cuenta_bancaria),''), 0::numeric, c.total from compras c
         where c.estado<>'cancelada' and c.metodo_pago<>'Crédito' and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select c.sede_destino_id, nullif(trim(pc.cuenta_bancaria),''), 0::numeric, pc.monto from pagos_cuenta pc join compras c on c.id=pc.compra_id
         where pc.tipo='pago' and coalesce(pc.anulado,false)=false and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    ) m on m.sede_id = se.id where se.activa=true and (p_sede is null or se.id=p_sede)
    group by se.id, se.nombre, m.cuenta) x;

  -- egresos_detalle = compras pagadas (NO crédito) + pagos de cartera (de compras a crédito).
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

  -- por_producto (qué productos se vendieron — movimiento de producto, todas las ventas no anuladas)
  select coalesce(jsonb_agg(jsonb_build_object('sede_id', x.sede_id, 'sede_nombre', x.sede_nombre,
           'referencia', x.referencia, 'nombre', x.nombre, 'unidades', x.unidades, 'ingreso', x.ingreso) order by x.sede_nombre, x.ingreso desc), '[]'::jsonb)
    into v_por_producto
  from (select v.sede_id, se.nombre as sede_nombre, p.referencia, p.nombre, sum(dv.cantidad) as unidades, sum(dv.subtotal) as ingreso
    from detalle_venta dv join ventas v on v.id=dv.venta_id join sedes se on se.id=v.sede_id join productos p on p.id=dv.producto_id
    where dv.producto_id is not null and v.anulada=false and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or v.sede_id=p_sede)
    group by v.sede_id, se.nombre, p.referencia, p.nombre) x;

  -- arqueo_esperado (efectivo en caja) = ventas efectivo + abonos OT efectivo + cobros efectivo
  --   − compras efectivo − pagos efectivo (porción efectivo del mismo modelo de caja).
  select coalesce(jsonb_agg(jsonb_build_object('sede_id', x.sede_id, 'sede_nombre', x.sede_nombre, 'efectivo_esperado', x.esperado) order by x.sede_nombre), '[]'::jsonb)
    into v_arqueo_esp
  from (select se.id as sede_id, se.nombre as sede_nombre,
      coalesce((select sum(case when lower(v.metodo_pago)='efectivo' then v.total else 0 end) from ventas v where v.sede_id=se.id and v.anulada=false and v.origen='directa'
                  and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
     + coalesce((select sum(case when lower(a.metodo_pago)='efectivo' then a.monto else 0 end) from abonos a join ordenes_servicio o on o.id=a.orden_id
                where o.sede_id=se.id and o.estado<>'cancelada' and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
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
