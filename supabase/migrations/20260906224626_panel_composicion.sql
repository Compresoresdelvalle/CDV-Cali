-- De que se compone la venta, por la dimension que se pida.
--
-- Una sola funcion con parametro de dimension y una forma de salida comun, no
-- siete funciones: asi el panel tiene UNA tabla que cambia de eje, en vez de
-- siete widgets que hay que mantener por separado.
--
-- Se calcula sobre detalle_venta y no sobre ventas.total porque hay dimensiones
-- (producto, categoria) que solo existen a nivel de linea.
--
-- OJO con el reparto: la venta neta de la cascada es total - retenciones, y el
-- total NO es la suma de las lineas: lleva ademas IVA y domicilio, y menos el
-- descuento. Medido sobre los ultimos 90 dias, las lineas suman 405.499.719 y
-- la cascada dice 436.524.418. Por eso NO basta con repartir la retencion: se
-- reparte la venta neta COMPLETA entre las lineas, en proporcion al subtotal de
-- cada una. Asi cada peso que la cascada cuenta aparece en exactamente un
-- renglon del desglose, y las partes suman el total. Si se repartiera solo la
-- retencion, el desglose y la cascada mostrarian numeros distintos y no habria
-- forma de saber cual creer.
--
-- Las ventas cuyas lineas suman cero quedan fuera (no hay entre que repartir).
-- Verificado: son 29 en todo el historico y entre todas mueven $0 neto.
--
-- Verificado en produccion: las cuatro sedes suman 436.524.418, exactamente lo
-- que dice fn_panel_resultado. La dimension mas pesada (producto, sobre todo el
-- historico) responde en 87 ms.
CREATE OR REPLACE FUNCTION public.fn_panel_composicion(
  p_dimension text,
  p_desde date,
  p_hasta date,
  p_sede text DEFAULT NULL,
  p_limite int DEFAULT 100
)
 RETURNS TABLE (
   clave text,
   etiqueta text,
   venta numeric,
   costo numeric,
   margen numeric,
   margen_pct numeric,
   n int
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
  if p_dimension not in ('sede','vendedora','producto','categoria','tipo','metodo_pago','cliente') then
    raise exception 'Dimensión desconocida: %', p_dimension;
  end if;

  return query
  with lineas as (
    select
      dv.producto_id, dv.cantidad, dv.costo_unitario,
      v.id as venta_id, v.sede_id, v.vendedor_id, v.metodo_pago, v.origen,
      coalesce(nullif(btrim(v.cliente_nombre),''), 'Consumidor final') as cliente,
      -- La venta neta de la venta completa, repartida entre sus lineas en
      -- proporcion al subtotal de cada una.
      (v.total - coalesce(v.retenciones_total,0))
        * (dv.subtotal / nullif(sum(dv.subtotal) over (partition by v.id), 0))
        as venta_neta
    from detalle_venta dv
    join ventas v on v.id = dv.venta_id
    where v.anulada = false
      and v.origen in ('directa','ot')
      and (v.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
      and (p_sede is null or v.sede_id = p_sede)
  ),
  agrupado as (
    select
      case p_dimension
        when 'sede'        then l.sede_id
        when 'vendedora'   then l.vendedor_id::text
        when 'producto'    then coalesce(l.producto_id::text, 'servicio')
        when 'categoria'   then coalesce(nullif(btrim(p.categoria),''), 'Servicios y mano de obra')
        when 'tipo'        then l.origen
        when 'metodo_pago' then coalesce(l.metodo_pago, 'Sin método')
        else l.cliente
      end as clave,
      sum(l.venta_neta) as venta,
      sum(l.cantidad * l.costo_unitario) as costo,
      count(distinct l.venta_id) as n
    from lineas l
    left join productos p on p.id = l.producto_id
    where l.venta_neta is not null
    group by 1
  )
  select
    a.clave,
    -- La etiqueta legible se resuelve aqui para que el frontend no tenga que
    -- pedir usuarios ni productos aparte solo para pintar un nombre.
    case p_dimension
      when 'sede'      then coalesce(s.nombre, a.clave)
      when 'vendedora' then coalesce(u.nombre, 'Sin vendedor')
      when 'producto'  then coalesce(pr.nombre, 'Servicios y mano de obra')
      when 'tipo'      then case a.clave when 'directa' then 'Mostrador'
                                         when 'ot' then 'Orden de trabajo'
                                         else a.clave end
      else a.clave
    end::text,
    -- Pesos enteros, igual que la cascada: los centavos del costo promedio son
    -- ruido y verlos al lado de una cifra entera se lee como un error.
    round(a.venta),
    round(a.costo),
    round(a.venta) - round(a.costo),
    case when a.venta > 0 then round((a.venta - a.costo) / a.venta * 100, 1) else null end,
    a.n::int
  from agrupado a
  left join sedes s      on p_dimension = 'sede'      and s.id = a.clave
  left join usuarios u   on p_dimension = 'vendedora' and u.id::text = a.clave
  left join productos pr on p_dimension = 'producto'  and pr.id::text = a.clave
  order by 3 desc
  limit p_limite;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_panel_composicion(text, date, date, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_panel_composicion(text, date, date, text, int) TO authenticated, service_role;
