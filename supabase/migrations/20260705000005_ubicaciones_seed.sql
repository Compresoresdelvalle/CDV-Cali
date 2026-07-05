-- ============================================================================
-- Bloque D1 — Ubicaciones físicas: seed + asignación + integración con conteo
-- ============================================================================
-- Contexto:
-- - La tabla `ubicaciones` ya existe (creada en una migración anterior) y está
--   vacía. `inventario.ubicacion_id` también existe, todo en null.
-- - Layout real de BODEGA (dado por el dueño): rectángulo, entrada por el lado
--   corto. Stands en U: desde la puerta a la derecha ST9→ST8→ST7→ST6 (hacia el
--   fondo); FONDO solo ST5; izquierda del fondo hacia la puerta ST4→ST3→ST2→ST1
--   (ST1 y ST9 flanquean la puerta). Cada stand tiene 4 posiciones de altura:
--   P1 la más baja (~½ m), P2, P3, P4 la más alta. La zona central dentro de la
--   U es "PISO" (sin posiciones, carga pesada).
-- - CV/CHV/L3 no tienen ubicaciones claras: solo 3 zonas relativas
--   ENTRADA/MEDIO/FONDO.
-- - `prioridad_picking` ordena el recorrido físico: menor = se visita antes.
--   En BODEGA = distancia_a_la_puerta*10 + altura (P2 es la altura más
--   cómoda, luego P3, luego P1 -altura baja pero hay que agacharse-, P4 la
--   más incómoda por ser la más alta).
--
-- Este bloque agrega:
--   1) Seed de ubicaciones (36 BODEGA + 1 PISO + 9 CV/CHV/L3).
--   2) RLS de solo lectura en ubicaciones para cualquier authenticated.
--   3) fn_asignar_ubicacion — asigna/quita la ubicación de un producto en una
--      sede (Admin/Bodeguero).
--   4) fn_cola_conteo_hoy (replace, misma firma + columna ubicacion_id) —
--      ahora ordena también por prioridad_picking para seguir el recorrido
--      físico de la bodega.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Seed de ubicaciones
-- ----------------------------------------------------------------------------

-- BODEGA: 9 stands × 4 posiciones = 36 ubicaciones.
-- distancia: ST1=1, ST9=1, ST2=2, ST8=2, ST3=3, ST7=3, ST4=4, ST6=4, ST5=5
-- altura:    P2=1, P3=2, P1=3, P4=4
insert into public.ubicaciones (id, sede_id, pasillo, estante, nivel, descripcion, activa, prioridad_picking)
select
  'ST' || s || '-P' || p as id,
  'BODEGA' as sede_id,
  null as pasillo,
  'ST' || s as estante,
  'P' || p as nivel,
  'Stand ' || s || ' · posición ' || p as descripcion,
  true as activa,
  (case s
     when 1 then 1
     when 9 then 1
     when 2 then 2
     when 8 then 2
     when 3 then 3
     when 7 then 3
     when 4 then 4
     when 6 then 4
     when 5 then 5
   end) * 10
  + (case p
      when 2 then 1
      when 3 then 2
      when 1 then 3
      when 4 then 4
    end) as prioridad_picking
from generate_series(1, 9) as s
cross join generate_series(1, 4) as p
on conflict (id) do nothing;

-- BODEGA: zona central de piso (carga pesada, sin posiciones de altura).
insert into public.ubicaciones (id, sede_id, pasillo, estante, nivel, descripcion, activa, prioridad_picking)
values (
  'PISO', 'BODEGA', null, 'PISO', null,
  'Zona central de piso (carga pesada)', true, 60
)
on conflict (id) do nothing;

-- CV/CHV/L3: 3 zonas relativas por sede (sin stands ni posiciones).
insert into public.ubicaciones (id, sede_id, pasillo, estante, nivel, descripcion, activa, prioridad_picking)
select
  sede || '-' || zona.nombre as id,
  sede as sede_id,
  null as pasillo,
  zona.nombre as estante,
  null as nivel,
  'Zona ' || initcap(lower(zona.nombre)) || ' de la sede' as descripcion,
  true as activa,
  zona.prioridad as prioridad_picking
from unnest(array['CV', 'CHV', 'L3']) as sede
cross join (
  values ('ENTRADA', 1), ('MEDIO', 2), ('FONDO', 3)
) as zona(nombre, prioridad)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2) RLS — solo lectura para cualquier usuario autenticado. Sin escritura vía
--    RLS: el seed es fijo y cambios futuros van por migración.
-- ----------------------------------------------------------------------------
alter table public.ubicaciones enable row level security;

drop policy if exists ubicaciones_select on public.ubicaciones;
create policy ubicaciones_select on public.ubicaciones
  for select to authenticated
  using (true);

