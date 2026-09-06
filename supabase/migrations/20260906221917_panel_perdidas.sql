-- En que se pierde la plata. La seccion que motivo el rediseno del panel.
--
-- Los seis conceptos vienen SIEMPRE, aunque valgan cero: un concepto ausente no
-- se distingue de uno en cero, y "ningun producto se vendio bajo costo en este
-- periodo" es una respuesta util, no un hueco.
--
-- Las OT no autorizadas NO suman al total: su monto es el valor de revision,
-- que si se cobro. Sumarlo inflaria la cifra. Van como conteo, aparte.
--
-- Medido sobre 90 dias reales: bajo costo 6.535.825 en 103 lineas, descuentos
-- 1.522.551 en 32 ventas, garantias 270.000 en 4 casos. Total 8.328.376.
CREATE OR REPLACE FUNCTION public.fn_panel_perdidas(
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
  v_bc_monto numeric; v_bc_n int;
  v_desc_monto numeric; v_desc_n int;
  v_dev_monto numeric; v_dev_n int;
  v_gar_monto numeric; v_gar_n int;
  v_ret_monto numeric; v_ret_n int;
  v_ot_n int; v_ot_monto numeric;
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  if (select get_my_rol()) <> 'Admin' then
    raise exception 'El margen y los costos son información de administración';
  end if;

  -- 1. Vendido por debajo del costo. Linea a linea: una venta puede tener una
  --    linea en perdida y el resto bien.
  select coalesce(sum(dv.cantidad * dv.costo_unitario - dv.subtotal),0), count(*)
    into v_bc_monto, v_bc_n
  from detalle_venta dv join ventas v on v.id = dv.venta_id
  where v.anulada = false
    and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or v.sede_id = p_sede)
    and dv.producto_id is not null
    and dv.costo_unitario > 0
    and dv.subtotal < dv.cantidad * dv.costo_unitario;

  -- 2. Descuentos otorgados.
  select coalesce(sum(greatest(0, least(
           coalesce(v.descuento_valor, v.subtotal * coalesce(v.descuento_pct,0)/100),
           v.subtotal))),0),
         count(*) filter (where coalesce(v.descuento_valor, v.subtotal * coalesce(v.descuento_pct,0)/100) > 0)
    into v_desc_monto, v_desc_n
  from ventas v
  where v.anulada = false
    and v.origen in ('directa','ot')
    and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or v.sede_id = p_sede);

  -- 3. Devoluciones con reembolso.
  select coalesce(sum(d.monto_reembolso),0), count(*)
    into v_dev_monto, v_dev_n
  from devoluciones d
  where d.estado <> 'anulada' and coalesce(d.monto_reembolso,0) > 0
    and (d.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or d.sede_id = p_sede);

  -- 4. Garantias resueltas devolviendo plata.
  select coalesce(sum(g.monto_devuelto),0), count(*)
    into v_gar_monto, v_gar_n
  from garantias_venta g
  left join ventas gv on gv.id = g.venta_id
  left join ordenes_servicio go on go.id = g.orden_servicio_id
  where g.estado <> 'anulada' and g.resolucion = 'devolver_dinero'
    and (g.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or coalesce(gv.sede_id, go.sede_id) = p_sede);

  -- 5. Retenciones: plata facturada que se fue a la DIAN o al municipio.
  select coalesce(sum(v.retenciones_total),0),
         count(*) filter (where coalesce(v.retenciones_total,0) > 0)
    into v_ret_monto, v_ret_n
  from ventas v
  where v.anulada = false
    and v.origen in ('directa','ot')
    and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or v.sede_id = p_sede);

  -- 6. OT diagnosticadas que nadie autorizo: trabajo hecho que no se vendio.
  --    El monto es lo que SI se alcanzo a cobrar por la revision, no la perdida
  --    (el costo del tiempo del tecnico no esta en la base), asi que no suma al
  --    total y la UI lo presenta como conteo.
  select count(*), coalesce(sum(o.valor_revision),0)
    into v_ot_n, v_ot_monto
  from ordenes_servicio o
  where o.estado_autorizacion = 'no_autorizado'
    and (o.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
    and (p_sede is null or o.sede_id = p_sede);

  return jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta, 'sede', p_sede,
    'bajo_costo',   jsonb_build_object('monto', v_bc_monto,  'n', v_bc_n,
                      'etiqueta', 'Vendido bajo costo', 'unidad', 'líneas',
                      'suma_al_total', true),
    'descuentos',   jsonb_build_object('monto', v_desc_monto,'n', v_desc_n,
                      'etiqueta', 'Descuentos otorgados', 'unidad', 'ventas',
                      'suma_al_total', true),
    'devoluciones', jsonb_build_object('monto', v_dev_monto, 'n', v_dev_n,
                      'etiqueta', 'Devoluciones reembolsadas', 'unidad', 'casos',
                      'suma_al_total', true),
    'garantias',    jsonb_build_object('monto', v_gar_monto, 'n', v_gar_n,
                      'etiqueta', 'Garantías reembolsadas', 'unidad', 'casos',
                      'suma_al_total', true),
    'retenciones',  jsonb_build_object('monto', v_ret_monto, 'n', v_ret_n,
                      'etiqueta', 'Retenciones', 'unidad', 'facturas',
                      'suma_al_total', true),
    'ot_no_autorizadas', jsonb_build_object('monto', v_ot_monto, 'n', v_ot_n,
                      'etiqueta', 'OT diagnosticadas sin autorizar', 'unidad', 'OT',
                      'suma_al_total', false),
    'total', v_bc_monto + v_desc_monto + v_dev_monto + v_gar_monto + v_ret_monto
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_panel_perdidas(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_panel_perdidas(date, date, text) TO authenticated, service_role;
