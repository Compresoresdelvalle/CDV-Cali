-- Dos huecos mas del desglose, encontrados comparando el pie contra la cascada
-- en el navegador.
--
-- 1) EL COSTO DE LO QUE SE REGALA DESAPARECIA.
--
-- Las ventas cuyas lineas suman 0 (precio 0, que la regla de negocio permite a
-- proposito) daban venta_neta NULL y quedaban FUERA del desglose. Su costo si
-- estaba en el titular de la cascada: 1.231.958 en 10 ventas que se veian en
-- "Costo de lo vendido" y en ningun renglon de la tabla. Justo la mercancia
-- regalada es la que uno quiere poder encontrar en un panel de "en que se va la
-- plata". Ahora esas lineas entran con venta 0 y su costo cuenta donde debe.
--
-- 2) EL PIE SE PASABA UN PESO.
--
-- Redondear cada grupo por separado y sumar no da lo mismo que redondear la
-- suma: con 101 grupos el pie decia 440.876.784 y la cascada 440.876.783.
-- Un peso no mueve una decision, pero la seccion promete en su propio subtitulo
-- que las dos cifras son la misma, y dos numeros distintos uno encima del otro
-- es lo que hace que alguien deje de creerle al panel.
--
-- Se reparte por el metodo del resto mayor: todos los grupos se redondean hacia
-- abajo y los pesos que faltan se dan de a uno a los grupos con la fraccion mas
-- grande. Asi la suma de las partes es EXACTAMENTE el total redondeado, tanto
-- en venta como en costo. Verificado en produccion: los siete ejes cierran con
-- diferencia 0 contra fn_panel_resultado.
--
-- Se mantiene la fila del resto (es_resto) que introdujo la migracion anterior.
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
      -- La venta neta completa, repartida entre las lineas en proporcion al
      -- subtotal. Si las lineas suman 0 (todo regalado) se reparte en partes
      -- iguales: da lo mismo (el neto es 0) pero la linea NO se pierde, y con
      -- ella se conserva su costo.
      case
        when sum(dv.subtotal) over (partition by v.id) <> 0
          then (v.total - coalesce(v.retenciones_total,0))
               * (dv.subtotal / sum(dv.subtotal) over (partition by v.id))
        else (v.total - coalesce(v.retenciones_total,0))
             / count(*) over (partition by v.id)
      end as venta_neta
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
  ),
  -- Metodo del resto mayor, para venta y para costo por separado.
  aporcionado as (
    select t.*,
      floor(t.venta) as v_piso,
      floor(t.costo) as c_piso,
      row_number() over (order by (t.venta - floor(t.venta)) desc, t.venta desc) as rv,
      row_number() over (order by (t.costo - floor(t.costo)) desc, t.costo desc) as rc,
      (round(sum(t.venta) over ()) - sum(floor(t.venta)) over ()) as sobra_v,
      (round(sum(t.costo) over ()) - sum(floor(t.costo)) over ()) as sobra_c
    from todo t
  ),
  final as (
    select a.clave, a.etiqueta, a.n, a.es_resto,
      (a.v_piso + case when a.rv <= a.sobra_v then 1 else 0 end)::numeric as venta,
      (a.c_piso + case when a.rc <= a.sobra_c then 1 else 0 end)::numeric as costo
    from aporcionado a
  )
  select
    f.clave, f.etiqueta, f.venta, f.costo,
    f.venta - f.costo,
    case when f.venta > 0 then round((f.venta - f.costo) / f.venta * 100, 1) else null end,
    f.n::int,
    f.es_resto
  from final f
  -- La fila del resto va SIEMPRE al final, aunque se ordene por otra cosa: es
  -- un agregado, no compite con los grupos individuales.
  order by f.es_resto, f.venta desc;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_panel_composicion(text, date, date, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_panel_composicion(text, date, date, text, int) TO authenticated, service_role;
