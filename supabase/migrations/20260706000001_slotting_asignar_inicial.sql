-- ============================================================================
-- Slotting — sugerir ubicación inicial también para productos SIN ubicación
-- ============================================================================
-- Contexto: con ~3.000 productos activos, pedirle al Admin/Bodeguero que
-- asigne ubicación producto por producto ANTES de que Slotting pueda opinar
-- es inviable ("son muchos ítems, no le van a cambiar el espacio a cada
-- cosa"). Este cambio agrega una tercera categoría de sugerencia: para
-- productos que HOY no tienen ubicación (`inventario.ubicacion_id is null`)
-- pero sí tuvieron demanda en los últimos 90 días, se sugiere una ubicación
-- inicial según qué tanto rotan, sin exigir que ya tengan una.
--
-- Se deja fuera de este universo a los productos sin demanda en 90 días:
-- physically no importa mucho dónde quede algo que no se mueve, y agregarlos
-- multiplicaría la lista por ~5 sin aportar valor real (876 vs 4 con demanda
-- en BODEGA, por ejemplo). El Admin puede seguir asignando ubicación manual
-- a esos desde la ficha del producto si quiere.
--
-- Cambios en el contrato de `fn_slotting_sugerencias`:
--   - Se agrega la columna `accion` ('asignar' | 'subir' | 'bajar') para que
--     el frontend distinga el tipo de sugerencia sin parsear el texto de
--     `motivo`.
--   - `ubicacion_actual` / `prioridad_actual` pueden venir NULL en filas
--     `accion = 'asignar'` (el producto no tiene ubicación todavía).
--   - La lógica de reubicación de productos YA ubicados (subir/bajar) NO
--     cambia: mismo cálculo, mismos umbrales, ya verificado en Bloque D2.
--
-- Tres franjas por sede para "asignar" (basadas en percent_rank de demanda
-- 90d, solo entre los productos sin ubicación con demanda > 0):
--   - top 34%  → ubicación "mejor" (misma que usa 'subir': ST1-P2 / ENTRADA)
--   - 34%-67%  → ubicación "media" (nueva: ST3-P2 / MEDIO)
--   - resto    → ubicación "peor" (misma que usa 'bajar': ST5-P4 / FONDO)
-- ============================================================================

drop function if exists public.fn_slotting_sugerencias();

create or replace function public.fn_slotting_sugerencias()
returns table(
  producto_id uuid,
  referencia text,
  nombre text,
  sede_id text,
  demanda_90d bigint,
  ubicacion_actual text,
  prioridad_actual int,
  ubicacion_sugerida text,
  prioridad_sugerida int,
  accion text,
  motivo text
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rol text;
begin
  select rol::text into v_rol from usuarios where id = auth.uid();
  if v_rol not in ('Admin', 'Bodeguero') then
    raise exception 'Solo Admin o Bodeguero pueden ver las sugerencias de slotting';
  end if;

  return query
  with demanda as (
    select
      m.producto_id as p_id,
      m.sede_id as s_id,
      sum(abs(m.cantidad)) as total
    from movimientos m
    where m.tipo in ('venta', 'orden_consumo', 'ensamble_consumo')
      and m.fecha >= now() - interval '90 days'
    group by m.producto_id, m.sede_id
  ),

  -- ── Reubicación de productos YA ubicados (sin cambios vs Bloque D2) ─────
  universo_ubicado as (
    select
      p.id as producto_id,
      p.referencia,
      p.nombre,
      i.sede_id,
      i.ubicacion_id as ubicacion_actual,
      u.prioridad_picking as prioridad_actual,
      coalesce(d.total, 0) as demanda_90d,
      case
        when i.sede_id = 'BODEGA' then u.prioridad_picking > 22
        else split_part(i.ubicacion_id, '-', 2) <> 'ENTRADA'
      end as lejos_de_puerta,
      case
        when i.sede_id = 'BODEGA' then u.prioridad_picking <= 22
        else split_part(i.ubicacion_id, '-', 2) = 'ENTRADA'
      end as zona_premium,
      case
        when i.sede_id = 'BODEGA' then 'ST1-P2'
        else i.sede_id || '-ENTRADA'
      end as mejor_ubicacion,
      case
        when i.sede_id = 'BODEGA' then 'ST5-P4'
        else i.sede_id || '-FONDO'
      end as peor_ubicacion
    from inventario i
    join productos p on p.id = i.producto_id and p.activo = true
    join ubicaciones u on u.id = i.ubicacion_id
    left join demanda d on d.p_id = i.producto_id and d.s_id = i.sede_id
    where i.ubicacion_id is not null
  ),
  rankeado_ubicado as (
    select
      un.*,
      percent_rank() over (
        partition by un.sede_id order by un.demanda_90d desc
      ) as pct_rank
    from universo_ubicado un
  ),
  reubicar as (
    select
      r.producto_id, r.referencia, r.nombre, r.sede_id, r.demanda_90d,
      r.ubicacion_actual, r.prioridad_actual,
      sug.ubicacion_sugerida, sug.accion, sug.motivo
    from rankeado_ubicado r
    cross join lateral (
      select
        case
          when r.demanda_90d > 0 and r.pct_rank <= 0.25 and r.lejos_de_puerta and r.ubicacion_actual <> r.mejor_ubicacion
            then r.mejor_ubicacion
          when r.demanda_90d = 0 and r.zona_premium and r.ubicacion_actual <> r.peor_ubicacion
            then r.peor_ubicacion
          else null
        end as ubicacion_sugerida,
        case
          when r.demanda_90d > 0 and r.pct_rank <= 0.25 and r.lejos_de_puerta and r.ubicacion_actual <> r.mejor_ubicacion
            then 'subir'
          when r.demanda_90d = 0 and r.zona_premium and r.ubicacion_actual <> r.peor_ubicacion
            then 'bajar'
          else null
        end as accion,
        case
          when r.demanda_90d > 0 and r.pct_rank <= 0.25 and r.lejos_de_puerta and r.ubicacion_actual <> r.mejor_ubicacion
            then 'Alta rotación lejos de la puerta: acercarla agiliza el picking'
          when r.demanda_90d = 0 and r.zona_premium and r.ubicacion_actual <> r.peor_ubicacion
            then 'Sin rotación en 90 días ocupando una zona premium'
          else null
        end as motivo
    ) sug
    where sug.ubicacion_sugerida is not null
  ),

  -- ── Asignación inicial de productos SIN ubicación (nuevo) ───────────────
  universo_sin_ubicar as (
    select
      p.id as producto_id,
      p.referencia,
      p.nombre,
      i.sede_id,
      coalesce(d.total, 0) as demanda_90d,
      case when i.sede_id = 'BODEGA' then 'ST1-P2' else i.sede_id || '-ENTRADA' end as mejor_ubicacion,
      case when i.sede_id = 'BODEGA' then 'ST3-P2' else i.sede_id || '-MEDIO' end as media_ubicacion,
      case when i.sede_id = 'BODEGA' then 'ST5-P4' else i.sede_id || '-FONDO' end as peor_ubicacion
    from inventario i
    join productos p on p.id = i.producto_id and p.activo = true
    left join demanda d on d.p_id = i.producto_id and d.s_id = i.sede_id
    where i.ubicacion_id is null
      and coalesce(d.total, 0) > 0
  ),
  rankeado_sin_ubicar as (
    select
      un.*,
      percent_rank() over (
        partition by un.sede_id order by un.demanda_90d desc
      ) as pct_rank
    from universo_sin_ubicar un
  ),
  asignar as (
    select
      r.producto_id, r.referencia, r.nombre, r.sede_id, r.demanda_90d,
      null::text as ubicacion_actual,
      null::int as prioridad_actual,
      case
        when r.pct_rank <= 0.34 then r.mejor_ubicacion
        when r.pct_rank <= 0.67 then r.media_ubicacion
        else r.peor_ubicacion
      end as ubicacion_sugerida,
      'asignar'::text as accion,
      case
        when r.pct_rank <= 0.34 then 'Alta rotación sin ubicación: asignar cerca de la puerta'
        when r.pct_rank <= 0.67 then 'Rotación media sin ubicación: asignar en zona intermedia'
        else 'Rotación baja sin ubicación: asignar en zona de fondo'
      end as motivo
    from rankeado_sin_ubicar r
  ),

  -- Nota: las columnas se califican con el alias de tabla (reubicar./asignar.)
  -- porque sin calificar chocan con los parámetros OUT de la función
  -- (RETURNS TABLE los expone como variables plpgsql del mismo nombre) y
  -- Postgres los reporta como referencia ambigua (42702).
  combinado as (
    select reubicar.producto_id, reubicar.referencia, reubicar.nombre, reubicar.sede_id, reubicar.demanda_90d,
           reubicar.ubicacion_actual, reubicar.prioridad_actual, reubicar.ubicacion_sugerida, reubicar.accion, reubicar.motivo
    from reubicar
    union all
    select asignar.producto_id, asignar.referencia, asignar.nombre, asignar.sede_id, asignar.demanda_90d,
           asignar.ubicacion_actual, asignar.prioridad_actual, asignar.ubicacion_sugerida, asignar.accion, asignar.motivo
    from asignar
  )

  select
    x.producto_id, x.referencia, x.nombre, x.sede_id, x.demanda_90d,
    x.ubicacion_actual, x.prioridad_actual,
    x.ubicacion_sugerida, uo.prioridad_picking as prioridad_sugerida,
    x.accion, x.motivo
  from combinado x
  join ubicaciones uo on uo.id = x.ubicacion_sugerida
  order by x.sede_id asc, x.demanda_90d desc;
end;
$function$;

revoke execute on function public.fn_slotting_sugerencias() from public, anon;
grant execute on function public.fn_slotting_sugerencias() to authenticated;

-- ----------------------------------------------------------------------------
-- fn_aplicar_slotting_lote — aplicar varias sugerencias de una vez (batch).
-- Con potencialmente cientos de sugerencias por sede (ver universo arriba),
-- pedirle al Admin/Bodeguero que aplique una por una es poco práctico. Cada
-- ítem se aplica llamando a fn_asignar_ubicacion (misma validación de rol,
-- sede y existencia de inventario ya probada) — si un ítem falla, toda la
-- función aborta (mismo criterio ya usado en fn_aplicar_minmax).
-- ----------------------------------------------------------------------------
create or replace function public.fn_aplicar_slotting_lote(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_item jsonb;
  v_aplicados integer := 0;
begin
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    perform public.fn_asignar_ubicacion(
      (v_item->>'producto_id')::uuid,
      v_item->>'sede_id',
      v_item->>'ubicacion_id'
    );
    v_aplicados := v_aplicados + 1;
  end loop;

  return jsonb_build_object('ok', true, 'aplicados', v_aplicados);
end;
$function$;

revoke execute on function public.fn_aplicar_slotting_lote(jsonb) from public, anon;
grant execute on function public.fn_aplicar_slotting_lote(jsonb) to authenticated;
