-- =====================================================================================
-- 20260715210000_s3_cierres_hardening.sql
-- Seccion 3 - Cierres y Cuentas: endurecimiento (PISTA DE BASE DE DATOS)
--   S3-01  Cierre complementario (delta = actual - ya registrado)   [APLICADO]
--   S3-02  Bloquear escritura directa a cierres                     [APLICADO]
--   S3-04  _fn_cierre_totales: por_producto excluye origen='ot'     [APLICADO]  (S2-07)
--   S3-08  Eliminar overload legacy fn_eliminar_pago_cuenta(bigint) [APLICADO]
--   S3-09  EXCLUDE per-sede (dos sedes pueden cerrar el mismo dia)  [APLICADO]
--   S3-10  Limpiar grants de escritura en pagos_cuenta              [APLICADO]
--   S3-15  Arqueo: efectivo contado no puede ser negativo           [APLICADO]
--   S3-05  Anticipos de cotizacion en el motor de totales           [DIFERIDO]  (ver nota al final)
--
-- Todos los cambios probados con BEGIN/ROLLBACK contra produccion antes de aplicar.
-- Reversibilidad: las definiciones VIVAS previas de las funciones reemplazadas y del
-- overload eliminado se conservan comentadas al final de este archivo.
-- =====================================================================================


-- =====================================================================================
-- S3-01 (infra) + S3-09  --  extension, columna, checks, EXCLUDE per-sede
-- =====================================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.cierres
  ADD COLUMN IF NOT EXISTS complementa_id uuid REFERENCES public.cierres(id);

-- tipo: agregar 'complementario'
ALTER TABLE public.cierres DROP CONSTRAINT IF EXISTS cierres_tipo_check;
ALTER TABLE public.cierres ADD CONSTRAINT cierres_tipo_check
  CHECK (tipo IN ('diario','periodo','complementario'));

-- EXCLUDE per-sede (S3-09). Exime los complementarios (comparten rango con su base).
ALTER TABLE public.cierres DROP CONSTRAINT IF EXISTS cierres_no_solapamiento;
ALTER TABLE public.cierres ADD CONSTRAINT cierres_no_solapamiento
  EXCLUDE USING gist (
    daterange(fecha_desde, fecha_hasta, '[]'::text) WITH &&,
    coalesce(sede_id, '__ALL__') WITH =
  ) WHERE (complementa_id IS NULL);

-- Relajar no-negatividad SOLO para complementarios (un complementario puede ser negativo
-- si hubo anulaciones tras el cierre). margen no tiene CHECK: no se toca.
ALTER TABLE public.cierres DROP CONSTRAINT IF EXISTS cierres_ingresos_productos_check;
ALTER TABLE public.cierres ADD CONSTRAINT cierres_ingresos_productos_check
  CHECK (ingresos_productos >= 0 OR tipo = 'complementario');
ALTER TABLE public.cierres DROP CONSTRAINT IF EXISTS cierres_ingresos_servicios_check;
ALTER TABLE public.cierres ADD CONSTRAINT cierres_ingresos_servicios_check
  CHECK (ingresos_servicios >= 0 OR tipo = 'complementario');
ALTER TABLE public.cierres DROP CONSTRAINT IF EXISTS cierres_ingresos_total_check;
ALTER TABLE public.cierres ADD CONSTRAINT cierres_ingresos_total_check
  CHECK (ingresos_total >= 0 OR tipo = 'complementario');
ALTER TABLE public.cierres DROP CONSTRAINT IF EXISTS cierres_egresos_check;
ALTER TABLE public.cierres ADD CONSTRAINT cierres_egresos_check
  CHECK (egresos >= 0 OR tipo = 'complementario');


-- =====================================================================================
-- S3-04 (S2-07)  --  _fn_cierre_totales: alinear por_producto con el agregado.
-- Cambio unico vs la definicion viva: el subquery de por_producto agrega
-- "and v.origen = 'directa'" (mismo criterio de origen que usa el agregado
-- ingresos_productos), para no contar productos de ventas-OT (que el agregado
-- reconoce como servicios por fecha de abono). Todos los demas bloques intactos.
-- =====================================================================================
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

  -- >>> S3-04: por_producto ahora filtra origen='directa' (alineado con el agregado) <<<
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


