-- Auditoría 2026-06-28 — Cuentas por cobrar/pagar + Cierre de caja.
--
-- C1+C2 (doble conteo OT, CONFIRMADO en prod): el cierre contaba el dinero de una
--   OT DOS VECES — como abono (`abonos`, venta_id null) al recibirse, y otra vez
--   como venta `origen='ot'` al entregarse. Cuando abono y entrega caían en cierres
--   distintos, el mismo dinero sumaba en ambos. Además el arqueo del MISMO día perdía
--   el efectivo de OT (al facturar, el abono deja de tener venta_id null y la venta es
--   'ot', no 'directa').
--   FIX: el dinero de OT se cuenta SIEMPRE vía `abonos` por su fecha (sin importar
--   venta_id). Las ventas `origen='ot'` ya NO se cuentan en el cierre (son solo el
--   documento fiscal; su caja entró por los abonos).
--
-- C3 (arqueo): las cobranzas/pagos de cartera (`pagos_cuenta`) no afectaban el efectivo
--   esperado, así que recaudos en efectivo de ventas a crédito (o pagos a proveedores)
--   no se reflejaban en el arqueo. FIX: sumar cobros efectivo y restar pagos efectivo.
--
-- Las ventas de productos siguen por causación (incl. crédito) en ingresos; el arqueo
-- (caja) es el que refleja el efectivo real movido en el periodo.
--
-- N2 (loophole tope abono): `trg_abono_validar_tope` solo validaba si total>0, así que
--   una OT sin valorar (total 0) aceptaba abonos arbitrarios que luego inflaban el cierre.
--   FIX: exigir OT valorada (>0) antes de abonar. El flujo guía: cotización (paso 2)
--   antes del abono (paso 3), así que es seguro.
--
-- M1: `fn_convertir_cotizacion` marcaba la venta 'efectivo' (minúscula) SIEMPRE. FIX:
--   método honesto — 'Efectivo' si la cotización quedó pagada, 'Crédito' si queda saldo
--   (entra correctamente a Cuentas por cobrar).

-- ───────────────────────────────────────────────────────────────────────────
-- 1) _fn_cierre_totales  (C1 + C2 + C3)
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public._fn_cierre_totales(p_desde date, p_hasta date, p_sede text default null)
 returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare
  v_productos numeric := 0; v_servicios numeric := 0; v_egresos numeric := 0;
  v_anticipos numeric := 0; v_cv int := 0; v_ca int := 0; v_cc int := 0;
  v_por_sede jsonb; v_por_metodo jsonb; v_por_sede_metodo jsonb; v_por_cuenta jsonb;
  v_egresos_detalle jsonb; v_por_producto jsonb; v_arqueo_esp jsonb;
