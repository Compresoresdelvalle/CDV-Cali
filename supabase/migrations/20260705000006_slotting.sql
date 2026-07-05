-- ============================================================================
-- Bloque D2 — Slotting: sugerencias de reubicación por rotación (demanda 90d)
-- ============================================================================
-- Contexto:
-- - D1 dejó `ubicaciones` seedeada + `inventario.ubicacion_id` asignable vía
--   `fn_asignar_ubicacion`. Este bloque agrega una función de análisis que
--   compara la rotación real (demanda 90 días) de cada producto contra su
--   puesto físico actual y sugiere reubicaciones para acercar lo que más
--   rota a la puerta (menor `prioridad_picking`) y sacar lo que no rota de
--   las zonas premium.
-- - `movimientos` NO tiene policy de lectura general para Admin/Bodeguero
--   (es append-only y sensible), así que en vez de una vista con
--   `security_invoker` se usa una FUNCIÓN `security definer` — mismo patrón
--   ya usado en `fn_sugerir_minmax` y `fn_cola_conteo_hoy` — que valida el
--   rol internamente y no depende de RLS de movimientos para el invoker.
--
-- Reglas de sugerencia (por sede):
--   a) SUBIR — demanda en el top 25% de su sede (percent_rank <= 0.25) y el
--      puesto actual está lejos de la puerta (BODEGA: prioridad_actual > 22;
--      otras sedes: zona <> 'ENTRADA') → sugiere la ubicación de menor
--      prioridad de la sede (BODEGA: 'ST1-P2'; otras: '{SEDE}-ENTRADA').
--   b) BAJAR — demanda 0 en 90 días y el puesto actual es premium (BODEGA:
--      prioridad_actual <= 22; otras: zona = 'ENTRADA') → sugiere la
--      ubicación de mayor prioridad (BODEGA: 'ST5-P4'; otras: '{SEDE}-FONDO').
--
-- Universo: filas de `inventario` con `ubicacion_id` no nulo y producto
-- activo (si no tiene ubicación asignada no hay nada que "reubicar").
-- ============================================================================

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
    -- Demanda 90d por producto + sede (ventas, consumo de OT, consumo de
    -- ensambles). Las salidas se registran con cantidad NEGATIVA.
    select
      m.producto_id as p_id,
      m.sede_id as s_id,
      sum(abs(m.cantidad)) as total
    from movimientos m
    where m.tipo in ('venta', 'orden_consumo', 'ensamble_consumo')
      and m.fecha >= now() - interval '90 days'
    group by m.producto_id, m.sede_id
  ),
  universo as (
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
  rankeado as (
    select
      un.*,
      percent_rank() over (
        partition by un.sede_id order by un.demanda_90d desc
      ) as pct_rank
    from universo un
  )
  select
    r.producto_id,
    r.referencia,
    r.nombre,
    r.sede_id,
    r.demanda_90d,
    r.ubicacion_actual,
    r.prioridad_actual,
    sug.ubicacion_sugerida,
    uo.prioridad_picking as prioridad_sugerida,
    sug.motivo
  from rankeado r
  cross join lateral (
    select
      case
        -- demanda_90d > 0 evita el caso borde: si toda la sede tiene demanda 0,
        -- percent_rank marca todo como "top" y sugeriría subir sin rotación.
        when r.demanda_90d > 0 and r.pct_rank <= 0.25 and r.lejos_de_puerta and r.ubicacion_actual <> r.mejor_ubicacion
          then r.mejor_ubicacion
        when r.demanda_90d = 0 and r.zona_premium and r.ubicacion_actual <> r.peor_ubicacion
          then r.peor_ubicacion
        else null
      end as ubicacion_sugerida,
      case
        when r.demanda_90d > 0 and r.pct_rank <= 0.25 and r.lejos_de_puerta and r.ubicacion_actual <> r.mejor_ubicacion
          then 'Alta rotación lejos de la puerta: acercarla agiliza el picking'
        when r.demanda_90d = 0 and r.zona_premium and r.ubicacion_actual <> r.peor_ubicacion
          then 'Sin rotación en 90 días ocupando una zona premium'
        else null
      end as motivo
  ) sug
  join ubicaciones uo on uo.id = sug.ubicacion_sugerida
  where sug.ubicacion_sugerida is not null
  order by r.sede_id asc, r.demanda_90d desc;
end;
$function$;

revoke execute on function public.fn_slotting_sugerencias() from anon;
