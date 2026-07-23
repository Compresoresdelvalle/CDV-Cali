-- Dashboard avanzado del Admin: rentabilidad real, cartera, inventario como
-- capital y desempeño. Admin-only, SECURITY DEFINER, solo lectura. Separado de
-- fn_dashboard_kpis (que es compartido con vendedores) para no bloatearlo.
create or replace function public.fn_dashboard_admin()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_mes date := date_trunc('month',(now() at time zone 'America/Bogota'))::date;
  v_prev date := (date_trunc('month',(now() at time zone 'America/Bogota'))-interval '1 month')::date;
  v_dias int := (now() at time zone 'America/Bogota')::date - date_trunc('month',(now() at time zone 'America/Bogota'))::date;
  v_res jsonb;
begin
  if v_uid is null then return jsonb_build_object('error','no_session'); end if;
  select rol::text into v_rol from usuarios where id = v_uid;
  if v_rol <> 'Admin' then return jsonb_build_object('error','solo_admin'); end if;

  select jsonb_build_object(
    'rentabilidad', jsonb_build_object(
      'ingreso_mes', (select coalesce(sum(dv.precio_unitario*dv.cantidad),0)::bigint from detalle_venta dv join ventas v on v.id=dv.venta_id where (v.fecha at time zone 'America/Bogota')::date>=v_mes and not v.anulada),
      'costo_mes',   (select coalesce(sum(dv.costo_unitario*dv.cantidad),0)::bigint from detalle_venta dv join ventas v on v.id=dv.venta_id where (v.fecha at time zone 'America/Bogota')::date>=v_mes and not v.anulada),
      'margen_mes',  (select coalesce(sum((dv.precio_unitario-dv.costo_unitario)*dv.cantidad),0)::bigint from detalle_venta dv join ventas v on v.id=dv.venta_id where (v.fecha at time zone 'America/Bogota')::date>=v_mes and not v.anulada),
      'gastos_mes',  (select coalesce(sum(total),0)::bigint from compras where (fecha at time zone 'America/Bogota')::date>=v_mes and estado<>'cancelada' and es_caja_menor=true),
      'descuentos_explicitos', (select coalesce(sum(descuento_valor),0)::bigint from ventas where (fecha at time zone 'America/Bogota')::date>=v_mes and not anulada),
      'rebaja_en_linea', (select coalesce(sum(greatest(coalesce(dv.precio_catalogo,dv.precio_unitario)-dv.precio_unitario,0)*dv.cantidad),0)::bigint from detalle_venta dv join ventas v on v.id=dv.venta_id where (v.fecha at time zone 'America/Bogota')::date>=v_mes and not v.anulada),
      'lineas_bajo_costo', (select count(*) from detalle_venta dv join ventas v on v.id=dv.venta_id where (v.fecha at time zone 'America/Bogota')::date>=v_mes and not v.anulada and dv.costo_unitario>0 and dv.precio_unitario<dv.costo_unitario),
      'perdida_bajo_costo', (select coalesce(sum((dv.costo_unitario-dv.precio_unitario)*dv.cantidad),0)::bigint from detalle_venta dv join ventas v on v.id=dv.venta_id where (v.fecha at time zone 'America/Bogota')::date>=v_mes and not v.anulada and dv.costo_unitario>0 and dv.precio_unitario<dv.costo_unitario),
      'lineas_sin_costo', (select count(*) from detalle_venta dv join ventas v on v.id=dv.venta_id where (v.fecha at time zone 'America/Bogota')::date>=v_mes and not v.anulada and dv.producto_id is not null and coalesce(dv.costo_unitario,0)=0),
      'top_utilidad', (select coalesce(jsonb_agg(t order by (t->>'utilidad')::bigint desc),'[]'::jsonb) from (
          select jsonb_build_object('nombre',p.nombre,'referencia',p.referencia,'categoria',coalesce(p.categoria,'(sin categoría)'),
                 'utilidad',sum((dv.precio_unitario-dv.costo_unitario)*dv.cantidad)::bigint,'ingreso',sum(dv.precio_unitario*dv.cantidad)::bigint,'unidades',sum(dv.cantidad)) t
          from detalle_venta dv join ventas v on v.id=dv.venta_id join productos p on p.id=dv.producto_id
          where (v.fecha at time zone 'America/Bogota')::date>=v_mes and not v.anulada
          group by p.id,p.nombre,p.referencia,p.categoria order by sum((dv.precio_unitario-dv.costo_unitario)*dv.cantidad) desc limit 5) sub),
      'margen_categoria', (select coalesce(jsonb_agg(t order by (t->>'utilidad')::bigint desc),'[]'::jsonb) from (
          select jsonb_build_object('categoria',coalesce(p.categoria,'(sin categoría)'),
                 'utilidad',sum((dv.precio_unitario-dv.costo_unitario)*dv.cantidad)::bigint,'ingreso',sum(dv.precio_unitario*dv.cantidad)::bigint) t
          from detalle_venta dv join ventas v on v.id=dv.venta_id join productos p on p.id=dv.producto_id
          where (v.fecha at time zone 'America/Bogota')::date>=v_mes and not v.anulada
          group by p.categoria order by sum((dv.precio_unitario-dv.costo_unitario)*dv.cantidad) desc limit 6) sub)
    ),
    'cartera', jsonb_build_object(
      'cxc_total', (select coalesce(sum(saldo),0)::bigint from v_cuentas_por_cobrar where saldo>0),
      'cxc_0_30', (select coalesce(sum(saldo),0)::bigint from v_cuentas_por_cobrar where saldo>0 and (v_hoy-(fecha at time zone 'America/Bogota')::date)<=30),
      'cxc_31_60', (select coalesce(sum(saldo),0)::bigint from v_cuentas_por_cobrar where saldo>0 and (v_hoy-(fecha at time zone 'America/Bogota')::date) between 31 and 60),
      'cxc_61mas', (select coalesce(sum(saldo),0)::bigint from v_cuentas_por_cobrar where saldo>0 and (v_hoy-(fecha at time zone 'America/Bogota')::date)>60),
      'cxc_docs', (select count(*) from v_cuentas_por_cobrar where saldo>0),
      'cxp_total', (select coalesce(sum(saldo),0)::bigint from v_cuentas_por_pagar where saldo>0),
      'cxp_0_30', (select coalesce(sum(saldo),0)::bigint from v_cuentas_por_pagar where saldo>0 and (v_hoy-(fecha at time zone 'America/Bogota')::date)<=30),
      'cxp_31_60', (select coalesce(sum(saldo),0)::bigint from v_cuentas_por_pagar where saldo>0 and (v_hoy-(fecha at time zone 'America/Bogota')::date) between 31 and 60),
      'cxp_61mas', (select coalesce(sum(saldo),0)::bigint from v_cuentas_por_pagar where saldo>0 and (v_hoy-(fecha at time zone 'America/Bogota')::date)>60),
      'cxp_docs', (select count(*) from v_cuentas_por_pagar where saldo>0),
      'top_deudores', (select coalesce(jsonb_agg(t order by (t->>'saldo')::bigint desc),'[]'::jsonb) from (
          select jsonb_build_object('cliente',coalesce(nullif(trim(cliente_nombre),''),'—'),'saldo',sum(saldo)::bigint,'docs',count(*)) t
          from v_cuentas_por_cobrar where saldo>0 group by trim(cliente_nombre) order by sum(saldo) desc limit 5) sub),
      'top_acreedores', (select coalesce(jsonb_agg(t order by (t->>'saldo')::bigint desc),'[]'::jsonb) from (
          select jsonb_build_object('proveedor',coalesce(nullif(trim(proveedor),''),'—'),'saldo',sum(saldo)::bigint,'docs',count(*)) t
          from v_cuentas_por_pagar where saldo>0 group by trim(proveedor) order by sum(saldo) desc limit 5) sub)
    ),
    'inventario', (
      with ls as (select producto_id, max(created_at) ult from movimientos where tipo='venta' group by producto_id)
      select jsonb_build_object(
        'valor_total', (select coalesce(sum(i.cantidad*p.costo_promedio),0)::bigint from inventario i join productos p on p.id=i.producto_id where p.activo),
        'capital_sin_rotar_90d', (select coalesce(sum(i.cantidad*p.costo_promedio),0)::bigint from inventario i join productos p on p.id=i.producto_id left join ls on ls.producto_id=i.producto_id where p.activo and i.cantidad>0 and (ls.ult is null or (ls.ult at time zone 'America/Bogota')::date<v_hoy-90)),
        'productos_sin_rotar_90d', (select count(distinct i.producto_id) from inventario i join productos p on p.id=i.producto_id left join ls on ls.producto_id=i.producto_id where p.activo and i.cantidad>0 and (ls.ult is null or (ls.ult at time zone 'America/Bogota')::date<v_hoy-90)),
        'valor_sobrestock', (select coalesce(sum(i.cantidad*p.costo_promedio),0)::bigint from inventario i join productos p on p.id=i.producto_id where p.activo and i.estado_stock='Sobrestock'),
        'productos_sobrestock', (select count(distinct i.producto_id) from inventario i where i.estado_stock='Sobrestock'),
        'top_dormido', (select coalesce(jsonb_agg(t order by (t->>'valor')::bigint desc),'[]'::jsonb) from (
            select jsonb_build_object('nombre',p.nombre,'referencia',p.referencia,
                   'valor',(i.cantidad*p.costo_promedio)::bigint,'cantidad',i.cantidad,
                   'dias', case when ls.ult is null then null else (v_hoy-(ls.ult at time zone 'America/Bogota')::date) end) t
            from inventario i join productos p on p.id=i.producto_id left join ls on ls.producto_id=i.producto_id
            where p.activo and i.cantidad>0 and (ls.ult is null or (ls.ult at time zone 'America/Bogota')::date<v_hoy-90)
            order by (i.cantidad*p.costo_promedio) desc limit 5) sub)
      )
    ),
    'desempeno', jsonb_build_object(
      'ventas_mtd', (select coalesce(sum(total),0)::bigint from ventas where (fecha at time zone 'America/Bogota')::date>=v_mes and not anulada and origen='directa'),
      'ventas_prev_mtd', (select coalesce(sum(total),0)::bigint from ventas where (fecha at time zone 'America/Bogota')::date>=v_prev and (fecha at time zone 'America/Bogota')::date<=v_prev+v_dias and not anulada and origen='directa'),
      'margen_mtd', (select coalesce(sum((dv.precio_unitario-dv.costo_unitario)*dv.cantidad),0)::bigint from detalle_venta dv join ventas v on v.id=dv.venta_id where (v.fecha at time zone 'America/Bogota')::date>=v_mes and not v.anulada),
      'margen_prev_mtd', (select coalesce(sum((dv.precio_unitario-dv.costo_unitario)*dv.cantidad),0)::bigint from detalle_venta dv join ventas v on v.id=dv.venta_id where (v.fecha at time zone 'America/Bogota')::date>=v_prev and (v.fecha at time zone 'America/Bogota')::date<=v_prev+v_dias and not v.anulada),
      'tickets_mes', (select count(*) from ventas where (fecha at time zone 'America/Bogota')::date>=v_mes and not anulada and origen='directa'),
      'ticket_prom', (select coalesce(avg(total),0)::bigint from ventas where (fecha at time zone 'America/Bogota')::date>=v_mes and not anulada and origen='directa' and total>0),
      'clientes_mes', (select count(distinct coalesce(cliente_id::text,cliente_nombre)) from ventas where (fecha at time zone 'America/Bogota')::date>=v_mes and not anulada),
      'dias_transcurridos', v_dias,
      'mejores_clientes', (select coalesce(jsonb_agg(t order by (t->>'compras')::bigint desc),'[]'::jsonb) from (
          select jsonb_build_object('cliente',coalesce(nullif(trim(cliente_nombre),''),'CONSUMIDOR FINAL'),'compras',sum(total)::bigint,'tickets',count(*)) t
          from ventas where (fecha at time zone 'America/Bogota')::date>=v_mes and not anulada
          group by trim(cliente_nombre) order by sum(total) desc limit 5) sub)
    )
  ) into v_res;
  return v_res;
end;
$function$;

revoke all on function public.fn_dashboard_admin() from public, anon;
grant execute on function public.fn_dashboard_admin() to authenticated;
