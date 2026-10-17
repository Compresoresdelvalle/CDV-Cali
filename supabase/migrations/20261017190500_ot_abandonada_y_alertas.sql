-- Bloque 5 + arreglo 1.4: OT abandonada y alertas de equipos que nadie recoge.
--
-- "abandonada" es un estado FINAL como entregada y cancelada, pero:
--   * sus abonos siguen en el cierre (_fn_cierre_totales solo excluye 'cancelada');
--   * solo lo pone el Admin, con motivo, desde fn_marcar_ot_abandonada;
--   * el equipo se puede seguir moviendo de sede (para llevarlo a bodega o a
--     chatarra), y se puede generar un producto de segunda con él.

-- ── Transiciones ──────────────────────────────────────────────────────────
create or replace function public.trg_orden_validar_transicion()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if OLD.estado = NEW.estado then return NEW; end if;
  if coalesce(current_setting('cdv.anulando_venta', true), 'off') = 'on' then return NEW; end if;
  if NEW.estado = 'entregada' and OLD.estado is distinct from 'entregada'
     and coalesce(current_setting('cdv.entregando_ot', true), 'off') <> 'on' then
    raise exception 'La entrega solo se hace desde "Convertir a venta y entregar".';
  end if;
  if NEW.estado = 'abandonada'
     and coalesce(current_setting('cdv.marcando_abandonada', true), 'off') <> 'on' then
    raise exception 'Una OT se marca como abandonada solo desde "Marcar abandonada" (Administración).';
  end if;
  if OLD.estado in ('entregada','cancelada','abandonada') then
    raise exception 'La OT % es inmutable (estado %)', OLD.numero, OLD.estado;
  end if;
  if NEW.estado in ('cancelada','abandonada') then return NEW; end if;
  if not (
       (OLD.estado='recepcion'          and NEW.estado='diagnostico')
    or (OLD.estado='diagnostico'        and NEW.estado='cotizada')
    or (OLD.estado='cotizada'           and NEW.estado='autorizada')
    or (OLD.estado='autorizada'         and NEW.estado='en_proceso')
    or (OLD.estado='en_proceso'         and NEW.estado in ('esperando_repuesto','terminada'))
    or (OLD.estado='esperando_repuesto' and NEW.estado in ('en_proceso','terminada'))
    or (OLD.estado='terminada'          and NEW.estado='entregada')
    or (OLD.estado='abierta'            and NEW.estado in ('en_proceso','esperando_repuesto','completada','diagnostico'))
    or (OLD.estado='en_proceso'         and NEW.estado='completada')
    or (OLD.estado='esperando_repuesto' and NEW.estado='completada')
    or (OLD.estado='completada'         and NEW.estado in ('pendiente_recogida','entregada'))
    or (OLD.estado='pendiente_recogida' and NEW.estado='entregada')
  ) then
    raise exception 'Transición no permitida: % -> %', OLD.estado, NEW.estado;
  end if;
  if NEW.estado='cotizada' and coalesce(NEW.diagnostico,'')='' then
    raise exception 'Falta el diagnóstico para cotizar';
  end if;
  if NEW.estado='en_proceso' and OLD.estado='autorizada' then
    if coalesce(NEW.estado_autorizacion,'') = 'no_autorizado' then
      if coalesce(NEW.valor_revision,0) <= 0 then
        raise exception 'Indica el valor a cobrar por la revisión';
      end if;
    elsif coalesce(NEW.estado_autorizacion,'') = 'autorizado' then
      if jsonb_array_length(coalesce(NEW.cotizacion_draft,'[]'::jsonb))=0
         and coalesce(NEW.costo_mano_obra,0)=0 and coalesce(NEW.valor_repuestos,0)=0 then
        raise exception 'Agrega al menos un repuesto o mano de obra para la reparación autorizada';
      end if;
    else
      raise exception 'Marca si el cliente autoriza o no la reparación';
    end if;
  end if;
  if NEW.estado='terminada' and coalesce(NEW.trabajo_realizado,'')='' then
    raise exception 'Falta registrar el trabajo realizado para terminar';
  end if;
  if NEW.estado='pendiente_recogida' and OLD.estado<>'pendiente_recogida' then
    NEW.pendiente_recogida_at := now();
  end if;
  return NEW;
end $function$;


