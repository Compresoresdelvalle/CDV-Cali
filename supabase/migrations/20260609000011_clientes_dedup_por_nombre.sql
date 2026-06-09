-- Clientes duplicados: el mismo cliente aparecía varias veces porque
-- fn_upsert_cliente SOLO deduplicaba por identificación (NIT/cédula). Sin NIT,
-- cada venta/cotización/OT/recibo creaba un cliente nuevo.
--
-- Este migración:
--   1) Fusiona los duplicados existentes (por nombre normalizado): repunta las
--      FKs (ventas/cotizaciones/ordenes_servicio/recibos.cliente_id) al cliente
--      canónico y desactiva los sobrantes (activo=false, reversible).
--   2) Agrega un candado único por NIT (entre clientes activos).
--   3) Reescribe fn_upsert_cliente para reutilizar también por NOMBRE cuando no
--      hay NIT, y para enriquecer datos faltantes sin pisar lo ya guardado.

-- ── 1) Fusionar duplicados existentes ───────────────────────────────────────
-- Canónico por nombre normalizado: preferir el que tiene identificación, luego
-- el más antiguo.
create temporary table _merge_clientes as
with canon as (
  select id,
         lower(btrim(nombre)) as nn,
         row_number() over (
           partition by lower(btrim(nombre))
           order by (identificacion is null), created_at asc, id asc
         ) as rn
  from public.clientes
  where activo = true
)
select d.id as dupe_id, k.id as canon_id
  from canon d
  join canon k on k.nn = d.nn and k.rn = 1
 where d.rn > 1;

update public.ventas v           set cliente_id = m.canon_id
  from _merge_clientes m where v.cliente_id = m.dupe_id;
update public.cotizaciones c     set cliente_id = m.canon_id
  from _merge_clientes m where c.cliente_id = m.dupe_id;
update public.ordenes_servicio o set cliente_id = m.canon_id
  from _merge_clientes m where o.cliente_id = m.dupe_id;
update public.recibos r          set cliente_id = m.canon_id
  from _merge_clientes m where r.cliente_id = m.dupe_id;

update public.clientes set activo = false, updated_at = now()
 where id in (select dupe_id from _merge_clientes);

drop table _merge_clientes;

-- ── 2) Candado único por NIT (solo clientes activos) ────────────────────────
create unique index if not exists ux_clientes_ident_activa
  on public.clientes (identificacion)
  where identificacion is not null and activo;

-- ── 3) fn_upsert_cliente: reutilizar por identificación O por nombre ────────
create or replace function public.fn_upsert_cliente(
  p_nombre text,
  p_identificacion text default null,
  p_telefono text default null,
  p_email text default null,
  p_direccion text default null
)
returns public.clientes
language plpgsql
set search_path to ''
as $function$
declare
  v_cliente public.clientes;
  v_nombre  text := nullif(btrim(p_nombre), '');
  v_ident   text := nullif(btrim(p_identificacion), '');
  v_tel     text := nullif(btrim(p_telefono), '');
  v_email   text := nullif(btrim(p_email), '');
  v_dir     text := nullif(btrim(p_direccion), '');
begin
  if v_nombre is null then
    raise exception 'El nombre del cliente es obligatorio';
  end if;

  -- 1) Si hay NIT/cédula, reutilizar por identificación.
  if v_ident is not null then
    select * into v_cliente
      from public.clientes
     where identificacion = v_ident and activo
     limit 1;
    if found then
      return v_cliente;
    end if;
  end if;

  -- 2) Reutilizar por NOMBRE normalizado (evita duplicar al registrar sin NIT).
  --    No mezcla dos NIT distintos: solo casa filas sin NIT o con el mismo NIT.
  select * into v_cliente
    from public.clientes
   where activo
     and lower(btrim(nombre)) = lower(v_nombre)
     and (identificacion is null or v_ident is null or identificacion = v_ident)
   order by (identificacion is null), created_at asc
   limit 1;
  if found then
    -- Enriquecer datos faltantes sin pisar lo ya guardado.
    update public.clientes set
      identificacion = coalesce(identificacion, v_ident),
      telefono       = coalesce(telefono, v_tel),
      email          = coalesce(email, v_email),
      direccion      = coalesce(direccion, v_dir),
      updated_at     = now()
    where id = v_cliente.id
    returning * into v_cliente;
    return v_cliente;
  end if;

  -- 3) No existe: crear.
  insert into public.clientes (nombre, identificacion, telefono, email, direccion)
  values (v_nombre, v_ident, v_tel, v_email, v_dir)
  returning * into v_cliente;

  return v_cliente;
end;
$function$;
