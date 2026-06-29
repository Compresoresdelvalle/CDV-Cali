-- ============================================================================
-- Afinado de los arreglos de la clienta (revisión post-implementación):
--
--  A) fn_registrar_cambio: el CRÉDITO por el producto devuelto ahora refleja lo
--     que el cliente REALMENTE pagó. Si la venta original tenía descuento global
--     (descuento_valor o descuento_pct), se acreditaba de más. Se aplica la misma
--     proporción de descuento que usa trg_recalcular_total_venta:
--        ratio = (subtotal - desc) / subtotal   (desc clampado a [0, subtotal])
--     El domicilio NO es valor de producto, no entra en el crédito.
--
--  B) _fn_cierre_totales -> por_producto: el "ingreso por producto" ahora es NETO
--     de descuento (subtotal de línea × ratio de la venta). Antes mostraba el
--     subtotal bruto, lo que inflaba cualquier venta con descuento (incluido el
--     producto nuevo de un cambio, cuyo trade-in es un descuento_valor). Es solo
--     analítica: los totales de caja (ingresos/egresos/arqueo) NO cambian.
-- ============================================================================

-- ─────────────────────────────── A ─────────────────────────────────────────
create or replace function public.fn_registrar_cambio(
  p_venta_original_id uuid,
  p_producto_devuelto_id uuid,
  p_cant_dev integer,
  p_producto_nuevo_id uuid,
  p_cant_nuevo integer,
  p_sede_id text,
  p_metodo text default 'Efectivo',
  p_cuenta_bancaria text default null,
  p_motivo text default null
) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text; v_sede text;
  v_venta record;
  v_sub_dev numeric;        -- subtotal BRUTO (pre-IVA, pre-descuento) del devuelto en la venta
  v_vendido integer;        -- unidades de ese producto en la venta original
  v_sub_total numeric;      -- subtotal bruto de la venta original (suma de líneas)
  v_desc_v numeric;         -- descuento global efectivo de la venta original
  v_ratio numeric;          -- (subtotal - desc) / subtotal  => proporción realmente pagada
  v_precio_nuevo numeric;   -- precio de catálogo (pre-IVA) del producto nuevo
  v_valor_dev numeric;      -- crédito por lo devuelto (pre-IVA, ya neto de descuento)
  v_valor_nuevo numeric;    -- valor del nuevo (pre-IVA)
  v_diferencia numeric;     -- (nuevo - devuelto) pre-IVA
  v_iva_factor numeric;     -- 1 + iva/100 de la venta original
  v_dev jsonb; v_venta_nueva jsonb; v_egreso jsonb := null;
  v_venta_nueva_id uuid;
  v_reembolso numeric;      -- monto a devolver al cliente (con IVA), si aplica
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;

  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;
  -- El cambio crea una venta: solo roles que pueden vender.
  if v_rol is null or v_rol not in ('Admin','Vendedor') then
    raise exception 'Solo Ventas (Vendedor) o Administración pueden registrar cambios';
  end if;
  if v_rol <> 'Admin' and v_sede is distinct from p_sede_id then
    raise exception 'Solo puedes registrar cambios en tu propia sede';
  end if;

  if p_cant_dev <= 0 or p_cant_nuevo <= 0 then
    raise exception 'Las cantidades deben ser mayores a 0';
  end if;
  if p_producto_devuelto_id = p_producto_nuevo_id then
    raise exception 'El producto nuevo debe ser distinto al devuelto';
  end if;
  if lower(coalesce(p_metodo,'')) not in ('efectivo','transferencia') then
    raise exception 'Método no soportado para cambios (usa Efectivo o Transferencia)';
  end if;

  -- Venta original
  select * into v_venta from ventas where id = p_venta_original_id;
  if not found then raise exception 'Venta original no encontrada'; end if;
  if v_venta.anulada then raise exception 'No se puede cambiar sobre una venta anulada'; end if;

  -- Valor BRUTO (pre-IVA) del producto devuelto: subtotal de sus líneas / unidades.
  select coalesce(sum(subtotal),0), coalesce(sum(cantidad),0)
    into v_sub_dev, v_vendido
  from detalle_venta
  where venta_id = p_venta_original_id and producto_id = p_producto_devuelto_id;
  if v_vendido = 0 then
    raise exception 'El producto a devolver no estaba en la venta original';
  end if;

  -- Proporción realmente pagada (espejo de trg_recalcular_total_venta): si la venta
  -- tenía descuento global, el crédito se reduce en esa misma proporción.
  v_sub_total := coalesce(v_venta.subtotal, 0);
  v_desc_v := coalesce(v_venta.descuento_valor, v_sub_total * coalesce(v_venta.descuento_pct, 0) / 100.0);
  v_desc_v := greatest(0, least(v_desc_v, v_sub_total));
  v_ratio := case when v_sub_total > 0 then (v_sub_total - v_desc_v) / v_sub_total else 1 end;

  v_valor_dev := round((v_sub_dev / v_vendido) * p_cant_dev * v_ratio);

  -- Valor (pre-IVA) del producto nuevo a precio de catálogo.
  select precio_venta into v_precio_nuevo from productos where id = p_producto_nuevo_id and activo = true;
  if v_precio_nuevo is null then raise exception 'Producto nuevo no encontrado o inactivo'; end if;
  v_valor_nuevo := round(v_precio_nuevo * p_cant_nuevo);

  v_diferencia := v_valor_nuevo - v_valor_dev;
  v_iva_factor := 1 + coalesce(v_venta.iva_pct, 0) / 100.0;

  -- 1) Reingresa el producto devuelto (valida pertenencia y tope de devolución).
  v_dev := fn_registrar_devolucion(
    'cliente', p_producto_devuelto_id, p_sede_id, p_cant_dev,
    coalesce(nullif(btrim(p_motivo), ''), 'Cambio de producto'),
    p_venta_original_id
  );

  -- 2) Vende el producto nuevo con el devuelto como trade-in (descuento_valor).
  --    Mismo IVA de la venta original => total = diferencia (×(1+iva)); si el nuevo
  --    es más barato, el descuento se clampa al subtotal y el total queda en 0.
  v_venta_nueva := fn_registrar_venta(
    p_sede_id,
    v_venta.cliente_nombre,
    v_venta.cliente_nit,
    p_metodo,
    0,                                  -- p_descuento_pct
    format('Cambio por venta #%s: entrega %s u. del nuevo, devuelve %s u. del original',
           v_venta.numero, p_cant_nuevo, p_cant_dev),
    jsonb_build_array(jsonb_build_object(
      'producto_id', p_producto_nuevo_id, 'cantidad', p_cant_nuevo)),
    coalesce(v_venta.iva_pct, 0),       -- p_iva_pct (mismo de la venta original)
    p_cuenta_bancaria,
    v_valor_dev,                        -- p_descuento_valor (trade-in)
    0                                   -- p_domicilio
  );
  v_venta_nueva_id := (v_venta_nueva->>'venta_id')::uuid;

  -- 3) Nuevo más barato: se devuelve la diferencia (con IVA) al cliente (egreso de caja).
  if v_diferencia < 0 then
    v_reembolso := round((v_valor_dev - v_valor_nuevo) * v_iva_factor);
    if v_reembolso > 0 then
      v_egreso := fn_registrar_caja_menor(
        p_sede_id,
        format('Devolución por cambio - venta #%s', v_venta.numero),
        v_reembolso,
        coalesce(nullif(v_venta.cliente_nombre, ''), 'Cliente'),
        format('Diferencia a favor del cliente en cambio de producto (venta #%s)', v_venta.numero)
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'venta_original_numero', v_venta.numero,
    'venta_nueva_id', v_venta_nueva_id,
    'venta_nueva_numero', (v_venta_nueva->>'numero'),
    'devolucion', v_dev,
    'valor_devuelto', v_valor_dev,
    'valor_nuevo', v_valor_nuevo,
    'diferencia_sin_iva', v_diferencia,
    'diferencia_con_iva', round(v_diferencia * v_iva_factor),
    'accion', case when v_diferencia > 0 then 'cobro'
                   when v_diferencia < 0 then 'devolucion'
                   else 'par' end,
    'reembolso', coalesce(v_reembolso, 0),
    'egreso', v_egreso
  );