-- ── Marcar abandonada ─────────────────────────────────────────────────────
create or replace function public.fn_marcar_ot_abandonada(
  p_orden_id    uuid,
  p_motivo      text,
  p_sede_equipo text default null   -- dónde queda el equipo; null = donde está
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_o   record;
  v_total_antes numeric;
  v_total_despues numeric;
  v_motivo text := nullif(trim(coalesce(p_motivo,'')), '');
  v_abonos numeric;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  if (select get_my_rol()) is distinct from 'Admin' then
    raise exception 'Solo el administrador puede marcar una OT como abandonada.';
  end if;
  if v_motivo is null or length(v_motivo) < 5 then
    raise exception 'Escribe por qué queda abandonada (por ejemplo: "el cliente no contesta, va para chatarra").';
  end if;

  select * into v_o from ordenes_servicio where id = p_orden_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if v_o.estado in ('entregada','cancelada','abandonada') then
    raise exception 'La OT #% ya está cerrada (%). No se puede marcar como abandonada.', v_o.numero, v_o.estado;
  end if;

  -- Primero mover el equipo, si se pidió, con la misma función de la pantalla.
  if p_sede_equipo is not null
     and p_sede_equipo is distinct from coalesce(v_o.sede_equipo_id, v_o.sede_id) then
    perform fn_mover_equipo_orden(p_orden_id, p_sede_equipo, v_motivo);
  end if;

  select total into v_total_antes from ordenes_servicio where id = p_orden_id;

  perform set_config('cdv.marcando_abandonada', 'on', true);
  update ordenes_servicio
     set estado = 'abandonada',
         observaciones = trim(both E'\n' from coalesce(observaciones,'') || E'\n' ||
           '[' || to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD') || '] Equipo abandonado: ' || v_motivo)
   where id = p_orden_id
   returning total into v_total_despues;
  perform set_config('cdv.marcando_abandonada', 'off', true);

  -- trg_orden_recalcular_total_mo se dispara en cualquier update: si cambiara
  -- el total, la plata de la OT quedaría distinta de lo cobrado. Se aborta.
  if v_total_despues is distinct from v_total_antes then
    raise exception 'Al cerrar la OT el total cambiaría de % a %. No se hizo nada; revisa la OT.', v_total_antes, v_total_despues;
  end if;

  select coalesce(sum(monto),0) into v_abonos from abonos where orden_id = p_orden_id;
  return jsonb_build_object('orden_id', p_orden_id, 'numero', v_o.numero, 'estado', 'abandonada',
    'abonos_que_siguen_en_cierre', v_abonos);
end $function$;

revoke all on function public.fn_marcar_ot_abandonada(uuid, text, text) from public, anon;
grant execute on function public.fn_marcar_ot_abandonada(uuid, text, text) to authenticated, service_role;


-- ── Funciones que cuentan "abiertas" o aceptan estados ────────────────────
-- Se cambia solo el texto exacto, y se exige que aparezca una vez, para no
-- reescribir funciones largas a mano.
do $$
declare
  v_def text;
  v_n   int;
begin
  -- KPI de OT abiertas: una abandonada ya no está abierta.
  v_def := pg_get_functiondef('public.fn_dashboard_kpis'::regproc);
  v_n := (length(v_def) - length(replace(v_def, $q$estado not in ('entregada','cancelada')$q$, ''))) / length($q$estado not in ('entregada','cancelada')$q$);
  if v_n <> 1 then raise exception 'fn_dashboard_kpis: se esperaba 1 coincidencia y hay %', v_n; end if;
  execute replace(v_def, $q$estado not in ('entregada','cancelada')$q$, $q$estado not in ('entregada','cancelada','abandonada')$q$);

  -- Producto de segunda: también desde un equipo abandonado.
  v_def := pg_get_functiondef('public.fn_generar_producto_segunda_ot'::regproc);
  v_n := (length(v_def) - length(replace(v_def, $q$('terminada', 'completada', 'pendiente_recogida', 'entregada')$q$, ''))) / length($q$('terminada', 'completada', 'pendiente_recogida', 'entregada')$q$);
  if v_n <> 1 then raise exception 'fn_generar_producto_segunda_ot: se esperaba 1 coincidencia y hay %', v_n; end if;
  execute replace(v_def, $q$('terminada', 'completada', 'pendiente_recogida', 'entregada')$q$,
                         $q$('terminada', 'completada', 'pendiente_recogida', 'entregada', 'abandonada')$q$);
end $$;


-- ── 1.4 Alertas: equipos esperando al cliente ─────────────────────────────
-- La vista miraba solo 'completada', que no se usa desde el rediseño de OT, y
-- siempre daba 0. Ahora mira las OT con el trabajo hecho o no autorizadas
-- (el equipo está esperando que lo recojan) y cuenta los días sin movimiento.
-- create or replace conserva columnas, permisos y opciones; las nuevas van al final.
create or replace view public.v_ot_alertas_30_dias
with (security_invoker = true) as
select o.id,
    o.numero,
    o.fecha,
    o.cliente_nombre,
    o.cliente_telefono,
    o.equipo_descripcion,
    o.equipo_serie,
    o.diagnostico,
    o.trabajo_realizado,
    o.tecnico_id,
    o.sede_id,
    o.estado,
    o.costo_mano_obra,
    o.costo_repuestos,
    o.total,
    o.fecha_entrega,
    o.observaciones,
    o.created_at,
    o.updated_at,
    o.estado_autorizacion,
    o.valor_revision,
    o.fecha_alerta_30_dias,
    o.pendiente_recogida_at,
    true as supera_30_dias,
    fn_total_abonos_ot(o.id) as total_abonado,
    ((now() at time zone 'America/Bogota')::date
      - (coalesce(o.pendiente_recogida_at, o.updated_at, o.fecha) at time zone 'America/Bogota')::date) as dias_sin_movimiento,
    case
      when o.estado in ('terminada','completada','pendiente_recogida') then 'Listo y sin recoger'
      else 'No autorizado, sin recoger'
    end as motivo_alerta,
    coalesce(o.sede_equipo_id, o.sede_id) as sede_equipo
  from ordenes_servicio o
 where (
         o.estado in ('terminada','completada','pendiente_recogida')
      or (coalesce(o.estado_autorizacion,'') = 'no_autorizado'
          and o.estado not in ('entregada','cancelada','abandonada'))
       )
   and coalesce(o.pendiente_recogida_at, o.updated_at, o.fecha)
       < now() - make_interval(days => coalesce((fn_get_parametro('dias_alerta_ot_abandonada'))::integer, 30));

revoke all on public.v_ot_alertas_30_dias from anon, public;
revoke insert, update, delete, truncate, references, trigger on public.v_ot_alertas_30_dias from authenticated;
grant select on public.v_ot_alertas_30_dias to authenticated;
grant all on public.v_ot_alertas_30_dias to service_role;
alter view public.v_ot_alertas_30_dias set (security_invoker = true);

notify pgrst, 'reload schema';