-- ----------------------------------------------------------------------------
-- 3) fn_asignar_ubicacion — Admin/Bodeguero asignan o quitan la ubicación de
--    un producto en una sede.
-- ----------------------------------------------------------------------------
create or replace function public.fn_asignar_ubicacion(
  p_producto_id uuid,
  p_sede_id text,
  p_ubicacion_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rol text;
  v_ubic_sede text;
  v_filas integer;
begin
  select rol::text into v_rol from usuarios where id = auth.uid();
  if v_rol not in ('Admin', 'Bodeguero') then
    raise exception 'Solo Admin o Bodeguero pueden asignar ubicaciones';
  end if;

  if p_ubicacion_id is not null then
    select sede_id into v_ubic_sede
      from public.ubicaciones
     where id = p_ubicacion_id and activa = true;

    if not found then
      raise exception 'La ubicación % no existe o no está activa', p_ubicacion_id;
    end if;

    if v_ubic_sede is distinct from p_sede_id then
      raise exception 'La ubicación % no pertenece a la sede %', p_ubicacion_id, p_sede_id;
    end if;
  end if;

  update public.inventario
     set ubicacion_id = p_ubicacion_id
   where producto_id = p_producto_id
     and sede_id = p_sede_id;

  get diagnostics v_filas = row_count;

  if v_filas = 0 then
    raise exception 'El producto no tiene inventario en la sede %', p_sede_id;
  end if;

  return jsonb_build_object('ok', true, 'ubicacion_id', p_ubicacion_id);
end;
$function$;

revoke execute on function public.fn_asignar_ubicacion(uuid, text, text) from anon;

-- ----------------------------------------------------------------------------
-- 4) fn_cola_conteo_hoy (replace) — misma firma + columna ubicacion_id al
--    final; el orden ahora sigue el recorrido físico (atrasados primero,
--    luego prioridad_picking, luego referencia).
--    Nota: agregar una columna al RETURNS TABLE exige DROP previo (Postgres
--    no permite cambiar el tipo de retorno con create or replace).
-- ----------------------------------------------------------------------------
drop function if exists public.fn_cola_conteo_hoy(text);

create or replace function public.fn_cola_conteo_hoy(p_sede_id text default null)
returns table(
  item_id uuid,
  producto_id uuid,
  referencia text,
  nombre text,
  clasificacion text,
  vendible boolean,
  semana_objetivo integer,
  atrasado boolean,
  stock_sistema integer,
  ubicacion_id text
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_mi_sede text;
  v_sede text;
  v_plan record;
  v_semana_actual integer;
begin
  if v_uid is null then raise exception 'no_session'; end if;
  select rol::text, sede_id into v_rol, v_mi_sede from usuarios where id = v_uid;
  if v_rol not in ('Admin', 'Bodeguero') then
    raise exception 'Solo Admin o Bodeguero pueden ver la cola de conteo';
  end if;

  -- Un no-Admin siempre ve su propia sede, sin importar lo que pida.
  if v_rol = 'Admin' then
    v_sede := coalesce(nullif(trim(p_sede_id), ''), v_mi_sede);
  else
    v_sede := v_mi_sede;
  end if;
  if v_sede is null then
    return; -- sin sede no hay cola posible
  end if;

  select pc.id as plan_id, pc.fecha_inicio,
    case when pc.horizonte_dias = 30 then 4 else 13 end as semanas_totales
    into v_plan
  from public.plan_conteo pc
  where pc.sede_id = v_sede and pc.activo = true;

  if not found then
    return; -- sin plan activo, cola vacía
  end if;

  v_semana_actual := least(
    floor((current_date - v_plan.fecha_inicio) / 7)::int + 1,
    v_plan.semanas_totales
  );
  v_semana_actual := greatest(v_semana_actual, 1);

  return query
  select
    pci.id as item_id,
    p.id as producto_id,
    p.referencia,
    p.nombre,
    p.clasificacion::text,
    p.vendible,
    pci.semana_objetivo,
    (pci.semana_objetivo < v_semana_actual) as atrasado,
    coalesce(
      (case when p.vendible then i.cantidad else i.cantidad_insumo end), 0
    ) as stock_sistema,
    i.ubicacion_id
  from public.plan_conteo_items pci
  join productos p on p.id = pci.producto_id
  left join inventario i on i.producto_id = p.id and i.sede_id = pci.sede_id
  left join public.ubicaciones u on u.id = i.ubicacion_id
  where pci.plan_id = v_plan.plan_id
    and pci.contado_en is null
    and pci.semana_objetivo <= v_semana_actual
  order by
    (pci.semana_objetivo < v_semana_actual) desc,
    u.prioridad_picking asc nulls last,
    p.referencia asc;
end;
$function$;

revoke execute on function public.fn_cola_conteo_hoy(text) from anon;
