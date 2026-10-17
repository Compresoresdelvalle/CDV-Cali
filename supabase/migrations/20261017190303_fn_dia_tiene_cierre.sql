-- ¿Ese día ya tiene un cierre guardado que cubra esta sede? Devuelve solo el
-- número y el tipo, nunca montos: la vendedora necesita saber que el día está
-- cerrado, no la plata de las demás sedes (los cierres diarios son globales).
create or replace function public.fn_dia_tiene_cierre(p_fecha date, p_sede text default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select jsonb_build_object('numero', c.numero, 'tipo', c.tipo, 'sede_id', c.sede_id)
       from cierres c
      where auth.uid() is not null
        and p_fecha between c.fecha_desde and c.fecha_hasta
        and (c.sede_id is null or p_sede is null or c.sede_id = p_sede)
      order by c.created_at desc
      limit 1),
    'null'::jsonb);
$$;
revoke all on function public.fn_dia_tiene_cierre(date, text) from public, anon;
grant execute on function public.fn_dia_tiene_cierre(date, text) to authenticated, service_role;
notify pgrst, 'reload schema';