end;
$function$;

revoke execute on function public.fn_registrar_cambio(uuid,uuid,integer,uuid,integer,text,text,text,text) from public, anon;
grant execute on function public.fn_registrar_cambio(uuid,uuid,integer,uuid,integer,text,text,text,text) to authenticated;

-- ─────────────────────────────── B ─────────────────────────────────────────
-- Solo se redefine el bloque por_producto dentro de _fn_cierre_totales; el resto
-- queda idéntico a 20260628000009 (pago mixto). Para no duplicar 180 líneas se
-- recrea la función completa con ese único cambio en el cálculo de 'ingreso'.
create or replace function public._fn_cierre_totales(p_desde date, p_hasta date, p_sede text default null)
 returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
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
                  and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0) as productos,
      coalesce((select sum(a.monto) from abonos a join ordenes_servicio o on o.id=a.orden_id where o.sede_id=se.id and o.estado<>'cancelada'
                  and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0) as servicios,
      coalesce((select sum(c.total) from compras c where c.sede_destino_id=se.id and c.estado<>'cancelada' and c.metodo_pago<>'Crédito'
                  and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
      + coalesce((select sum(pc.monto) from pagos_cuenta pc join compras c on c.id=pc.compra_id where c.sede_destino_id=se.id and pc.tipo='pago' and coalesce(pc.anulado,false)=false
                  and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0) as egresos
    from sedes se where se.activa=true and (p_sede is null or se.id=p_sede)) d;

  -- por_metodo: ventas de un solo método directo; las mixtas se reparten por pagos_venta.
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
    ) t where t.metodo is not null group by lower(t.metodo)) m;

  -- por_sede_metodo: igual, las ventas mixtas se reparten por pagos_venta.
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
        union all select c.sede_destino_id, lower(c.metodo_pago), 0::numeric, c.total from compras c
         where c.estado<>'cancelada' and c.metodo_pago<>'Crédito' and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select c.sede_destino_id, lower(pc.metodo_pago), 0::numeric, pc.monto from pagos_cuenta pc join compras c on c.id=pc.compra_id
         where pc.tipo='pago' and coalesce(pc.anulado,false)=false and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    ) m on m.sede_id = se.id where se.activa=true and (p_sede is null or se.id=p_sede) and m.metodo is not null
    group by se.id, se.nombre, m.metodo) x;

  -- por_cuenta: las ventas mixtas se reparten por la cuenta de cada pago.
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

  -- por_producto: ingreso NETO de descuento (subtotal de línea × ratio de la venta).
  -- ratio = (subtotal_venta - desc_efectivo) / subtotal_venta, espejo de
  -- trg_recalcular_total_venta. Así un cambio (cuyo trade-in es descuento_valor)
  -- muestra solo la diferencia real, y cualquier venta con descuento no se infla.
  select coalesce(jsonb_agg(jsonb_build_object('sede_id', x.sede_id, 'sede_nombre', x.sede_nombre,
           'referencia', x.referencia, 'nombre', x.nombre, 'unidades', x.unidades, 'ingreso', x.ingreso) order by x.sede_nombre, x.ingreso desc), '[]'::jsonb)
    into v_por_producto
  from (select v.sede_id, se.nombre as sede_nombre, p.referencia, p.nombre, sum(dv.cantidad) as unidades,
          round(sum(dv.subtotal
            * case when coalesce(v.subtotal,0) > 0
                   then (v.subtotal - greatest(0, least(coalesce(v.descuento_valor, v.subtotal * coalesce(v.descuento_pct,0)/100.0), v.subtotal))) / v.subtotal
                   else 1 end)) as ingreso
    from detalle_venta dv join ventas v on v.id=dv.venta_id join sedes se on se.id=v.sede_id join productos p on p.id=dv.producto_id
    where dv.producto_id is not null and v.anulada=false and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or v.sede_id=p_sede)
    group by v.sede_id, se.nombre, p.referencia, p.nombre) x;

  -- arqueo: el efectivo de ventas mixtas viene de su porción 'efectivo' en pagos_venta.
  select coalesce(jsonb_agg(jsonb_build_object('sede_id', x.sede_id, 'sede_nombre', x.sede_nombre, 'efectivo_esperado', x.esperado) order by x.sede_nombre), '[]'::jsonb)
    into v_arqueo_esp
  from (select se.id as sede_id, se.nombre as sede_nombre,
      coalesce((select sum(v.total) from ventas v where v.sede_id=se.id and v.anulada=false and v.origen='directa' and lower(v.metodo_pago)='efectivo'
                  and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta),0)
     + coalesce((select sum(pv.monto) from pagos_venta pv join ventas v on v.id=pv.venta_id where v.sede_id=se.id and v.anulada=false and v.origen='directa' and v.metodo_pago='Mixto' and lower(pv.metodo_pago)='efectivo'
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
