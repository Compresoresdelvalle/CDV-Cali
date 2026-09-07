-- El detalle de cada perdida, fila por fila, hasta el documento.
--
-- Devuelve una forma COMUN para que el panel tenga una sola tabla: fecha,
-- referencia legible, descripcion, monto, y a que documento llevar. Si cada
-- concepto devolviera columnas distintas habria que escribir seis tablas en el
-- frontend, y seis sitios donde equivocarse.
--
-- Verificado: el detalle de bajo costo suma exactamente lo mismo que el titular
-- de fn_panel_perdidas (103 lineas por 6.535.825,33).
CREATE OR REPLACE FUNCTION public.fn_panel_perdidas_detalle(
  p_concepto text,
  p_desde date,
  p_hasta date,
  p_sede text DEFAULT NULL,
  p_limite int DEFAULT 200
)
 RETURNS TABLE (
   fecha date,
   referencia text,
   descripcion text,
   monto numeric,
   doc_tipo text,
   doc_id uuid
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  if (select get_my_rol()) <> 'Admin' then
    raise exception 'El margen y los costos son información de administración';
  end if;
  if p_concepto not in ('bajo_costo','descuentos','devoluciones','garantias','retenciones','ot_no_autorizadas') then
    raise exception 'Concepto desconocido: %', p_concepto;
  end if;

  if p_concepto = 'bajo_costo' then
    return query
      select (v.fecha at time zone 'America/Bogota')::date,
             ('Venta #' || v.numero::text)::text,
             (coalesce(p.nombre, 'Producto') || ' × ' || dv.cantidad::text)::text,
             (dv.cantidad * dv.costo_unitario - dv.subtotal)::numeric,
             'venta'::text, v.id
      from detalle_venta dv
      join ventas v on v.id = dv.venta_id
      left join productos p on p.id = dv.producto_id
      where v.anulada = false
        and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        and (p_sede is null or v.sede_id = p_sede)
        and dv.producto_id is not null and dv.costo_unitario > 0
        and dv.subtotal < dv.cantidad * dv.costo_unitario
      order by (dv.cantidad * dv.costo_unitario - dv.subtotal) desc
      limit p_limite;

  elsif p_concepto = 'descuentos' then
    return query
      select (v.fecha at time zone 'America/Bogota')::date,
             ('Venta #' || v.numero::text)::text,
             coalesce(nullif(btrim(v.cliente_nombre),''), 'Consumidor final')::text,
             greatest(0, least(coalesce(v.descuento_valor, v.subtotal * coalesce(v.descuento_pct,0)/100), v.subtotal))::numeric,
             'venta'::text, v.id
      from ventas v
      where v.anulada = false and v.origen in ('directa','ot')
        and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        and (p_sede is null or v.sede_id = p_sede)
        and coalesce(v.descuento_valor, v.subtotal * coalesce(v.descuento_pct,0)/100) > 0
      order by 4 desc limit p_limite;

  elsif p_concepto = 'devoluciones' then
    return query
      select (d.fecha at time zone 'America/Bogota')::date,
             ('Devolución #' || d.id::text)::text,
             coalesce(d.motivo, 'Sin motivo')::text,
             d.monto_reembolso::numeric,
             'devolucion'::text, d.id
      from devoluciones d
      where d.estado <> 'anulada' and coalesce(d.monto_reembolso,0) > 0
        and (d.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        and (p_sede is null or d.sede_id = p_sede)
      order by 4 desc limit p_limite;

  elsif p_concepto = 'garantias' then
    return query
      select (g.fecha at time zone 'America/Bogota')::date,
             ('Garantía #' || g.id::text)::text,
             coalesce(g.motivo, 'Sin motivo')::text,
             g.monto_devuelto::numeric,
             -- La ruta real es /ops/garantias/venta/:id, no /ops/garantias/:id.
             'garantia_venta'::text, g.id
      from garantias_venta g
      left join ventas gv on gv.id = g.venta_id
      left join ordenes_servicio go on go.id = g.orden_servicio_id
      where g.estado <> 'anulada' and g.resolucion = 'devolver_dinero'
        and (g.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        and (p_sede is null or coalesce(gv.sede_id, go.sede_id) = p_sede)
      order by 4 desc limit p_limite;

  elsif p_concepto = 'retenciones' then
    return query
      select (v.fecha at time zone 'America/Bogota')::date,
             ('Venta #' || v.numero::text)::text,
             coalesce(nullif(btrim(v.cliente_nombre),''), 'Consumidor final')::text,
             v.retenciones_total::numeric,
             'venta'::text, v.id
      from ventas v
      where v.anulada = false and v.origen in ('directa','ot')
        and coalesce(v.retenciones_total,0) > 0
        and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        and (p_sede is null or v.sede_id = p_sede)
      order by 4 desc limit p_limite;

  else -- ot_no_autorizadas
    return query
      select (o.fecha at time zone 'America/Bogota')::date,
             ('OT #' || o.numero::text)::text,
             coalesce(o.equipo_descripcion, 'Equipo')::text,
             coalesce(o.valor_revision,0)::numeric,
             'orden'::text, o.id
      from ordenes_servicio o
      where o.estado_autorizacion = 'no_autorizado'
        and (o.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
        and (p_sede is null or o.sede_id = p_sede)
      order by 1 desc limit p_limite;
  end if;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_panel_perdidas_detalle(text, date, date, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_panel_perdidas_detalle(text, date, date, text, int) TO authenticated, service_role;
