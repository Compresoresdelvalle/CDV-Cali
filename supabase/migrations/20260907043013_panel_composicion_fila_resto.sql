-- El desglose cortaba en 100 grupos y el pie seguia diciendo "Total".
--
-- Con la dimension producto eso daba 348.803.179 debajo de un titular de
-- 440.876.783: 92 millones desaparecidos, en una seccion cuyo propio subtitulo
-- promete que el total de abajo da lo mismo que las ventas netas de arriba. Con
-- cliente faltaban 52.500.550. Dos cifras que se contradicen en la misma
-- pantalla es justo lo que este panel existe para no hacer.
--
-- Ahora, cuando hay mas grupos que el limite, se agrega UNA fila con todo lo
-- que no cupo (es_resto = true) para que las partes vuelvan a sumar el total.
-- No se sube el limite: una tabla de 2.000 productos no se lee, y "Otros 1.900
-- productos" dice la verdad y ocupa un renglon.
--
-- Ojo con `n` de la fila resto: suma los count(distinct venta) de cada grupo.
-- Eso es exacto en las dimensiones donde una venta cae en un solo grupo (sede,
-- vendedora, tipo, metodo de pago, cliente) y sobrecuenta en producto y
-- categoria — que son justo las dos donde el pie NO suma facturas y muestra un
-- guion.
DROP FUNCTION IF EXISTS public.fn_panel_composicion(text, date, date, text, int);

CREATE FUNCTION public.fn_panel_composicion(
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
   n int,
   es_resto boolean
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_plural text;
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  if (select get_my_rol()) <> 'Admin' then
    raise exception 'El margen y los costos son información de administración';
  end if;
  if p_dimension not in ('sede','vendedora','producto','categoria','tipo','metodo_pago','cliente') then
    raise exception 'Dimensión desconocida: %', p_dimension;
  end if;

  v_plural := case p_dimension
                when 'producto'    then 'productos'
                when 'categoria'   then 'categorías'
                when 'cliente'     then 'clientes'
                when 'vendedora'   then 'vendedoras'
                when 'sede'        then 'sedes'
                when 'tipo'        then 'tipos'
                else 'métodos de pago' end;

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
  ),
  rankeado as (
    select a.*, row_number() over (order by a.venta desc nulls last) as rn
    from agrupado a
  ),
  cabeza as (
    select
      r.clave,
      -- La etiqueta legible se resuelve aqui para que el frontend no tenga que
      -- pedir usuarios ni productos aparte solo para pintar un nombre.
      (case p_dimension
        when 'sede'      then coalesce(s.nombre, r.clave)
        when 'vendedora' then coalesce(u.nombre, 'Sin vendedor')
        when 'producto'  then coalesce(pr.nombre, 'Servicios y mano de obra')
        when 'tipo'      then case r.clave when 'directa' then 'Mostrador'
                                           when 'ot' then 'Orden de trabajo'
                                           else r.clave end
        else r.clave
      end)::text as etiqueta,
      r.venta, r.costo, r.n, false as es_resto
    from rankeado r
    left join sedes s      on p_dimension = 'sede'      and s.id = r.clave
    left join usuarios u   on p_dimension = 'vendedora' and u.id::text = r.clave
    left join productos pr on p_dimension = 'producto'  and pr.id::text = r.clave
    where r.rn <= p_limite
  ),
  resto as (
    select
      '__resto__'::text as clave,
      ('Otros ' || count(*)::text || ' ' || v_plural)::text as etiqueta,
      sum(r.venta) as venta, sum(r.costo) as costo, sum(r.n)::bigint as n,
      true as es_resto
    from rankeado r
    where r.rn > p_limite
    having count(*) > 0
  ),
  todo as (
    select * from cabeza
    union all
    select * from resto
  )
  select
    t.clave, t.etiqueta,
    -- Pesos enteros, igual que la cascada: los centavos del costo promedio son
    -- ruido y verlos al lado de una cifra entera se lee como un error.
    round(t.venta),
    round(t.costo),
    round(t.venta) - round(t.costo),
    case when t.venta > 0 then round((t.venta - t.costo) / t.venta * 100, 1) else null end,
    t.n::int,
    t.es_resto
  from todo t
  -- La fila del resto va SIEMPRE al final, aunque se ordene por otra cosa: es
  -- un agregado, no compite con los grupos individuales.
  order by t.es_resto, t.venta desc;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_panel_composicion(text, date, date, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_panel_composicion(text, date, date, text, int) TO authenticated, service_role;