begin
  -- Productos = ventas directas (causación, incl. crédito).
  select coalesce(sum(total),0), count(*) into v_productos, v_cv
  from ventas where anulada = false and origen = 'directa'
    and (fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or sede_id = p_sede);

  -- Servicios (OT) = abonos por su fecha, sin importar venta_id (fix C1+C2).
  -- Ya NO se suma la venta origen='ot' (evita el doble conteo).
  select coalesce(sum(a.monto),0), count(*) into v_servicios, v_ca
  from abonos a join ordenes_servicio o on o.id = a.orden_id
  where o.estado <> 'cancelada'
    and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or o.sede_id = p_sede);

  v_anticipos := v_servicios;  -- informativo

  -- Egresos = compras (causación, incl. crédito).
  select coalesce(sum(total),0), count(*) into v_egresos, v_cc
  from compras where (fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and estado <> 'cancelada' and (p_sede is null or sede_destino_id = p_sede);

  select coalesce(jsonb_agg(jsonb_build_object('sede_id', d.id, 'sede_nombre', d.nombre,
           'productos', d.productos, 'servicios', d.servicios, 'egresos', d.egresos) order by d.nombre), '[]'::jsonb)
    into v_por_sede
  from (select se.id, se.nombre,
      coalesce((select sum(v.total) from ventas v where v.sede_id = se.id and v.anulada = false and v.origen = 'directa'
                  and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta), 0) as productos,
      coalesce((select sum(a.monto) from abonos a join ordenes_servicio o on o.id = a.orden_id
                where o.sede_id = se.id and o.estado <> 'cancelada'
                  and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta), 0) as servicios,
      coalesce((select sum(c.total) from compras c where c.sede_destino_id = se.id and c.estado <> 'cancelada'
                  and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta), 0) as egresos
    from sedes se where se.activa = true and (p_sede is null or se.id = p_sede)) d;

  -- por_metodo: ventas directas (productos) + abonos OT (servicios). Sin origen='ot'.
  select coalesce(jsonb_agg(jsonb_build_object('metodo', m.metodo, 'productos', m.productos, 'servicios', m.servicios) order by m.metodo), '[]'::jsonb)
    into v_por_metodo
  from (select lower(t.metodo) as metodo, sum(t.productos) as productos, sum(t.servicios) as servicios
    from (select v.metodo_pago as metodo, v.total as productos, 0::numeric as servicios from ventas v
       where v.anulada = false and v.origen = 'directa' and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or v.sede_id = p_sede)
      union all select a.metodo_pago, 0::numeric, a.monto from abonos a join ordenes_servicio o on o.id = a.orden_id
       where o.estado <> 'cancelada' and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or o.sede_id = p_sede)) t
    where t.metodo is not null group by lower(t.metodo)) m;

  -- por_sede_metodo: ventas directas + abonos OT + compras.
  select coalesce(jsonb_agg(jsonb_build_object('sede_id', x.sede_id, 'sede_nombre', x.sede_nombre,
           'metodo', x.metodo, 'ingresos', x.ingresos, 'egresos', x.egresos) order by x.sede_nombre, x.metodo), '[]'::jsonb)
    into v_por_sede_metodo
  from (select se.id as sede_id, se.nombre as sede_nombre, m.metodo,
           coalesce(sum(m.ingresos),0) as ingresos, coalesce(sum(m.egresos),0) as egresos
    from sedes se join (
        select v.sede_id as sede_id, lower(v.metodo_pago) as metodo, v.total as ingresos, 0::numeric as egresos from ventas v
         where v.anulada=false and v.origen='directa' and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select o.sede_id, lower(a.metodo_pago), a.monto, 0::numeric from abonos a join ordenes_servicio o on o.id=a.orden_id
         where o.estado<>'cancelada' and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select c.sede_destino_id, lower(c.metodo_pago), 0::numeric, c.total from compras c
         where c.estado<>'cancelada' and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
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
         where v.anulada=false and v.origen='directa' and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select o.sede_id, null::text as cuenta, a.monto as ingresos, 0::numeric as egresos from abonos a join ordenes_servicio o on o.id=a.orden_id
         where o.estado<>'cancelada' and (a.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        union all select c.sede_destino_id, nullif(trim(c.cuenta_bancaria),''), 0::numeric, c.total from compras c
         where c.estado<>'cancelada' and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    ) m on m.sede_id = se.id where se.activa=true and (p_sede is null or se.id=p_sede)
    group by se.id, se.nombre, m.cuenta) x;

  -- egresos_detalle (compras).
  select coalesce(jsonb_agg(jsonb_build_object('sede_id', c.sede_destino_id, 'sede_nombre', se.nombre,
           'proveedor', c.proveedor, 'concepto', c.concepto, 'es_caja_menor', c.es_caja_menor, 'factura', c.factura_proveedor,
           'metodo', lower(c.metodo_pago), 'cuenta', nullif(trim(c.cuenta_bancaria),''),
           'total', c.total, 'fecha', (c.fecha at time zone 'America/Bogota')::date) order by se.nombre, c.fecha), '[]'::jsonb)
    into v_egresos_detalle
  from compras c join sedes se on se.id=c.sede_destino_id
  where c.estado<>'cancelada' and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or c.sede_destino_id=p_sede);

  -- por_producto (incluye repuestos de OT; informativo).
  select coalesce(jsonb_agg(jsonb_build_object('sede_id', x.sede_id, 'sede_nombre', x.sede_nombre,
           'referencia', x.referencia, 'nombre', x.nombre, 'unidades', x.unidades, 'ingreso', x.ingreso) order by x.sede_nombre, x.ingreso desc), '[]'::jsonb)
    into v_por_producto
  from (select v.sede_id, se.nombre as sede_nombre, p.referencia, p.nombre, sum(dv.cantidad) as unidades, sum(dv.subtotal) as ingreso
    from detalle_venta dv join ventas v on v.id=dv.venta_id join sedes se on se.id=v.sede_id join productos p on p.id=dv.producto_id
    where dv.producto_id is not null and v.anulada=false and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or v.sede_id=p_sede)
    group by v.sede_id, se.nombre, p.referencia, p.nombre) x;

  -- arqueo_esperado (efectivo en caja): ventas directas efectivo + abonos OT efectivo
  --   (por fecha, sin venta_id, fix C1) + cobros efectivo de cartera (fix C3)
  --   − compras efectivo − pagos efectivo de cartera (fix C3).
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

-- ───────────────────────────────────────────────────────────────────────────
-- 2) trg_abono_validar_tope  (N2: exigir OT valorada antes de abonar)
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.trg_abono_validar_tope()
 returns trigger language plpgsql set search_path to 'public','pg_temp'
