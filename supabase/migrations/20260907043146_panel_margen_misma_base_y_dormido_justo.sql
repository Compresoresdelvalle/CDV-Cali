-- Dos correcciones de logica encontradas en la revision.
--
-- 1) EL DESGLOSE DE MARGEN USABA OTRA BASE QUE EL TITULAR.
--
-- La cascada mostraba en un mismo renglon "73.2% en total · productos 65.0% ·
-- servicios 100%". El 73.2% sale de total-retenciones; el 65% y el 100% salian
-- de detalle_venta.subtotal, que no lleva IVA ni domicilio y no resta descuento
-- ni retencion. Productos + servicios daban 409.505.882 contra unas ventas
-- netas de 440.876.783: 31.370.901 de diferencia entre tres porcentajes que se
-- leen juntos en la misma linea. Ahora los tres salen de la misma base — la
-- venta neta repartida entre las lineas, igual que fn_panel_composicion — asi
-- que productos + servicios da exactamente las ventas netas.
--
-- Y el margen de servicios se calcula, ya no se asume 100%: si algun dia una
-- linea de servicio lleva costo, el panel lo tiene que decir en vez de tapar.
CREATE OR REPLACE FUNCTION public.fn_panel_resultado(
  p_desde date,
  p_hasta date,
  p_sede text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ventas numeric; v_costo numeric;
  v_ventas_prod numeric; v_costo_prod numeric;
  v_ventas_serv numeric; v_costo_serv numeric;
  v_gastos_clas numeric;
  v_sc_n int; v_sc_monto numeric;
  v_gastos numeric;
  v_n_ventas int;
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  if (select get_my_rol()) <> 'Admin' then
    raise exception 'El margen y los costos son información de administración';
  end if;

  -- Ventas netas: lo que de verdad representa el periodo. Se descuenta la
  -- retencion porque esa plata nunca entra: se va a la DIAN.
  select coalesce(sum(v.total - coalesce(v.retenciones_total,0)),0), count(*)
    into v_ventas, v_n_ventas
  from ventas v
  where v.anulada = false
    and v.origen in ('directa','ot')
    and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or v.sede_id = p_sede);

  -- Costo de lo vendido, y el desglose producto/servicio SOBRE LA MISMA BASE
  -- que el titular: la venta neta repartida entre las lineas en proporcion al
  -- subtotal de cada una.
  with lineas as (
    select
      dv.producto_id, dv.cantidad, dv.costo_unitario,
      (v.total - coalesce(v.retenciones_total,0))
        * (dv.subtotal / nullif(sum(dv.subtotal) over (partition by v.id), 0))
        as venta_neta
    from detalle_venta dv
    join ventas v on v.id = dv.venta_id
    where v.anulada = false
      and v.origen in ('directa','ot')
      and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
      and (p_sede is null or v.sede_id = p_sede)
  )
  select
    coalesce(sum(l.cantidad * l.costo_unitario),0),
    coalesce(sum(l.venta_neta) filter (where l.producto_id is not null),0),
    coalesce(sum(l.cantidad * l.costo_unitario) filter (where l.producto_id is not null),0),
    coalesce(sum(l.venta_neta) filter (where l.producto_id is null),0),
    coalesce(sum(l.cantidad * l.costo_unitario) filter (where l.producto_id is null),0)
  into v_costo, v_ventas_prod, v_costo_prod, v_ventas_serv, v_costo_serv
  from lineas l;

  -- Gastos ya clasificados como gasto real.
  select coalesce(sum(c.total),0) into v_gastos_clas
  from compras c
  join categorias_gasto g on g.id = c.categoria_gasto_id
  where c.es_caja_menor = true
    and c.estado <> 'cancelada'
    and g.afecta_resultado = true
    and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or c.sede_destino_id = p_sede);

  -- Lo que todavia no se sabe. Se cuenta como gasto (ver decision 2).
  select count(*), coalesce(sum(c.total),0) into v_sc_n, v_sc_monto
  from compras c
  where c.es_caja_menor = true
    and c.estado <> 'cancelada'
    and c.categoria_gasto_id is null
    and (c.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or c.sede_destino_id = p_sede);

  -- Pesos enteros: el costo promedio trae decimales y a esta escala los
  -- centavos son ruido. Se redondea en el origen para que la cascada siga
  -- cerrando exactamente.
  v_ventas := round(v_ventas);
  v_costo := round(v_costo);
  v_ventas_prod := round(v_ventas_prod);
  v_costo_prod := round(v_costo_prod);
  v_ventas_serv := round(v_ventas_serv);
  v_costo_serv := round(v_costo_serv);
  v_gastos_clas := round(v_gastos_clas);
  v_sc_monto := round(v_sc_monto);
  v_gastos := v_gastos_clas + v_sc_monto;

  return jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta, 'sede', p_sede,
    'ventas_netas',  v_ventas,
    'costo_vendido', v_costo,
    'margen_bruto',  v_ventas - v_costo,
    'margen_pct',    case when v_ventas > 0
                          then round((v_ventas - v_costo) / v_ventas * 100, 1)
                          else null end,
    'gastos',              v_gastos,
    'gastos_clasificados', v_gastos_clas,
    'resultado',     v_ventas - v_costo - v_gastos,
    'n_ventas',      v_n_ventas,
    -- Separados porque los servicios entran casi sin costo y mezclarlos
    -- escondería que el margen de producto es mucho mas bajo.
    'margen_productos', jsonb_build_object(
      'venta', v_ventas_prod, 'costo', v_costo_prod,
      'margen', v_ventas_prod - v_costo_prod,
      'pct', case when v_ventas_prod > 0
                  then round((v_ventas_prod - v_costo_prod) / v_ventas_prod * 100, 1)
                  else null end),
    'margen_servicios', jsonb_build_object(
      'venta', v_ventas_serv, 'costo', v_costo_serv,
      'margen', v_ventas_serv - v_costo_serv,
      'pct', case when v_ventas_serv > 0
                  then round((v_ventas_serv - v_costo_serv) / v_ventas_serv * 100, 1)
                  else null end),
    -- Cuanto de los gastos es todavia una incognita, y hasta donde puede SUBIR
    -- el resultado si al clasificarlos resultan no ser gasto del periodo.
    'sin_clasificar', jsonb_build_object(
      'n', v_sc_n,
      'monto', v_sc_monto,
      'resultado_mejor_caso', v_ventas - v_costo - v_gastos_clas)
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_panel_resultado(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_panel_resultado(date, date, text) TO authenticated, service_role;


-- 2) "PLATA DORMIDA" CULPABA A LA MERCANCIA RECIEN LLEGADA.
--
-- La definicion era "no ha salido en 90 dias", y eso marcaba como dormidos 62
-- SKUs por 10.382.974 que habian ENTRADO hace menos de 30 dias: no han salido
-- porque acaban de llegar, no porque esten quietos. Ahora dormido es "sin
-- ningun movimiento comercial en 90 dias", entrada o salida.
--
-- Los ajustes y los conteos ciclicos NO cuentan como movimiento: un conteo no
-- es que la mercancia se haya movido, y dejarlo contar despertaria productos
-- que llevan un ano quietos solo porque alguien paso a contarlos.
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
    -- Movimiento comercial: salio o entro de verdad. La salida incluye el
    -- traspaso porque BODEGA casi no vende, despacha a las otras sedes.
    select distinct m.producto_id, m.sede_id
    from movimientos m
    where m.fecha >= v_desde
      and m.tipo in ('venta','orden_consumo','ensamble_consumo','traspaso_salida',
                     'compra','traspaso_entrada','ensamble_produccion')
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
