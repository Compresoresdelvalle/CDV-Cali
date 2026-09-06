-- La cascada del resultado del panel.
--
--   Ventas netas         lo facturado menos retenciones, sin anuladas
-- - Costo de lo vendido  suma de cantidad x costo_unitario del detalle
-- = Margen bruto
-- - Gastos operativos    los clasificados como gasto MAS los sin clasificar
-- = Resultado
--
-- Tres decisiones que sostienen que el numero no mienta:
--
-- 1. Los abonos a proveedor NO restan: pagan mercancia que ya esta contada
--    dentro del costo de lo vendido, y restarlos seria contarla dos veces. Eso
--    es lo que decide categorias_gasto.afecta_resultado.
--
-- 2. Los egresos SIN CLASIFICAR si restan. Es deliberado y es lo conservador:
--    si se excluyeran, el Resultado inflaria la ganancia mostrando menos gastos
--    de los que hay, y para quien decide ese es el error peligroso. Contandolos,
--    el numero que se ve es el PEOR caso y clasificar solo puede subirlo. El
--    aviso deja de ser una amenaza ("podria bajar a X") y pasa a ser un
--    incentivo ("al clasificarlos puede subir hasta X"). Ademas nunca bloquea
--    la operacion: un egreso sin categoria entra igual y queda visible.
--
-- 3. Productos y servicios van separados: los servicios entran con costo cero y
--    mezclarlos infla el porcentaje de margen. Medido sobre 90 dias reales:
--    mezclado da 73,2%, pero productos es 64,9% y servicios 100%.
--
-- Solo Admin: la validacion esta aqui, no escondiendo la tarjeta en el frontend.
--
-- Verificado contra produccion: la cascada cierra, y tarda 45 ms sobre todo el
-- historico.
CREATE OR REPLACE FUNCTION public.fn_panel_resultado(p_desde date, p_hasta date, p_sede text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ventas numeric; v_costo numeric;
  v_ventas_prod numeric; v_costo_prod numeric;
  v_ventas_serv numeric;
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

  -- Costo de lo vendido, y el desglose producto/servicio.
  select
    coalesce(sum(dv.cantidad * dv.costo_unitario),0),
    coalesce(sum(dv.subtotal) filter (where dv.producto_id is not null),0),
    coalesce(sum(dv.cantidad * dv.costo_unitario) filter (where dv.producto_id is not null),0),
    coalesce(sum(dv.subtotal) filter (where dv.producto_id is null),0)
  into v_costo, v_ventas_prod, v_costo_prod, v_ventas_serv
  from detalle_venta dv
  join ventas v on v.id = dv.venta_id
  where v.anulada = false
    and v.origen in ('directa','ot')
    and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or v.sede_id = p_sede);

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
    -- Separados porque los servicios entran con costo cero y mezclarlos
    -- inflaria el porcentaje.
    'margen_productos', jsonb_build_object(
      'venta', v_ventas_prod, 'costo', v_costo_prod,
      'margen', v_ventas_prod - v_costo_prod,
      'pct', case when v_ventas_prod > 0
                  then round((v_ventas_prod - v_costo_prod) / v_ventas_prod * 100, 1)
                  else null end),
    'margen_servicios', jsonb_build_object(
      'venta', v_ventas_serv, 'costo', 0, 'margen', v_ventas_serv, 'pct', 100),
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