as $function$
declare
  v_total     numeric;
  v_acumulado numeric;
begin
  if NEW.monto is null or NEW.monto <= 0 then
    raise exception 'El monto del abono debe ser mayor que 0';
  end if;

  if TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and NEW.monto > OLD.monto) then
    select coalesce(total, 0) into v_total from ordenes_servicio where id = NEW.orden_id;

    -- N2: la OT debe estar valorada antes de aceptar abonos. Evita anticipos sin tope
    -- que después inflan el cierre. El asistente cotiza (paso 2) antes del abono (paso 3).
    if v_total <= 0 then
      raise exception 'La OT aún no tiene valor. Cotiza los repuestos / mano de obra antes de registrar un abono.';
    end if;

    select coalesce(sum(monto), 0) into v_acumulado
      from abonos where orden_id = NEW.orden_id and id <> coalesce(NEW.id, -1);
    if v_acumulado + NEW.monto > v_total + 0.01 then
      raise exception 'El abono haría que el acumulado (%) supere el total cobrable de la OT (%). Registra a lo sumo el saldo pendiente (%).',
        v_acumulado + NEW.monto, v_total, greatest(v_total - v_acumulado, 0);
    end if;
  end if;

  return NEW;
end;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) fn_convertir_cotizacion  (M1: método honesto, casing correcto)
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.fn_convertir_cotizacion(p_cotizacion_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare
  v_cot cotizaciones%rowtype;
  v_det record;
  v_venta_id uuid;
  v_uid uuid := auth.uid();
  v_rol text; v_sede text;
  v_costo_prod numeric;
  v_abonado numeric;
  v_metodo text;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;

  select * into v_cot from cotizaciones where id = p_cotizacion_id for update;
  if not found then raise exception 'Cotizacion no encontrada'; end if;
  if v_rol <> 'Admin' and v_cot.sede_id <> v_sede then
    raise exception 'No tienes permiso para esta operacion';
  end if;
  if v_cot.venta_id is not null then
    raise exception 'Esta cotizacion ya fue convertida en venta';
  end if;
  if v_cot.ot_id is not null then
    raise exception 'Esta cotizacion esta vinculada a una orden de trabajo; se factura por la OT y no puede convertirse en venta por separado';
  end if;
  if v_cot.estado <> 'aprobada' then
    raise exception 'Solo se puede convertir una cotizacion APROBADA. Estado actual: %', v_cot.estado;
  end if;

  -- M1: método honesto. Si la cotización quedó pagada (abonos >= total) → 'Efectivo';
  -- si queda saldo → 'Crédito' (entra correctamente a Cuentas por cobrar).
  select coalesce(sum(monto),0) into v_abonado from abonos_cotizacion where cotizacion_id = p_cotizacion_id;
  v_metodo := case when v_abonado + 0.01 >= coalesce(v_cot.total,0) then 'Efectivo' else 'Crédito' end;

  insert into ventas (
    vendedor_id, sede_id, cliente_nombre, cliente_nit,
    subtotal, descuento_pct, descuento_valor, domicilio, iva_pct, total, metodo_pago
  )
  values (
    v_uid, v_cot.sede_id, v_cot.cliente_nombre, v_cot.cliente_nit,
    v_cot.subtotal, coalesce(v_cot.descuento_pct, 0), v_cot.descuento_valor,
    coalesce(v_cot.domicilio, 0), v_cot.iva_pct, v_cot.total, v_metodo
  )
  returning id into v_venta_id;

  for v_det in
    select producto_id, servicio_id, descripcion, cantidad, precio_unitario, subtotal
      from detalle_cotizacion where cotizacion_id = p_cotizacion_id
  loop
    if v_det.servicio_id is not null then
      insert into detalle_venta (
        venta_id, producto_id, servicio_id, descripcion,
        cantidad, precio_unitario, costo_unitario, subtotal
      ) values (
        v_venta_id, null, v_det.servicio_id, v_det.descripcion,
        v_det.cantidad, v_det.precio_unitario, 0, v_det.subtotal
      );
    else
      select coalesce(p.costo_promedio, v_det.precio_unitario)
        into v_costo_prod from productos p where p.id = v_det.producto_id;
      insert into detalle_venta (
        venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal
      ) values (
        v_venta_id, v_det.producto_id, v_det.cantidad,
        v_det.precio_unitario, coalesce(v_costo_prod, v_det.precio_unitario), v_det.subtotal
      );
    end if;
  end loop;

  update cotizaciones set venta_id = v_venta_id, updated_at = now()
   where id = p_cotizacion_id;

  return jsonb_build_object('ok', true, 'venta_id', v_venta_id);
end;
$function$;