-- =====================================================================================
-- S3-15  --  fn_generar_cierre: guarda que el efectivo contado del arqueo no sea negativo.
-- Cambios vs la definicion viva: (1) guarda de arqueo negativo antes de armar v_arqueo;
-- (2) el chequeo de solapamiento ignora complementarios (complementa_id is null),
-- consistente con el nuevo EXCLUDE. Resto de la logica intacta.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.fn_generar_cierre(p_desde date, p_hasta date, p_tipo text, p_observaciones text DEFAULT NULL::text, p_sede text DEFAULT NULL::text, p_arqueo jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_rol     text;
  v_totales jsonb;
  v_arqueo  jsonb;
  v_detalle jsonb;
  v_row     cierres;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text into v_rol from usuarios where id = v_uid;
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo el Admin puede generar cierres';
  end if;
  if p_desde is null or p_hasta is null then
    raise exception 'Debe indicar fecha desde y hasta';
  end if;
  if p_hasta < p_desde then
    raise exception 'La fecha hasta no puede ser anterior a la fecha desde';
  end if;
  if p_tipo not in ('diario', 'periodo') then
    raise exception 'Tipo de cierre inválido: %', p_tipo;
  end if;
  if p_tipo = 'diario' and p_desde <> p_hasta then
    raise exception 'Un cierre diario debe cubrir un solo día';
  end if;
  if p_sede is not null and not exists (select 1 from sedes where id = p_sede and activa = true) then
    raise exception 'Sede inválida: %', p_sede;
  end if;

  perform pg_advisory_xact_lock(hashtext('cierres'));

  if exists (select 1 from cierres
             where fecha_desde <= p_hasta and fecha_hasta >= p_desde
               and complementa_id is null
               and (p_sede is null or sede_id is null or sede_id = p_sede)) then
    raise exception 'El rango % a % solapa un cierre ya existente para esta cobertura', p_desde, p_hasta;
  end if;

  v_totales := _fn_cierre_totales(p_desde, p_hasta, p_sede);

  if p_arqueo is not null then
    if exists (select 1 from jsonb_array_elements(p_arqueo) a
               where coalesce((a->>'efectivo_contado')::numeric, 0) < 0) then
      raise exception 'El efectivo contado no puede ser negativo.';
    end if;
    v_arqueo := (
      select coalesce(jsonb_agg(jsonb_build_object(
         'sede_id', e->>'sede_id', 'sede_nombre', e->>'sede_nombre',
         'efectivo_esperado', (e->>'efectivo_esperado')::numeric,
         'efectivo_contado', coalesce((
            select (a->>'efectivo_contado')::numeric from jsonb_array_elements(p_arqueo) a
            where a->>'sede_id' = e->>'sede_id'), 0),
         'diferencia', coalesce((
            select (a->>'efectivo_contado')::numeric from jsonb_array_elements(p_arqueo) a
            where a->>'sede_id' = e->>'sede_id'), 0) - (e->>'efectivo_esperado')::numeric
      ) order by e->>'sede_nombre'), '[]'::jsonb)
      from jsonb_array_elements(v_totales->'detalle'->'arqueo_esperado') e
    );
    v_detalle := (v_totales->'detalle') || jsonb_build_object('arqueo', v_arqueo);
  else
    v_detalle := v_totales->'detalle';
  end if;

  insert into cierres (
    tipo, fecha_desde, fecha_hasta, sede_id,
    ingresos_productos, ingresos_servicios, ingresos_total, egresos, margen,
    count_ventas, count_abonos, count_compras,
    detalle, observaciones, cerrado_por
  ) values (
    p_tipo, p_desde, p_hasta, p_sede,
    (v_totales->>'ingresos_productos')::numeric,
    (v_totales->>'ingresos_servicios')::numeric,
    (v_totales->>'ingresos_total')::numeric,
    (v_totales->>'egresos')::numeric,
    (v_totales->>'margen')::numeric,
    (v_totales->>'count_ventas')::integer,
    (v_totales->>'count_abonos')::integer,
    (v_totales->>'count_compras')::integer,
    v_detalle,
    nullif(trim(coalesce(p_observaciones, '')), ''),
    v_uid
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;


-- =====================================================================================
-- S3-01  --  fn_generar_cierre_complementario: captura el delta (actual - ya registrado)
-- de un rango+sede que ya tiene un cierre base. Puede ser negativo (anulaciones tardias).
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.fn_generar_cierre_complementario(p_desde date, p_hasta date, p_sede text, p_observaciones text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_base cierres;
  v_full jsonb;
  v_d_prod numeric; v_d_serv numeric; v_d_tot numeric; v_d_egr numeric; v_d_marg numeric;
  v_d_cv int; v_d_ca int; v_d_cc int;
  v_ya_prod numeric; v_ya_serv numeric; v_ya_tot numeric; v_ya_egr numeric; v_ya_marg numeric;
  v_ya_cv int; v_ya_ca int; v_ya_cc int;
  v_row cierres;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text into v_rol from usuarios where id = v_uid;
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo el Admin puede generar cierres';
  end if;
  if p_desde is null or p_hasta is null then raise exception 'Debe indicar fecha desde y hasta'; end if;
  if p_hasta < p_desde then raise exception 'La fecha hasta no puede ser anterior a la fecha desde'; end if;
  if p_sede is not null and not exists (select 1 from sedes where id = p_sede and activa = true) then
    raise exception 'Sede inválida: %', p_sede;
  end if;

  perform pg_advisory_xact_lock(hashtext('cierres'));

  -- Debe existir un cierre NO complementario que cubra EXACTAMENTE este rango+sede
  -- (sede NULL = todas coincide con sede NULL).
  select * into v_base from cierres
   where tipo <> 'complementario'
     and fecha_desde = p_desde and fecha_hasta = p_hasta
     and sede_id is not distinct from p_sede
   order by created_at desc
   limit 1;
  if not found then
    raise exception 'No hay un cierre previo de este periodo/sede para complementar. Usa Generar cierre.';
  end if;

  v_full := _fn_cierre_totales(p_desde, p_hasta, p_sede);

  -- Suma de TODO lo ya registrado (diario/periodo/complementario) para este rango+sede.
  select coalesce(sum(ingresos_productos),0), coalesce(sum(ingresos_servicios),0),
         coalesce(sum(ingresos_total),0), coalesce(sum(egresos),0), coalesce(sum(margen),0),
         coalesce(sum(count_ventas),0), coalesce(sum(count_abonos),0), coalesce(sum(count_compras),0)
    into v_ya_prod, v_ya_serv, v_ya_tot, v_ya_egr, v_ya_marg, v_ya_cv, v_ya_ca, v_ya_cc
    from cierres
   where fecha_desde = p_desde and fecha_hasta = p_hasta
     and sede_id is not distinct from p_sede;

  v_d_prod := (v_full->>'ingresos_productos')::numeric - v_ya_prod;
  v_d_serv := (v_full->>'ingresos_servicios')::numeric - v_ya_serv;
  v_d_tot  := (v_full->>'ingresos_total')::numeric   - v_ya_tot;
  v_d_egr  := (v_full->>'egresos')::numeric          - v_ya_egr;
  v_d_marg := (v_full->>'margen')::numeric           - v_ya_marg;
  v_d_cv   := (v_full->>'count_ventas')::int         - v_ya_cv;
  v_d_ca   := (v_full->>'count_abonos')::int         - v_ya_ca;
  v_d_cc   := (v_full->>'count_compras')::int        - v_ya_cc;

  -- Sin cambios materiales (tolerancia +/- 1 por redondeo) -> no crear complementario.
  if abs(v_d_prod) <= 1 and abs(v_d_serv) <= 1 and abs(v_d_egr) <= 1 then
    raise exception 'No hay movimientos nuevos ni cambios para un cierre complementario en este periodo.';
  end if;

  insert into cierres (
    tipo, fecha_desde, fecha_hasta, sede_id, complementa_id,
    ingresos_productos, ingresos_servicios, ingresos_total, egresos, margen,
    count_ventas, count_abonos, count_compras, detalle, observaciones, cerrado_por
  ) values (
    'complementario', p_desde, p_hasta, p_sede, v_base.id,
    v_d_prod, v_d_serv, v_d_tot, v_d_egr, v_d_marg,
    v_d_cv, v_d_ca, v_d_cc,
    jsonb_build_object(
      'complementa_numero', v_base.numero,
      'complementa_id', v_base.id,
      'generado', 'complementario',
      'full', v_full,
      'ya_registrado', jsonb_build_object('ingresos_productos', v_ya_prod, 'ingresos_servicios', v_ya_serv,
        'ingresos_total', v_ya_tot, 'egresos', v_ya_egr, 'margen', v_ya_marg),
      'delta', jsonb_build_object('ingresos_productos', v_d_prod, 'ingresos_servicios', v_d_serv,
        'ingresos_total', v_d_tot, 'egresos', v_d_egr, 'margen', v_d_marg,
        'count_ventas', v_d_cv, 'count_abonos', v_d_ca, 'count_compras', v_d_cc),
      'tz', 'America/Bogota', 'generado_en', now()),
    nullif(trim(coalesce(p_observaciones, '')), ''),
    v_uid
  ) returning * into v_row;

  return jsonb_build_object('cierre', to_jsonb(v_row),
    'delta', jsonb_build_object('ingresos_productos', v_d_prod, 'ingresos_servicios', v_d_serv,
      'ingresos_total', v_d_tot, 'egresos', v_d_egr, 'margen', v_d_marg,
      'count_ventas', v_d_cv, 'count_abonos', v_d_ca, 'count_compras', v_d_cc));
end; $function$;

GRANT EXECUTE ON FUNCTION public.fn_generar_cierre_complementario(date,date,text,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_generar_cierre_complementario(date,date,text,text) FROM anon, public;


-- =====================================================================================
-- S3-02 + S3-10  --  bloquear escritura directa (toda escritura pasa por RPCs DEFINER).
-- =====================================================================================
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.cierres      FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.pagos_cuenta FROM authenticated, anon;


-- =====================================================================================
-- S3-08  --  eliminar el overload legacy peligroso (DELETE fisico sin auditoria).
-- Solo el de 1 argumento; el frontend usa el de 2 args (p_id, p_motivo) = soft-delete.
-- =====================================================================================
DROP FUNCTION IF EXISTS public.fn_eliminar_pago_cuenta(bigint);


-- =====================================================================================
-- NOTA S3-05 (DIFERIDO) -- Anticipos de cotizacion (abonos_cotizacion) en el motor.
-- Se difiere de forma deliberada. Motivo: al convertir una cotizacion en venta, el
-- venta.total YA incluye el anticipo cobrado antes en abonos_cotizacion. Reconocer el
-- anticipo como ingreso en su fecha/metodo reales SIN doble contar exige restar ese
-- monto del ingreso de producto en la fecha de la venta y sumarlo en la fecha del
-- anticipo, reescribiendo v_productos y los bloques por_sede/por_metodo/por_cuenta/arqueo.
-- Es un cambio de alto riesgo sobre el motor sensible y hoy no hay datos (0 filas en
-- abonos_cotizacion), por lo que no puede probarse contra datos reales. Se documenta y
-- se deja para una intervencion dedicada. Ningun cierre existente se ve afectado.
-- =====================================================================================


-- =====================================================================================
-- ORIGINALES (reversibilidad) -- definiciones VIVAS previas capturadas con
-- pg_get_functiondef antes del reemplazo (2026-07-15).
-- -------------------------------------------------------------------------------------
-- _fn_cierre_totales: identica a la nueva EXCEPTO el subquery por_producto, cuyo WHERE
--   original era (sin el filtro de origen):
--     where dv.producto_id is not null and v.anulada=false
--       and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
--       and (p_sede is null or v.sede_id=p_sede)
--
-- fn_generar_cierre: identica a la nueva EXCEPTO:
--   (1) el chequeo de solapamiento NO tenia "and complementa_id is null";
--   (2) NO tenia la guarda de arqueo negativo.
--
-- Constraints originales:
--   cierres_tipo_check         CHECK (tipo IN ('diario','periodo'))
--   cierres_no_solapamiento    EXCLUDE USING gist (daterange(fecha_desde,fecha_hasta,'[]') WITH &&)
--   cierres_ingresos_productos_check  CHECK (ingresos_productos >= 0)
--   cierres_ingresos_servicios_check  CHECK (ingresos_servicios >= 0)
--   cierres_ingresos_total_check      CHECK (ingresos_total >= 0)
--   cierres_egresos_check             CHECK (egresos >= 0)
--
-- fn_eliminar_pago_cuenta(bigint) [ELIMINADA]:
--   CREATE OR REPLACE FUNCTION public.fn_eliminar_pago_cuenta(p_id bigint)
--    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
--   AS $$
--   begin
--     if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
--     if (select get_my_rol()) <> 'Admin' then
--       raise exception 'Solo el administrador puede eliminar pagos';
--     end if;
--     delete from pagos_cuenta where id = p_id;
--   end $$;
-- =====================================================================================
