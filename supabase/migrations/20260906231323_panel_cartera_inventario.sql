-- Cartera por antiguedad e inventario como capital.
--
-- Estas dos NO reciben rango: son fotos de HOY. Quien debe ahora y cuanta plata
-- hay dormida ahora. Aplicarles el rango del panel seria confuso: "la cartera
-- de agosto" no significa nada — o se debe hoy, o no se debe.
--
-- Verificado en produccion: cartera 1.243.290 en 3 facturas, nada vencido a mas
-- de 60 dias; inventario 479.853.554 al costo, de los cuales 300.852.775 en
-- 1.536 SKUs no se han movido en 90 dias, y 150 productos clase A estan en cero
-- teniendo minimo puesto. Las dos responden juntas en 416 ms.
CREATE OR REPLACE FUNCTION public.fn_panel_cartera(p_sede text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_total numeric; v_tramos jsonb; v_detalle jsonb;
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  if (select get_my_rol()) <> 'Admin' then
    raise exception 'El margen y los costos son información de administración';
  end if;

  -- El saldo de la vista ya viene neto de retenciones: la plata retenida no se
  -- le puede cobrar al cliente, se la queda la DIAN.
  with c as (
    select v.venta_id, v.numero, v.cliente_nombre, v.saldo,
           (v.fecha at time zone 'America/Bogota')::date as f,
           v_hoy - (v.fecha at time zone 'America/Bogota')::date as dias
    from v_cuentas_por_cobrar v
    where v.saldo > 0
      and (p_sede is null or v.sede_id = p_sede)
  ), t as (
    select case
             when dias <= 30 then '0-30'
             when dias <= 60 then '31-60'
             when dias <= 90 then '61-90'
             else '+90'
           end as rango,
           sum(saldo) as monto, count(*) as n
    from c group by 1
  )
  select
    (select round(coalesce(sum(saldo),0)) from c),
    -- Los cuatro tramos SIEMPRE salen, aunque esten en cero: un tramo ausente
    -- no se distingue de uno vacio, y "no hay nada vencido a mas de 90 dias"
    -- es justo la respuesta que se busca.
    (select jsonb_agg(jsonb_build_object(
              'rango', r.rango,
              'monto', round(coalesce(t.monto,0)),
              'n', coalesce(t.n,0))
            order by r.orden)
       from (values ('0-30',1),('31-60',2),('61-90',3),('+90',4)) r(rango,orden)
       left join t on t.rango = r.rango),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'doc_tipo','venta','doc_id', x.venta_id,
              'referencia','Venta #'||x.numero::text,
              'descripcion', coalesce(nullif(btrim(x.cliente_nombre),''),'Consumidor final'),
              'fecha', x.f, 'monto', round(x.saldo), 'dias', x.dias)
            order by x.saldo desc), '[]'::jsonb)
       from (select * from c order by saldo desc limit 200) x)
  into v_total, v_tramos, v_detalle;

  return jsonb_build_object(
    'total', coalesce(v_total,0),
    'tramos', coalesce(v_tramos,'[]'::jsonb),
    'detalle', coalesce(v_detalle,'[]'::jsonb));
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_panel_cartera(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_panel_cartera(text) TO authenticated, service_role;


-- El inventario visto como plata, no como unidades.
--
-- 'dormido' es lo que no ha salido en 90 dias. Salida incluye el traspaso:
-- BODEGA casi no vende, despacha a las otras sedes, asi que contar solo ventas
-- la dejaria entera marcada como dormida y el numero no serviria para nada.
CREATE OR REPLACE FUNCTION public.fn_panel_inventario(p_sede text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_valor numeric; v_dormido numeric; v_n_dormido int; v_agotados int;
  v_desde timestamptz := now() - interval '90 days';
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  if (select get_my_rol()) <> 'Admin' then
    raise exception 'El margen y los costos son información de administración';
  end if;

  with inv as (
    select i.producto_id, i.sede_id, i.cantidad,
           i.cantidad * coalesce(p.costo_promedio,0) as valor
    from inventario i
    join productos p on p.id = i.producto_id
    where i.cantidad > 0 and p.activo = true
      and (p_sede is null or i.sede_id = p_sede)
  ), movido as (
    select distinct m.producto_id, m.sede_id
    from movimientos m
    where m.fecha >= v_desde
      and m.tipo in ('venta','orden_consumo','ensamble_consumo','traspaso_salida')
  )
  select
    round(coalesce(sum(inv.valor),0)),
    round(coalesce(sum(inv.valor) filter (where mo.producto_id is null),0)),
    count(*) filter (where mo.producto_id is null)
  into v_valor, v_dormido, v_n_dormido
  from inv
  left join movido mo
    on mo.producto_id = inv.producto_id and mo.sede_id = inv.sede_id;

  -- Venta que se esta perdiendo: los A que se agotaron teniendo minimo puesto.
  select count(*) into v_agotados
  from inventario i
  join productos p on p.id = i.producto_id
  where i.cantidad = 0
    and coalesce(i.stock_minimo,0) > 0
    and p.activo = true
    and p.clasificacion_global = 'A'
    and (p_sede is null or i.sede_id = p_sede);

  return jsonb_build_object(
    'valor_costo', v_valor,
    'dormido', v_dormido,
    'n_dormido', v_n_dormido,
    'agotados_a', v_agotados);
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_panel_inventario(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_panel_inventario(text) TO authenticated, service_role;
