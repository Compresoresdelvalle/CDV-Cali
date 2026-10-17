-- Revisión integral del 2026-10-17: correcciones a lo construido ese día.
-- Cada cambio sobre una función existente reemplaza un texto exacto y exige
-- que aparezca una sola vez, para no reescribir funciones largas a mano.

create or replace function pg_temp._rep(p_fn regprocedure, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_n int;
begin
  v_def := pg_get_functiondef(p_fn);
  v_n := (length(v_def) - length(replace(v_def, p_old, ''))) / greatest(length(p_old), 1);
  if v_n <> 1 then
    raise exception '%: se esperaba 1 coincidencia de [%] y hay %', p_fn, left(p_old, 80), v_n;
  end if;
  execute replace(v_def, p_old, p_new);
end $$;


-- ═══ 1. OT abandonada: el servidor la trata como cerrada ═════════════════

-- 1a. No se edita por la API (la pantalla ya la bloqueaba).
alter policy os_update on public.ordenes_servicio
  using ((estado <> all (array['entregada'::estado_orden, 'cancelada'::estado_orden, 'abandonada'::estado_orden]))
     and ((select get_my_rol()) = any (array['Admin'::text, 'Vendedor'::text]))
     and (((select get_my_rol()) = 'Admin'::text) or (sede_id = (select get_my_sede_id()))));

select pg_temp._rep('public.trg_orden_recalcular_total_mo()'::regprocedure,
  $q$if TG_OP = 'UPDATE' and OLD.estado in ('entregada','cancelada') and not v_anulando then$q$,
  $q$if TG_OP = 'UPDATE' and OLD.estado in ('entregada','cancelada','abandonada') and not v_anulando then$q$);

-- 1b. Ni repuestos ni abonos sobre una OT cerrada.
alter policy do_write on public.detalle_orden
  using (exists (select 1 from ordenes_servicio o
                  where o.id = detalle_orden.orden_id
                    and o.estado <> all (array['entregada'::estado_orden, 'cancelada'::estado_orden, 'abandonada'::estado_orden])
                    and (((select get_my_rol()) = 'Admin'::text) or (o.sede_id = (select get_my_sede_id())))))
  with check (exists (select 1 from ordenes_servicio o
                  where o.id = detalle_orden.orden_id
                    and o.estado <> all (array['entregada'::estado_orden, 'cancelada'::estado_orden, 'abandonada'::estado_orden])
                    and (((select get_my_rol()) = 'Admin'::text) or (o.sede_id = (select get_my_sede_id())))));

-- Los triggers de stock corren también desde funciones SECURITY DEFINER, que
-- se saltan la RLS: el freno va también aquí (salvo la anulación controlada).
select pg_temp._rep('public.trg_orden_consumir_repuesto()'::regprocedure,
  $q$  select tecnico_id, sede_id into v_orden from ordenes_servicio where id = NEW.orden_id;
$q$,
  $q$  select tecnico_id, sede_id, estado into v_orden from ordenes_servicio where id = NEW.orden_id;
  if v_orden.estado in ('entregada','cancelada','abandonada')
     and coalesce(current_setting('cdv.anulando_venta', true), 'off') <> 'on' then
    raise exception 'La OT está % y ya no admite repuestos.', v_orden.estado;
  end if;
$q$);

select pg_temp._rep('public.trg_orden_revertir_repuesto()'::regprocedure,
  $q$  SELECT tecnico_id, sede_id INTO v_orden FROM ordenes_servicio WHERE id = OLD.orden_id;
$q$,
  $q$  SELECT tecnico_id, sede_id, estado INTO v_orden FROM ordenes_servicio WHERE id = OLD.orden_id;
  -- Una cancelada sí se limpia (fn_cancelar_orden borra su detalle); una
  -- abandonada o entregada no se toca, salvo en una anulación controlada.
  IF v_orden.estado IN ('entregada','abandonada')
     AND coalesce(current_setting('cdv.anulando_venta', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'La OT está % y sus repuestos ya no se pueden quitar.', v_orden.estado;
  END IF;
$q$);

alter policy abonos_insert on public.abonos
  with check ((registrado_por = auth.uid())
    and (get_my_rol() = any (array['Admin'::text, 'Vendedor'::text]))
    and (exists (select 1 from ordenes_servicio o
                  where o.id = abonos.orden_id
                    and ((get_my_rol() = 'Admin'::text) or (o.sede_id = get_my_sede_id()))
                    and (o.estado <> all (array['entregada'::estado_orden, 'cancelada'::estado_orden, 'abandonada'::estado_orden])))));

-- Recibos: el abono automático se salta la RLS (SECURITY DEFINER).
select pg_temp._rep('public.fn_registrar_recibo(jsonb)'::regprocedure,
  $q$  IF v_orden_id IS NOT NULL AND v_monto_pagado > 0 AND v_crear_abono THEN$q$,
  $q$  IF v_orden_id IS NOT NULL AND v_monto_pagado > 0 AND v_crear_abono
     AND EXISTS (SELECT 1 FROM ordenes_servicio
                  WHERE id = v_orden_id AND estado IN ('entregada','cancelada','abandonada')) THEN
    RAISE EXCEPTION 'La OT vinculada ya está cerrada (entregada, anulada o abandonada): no admite abonos. Haz el recibo sin crear el abono, o pídele al administrador que revise la OT.';
  END IF;
  IF v_orden_id IS NOT NULL AND v_monto_pagado > 0 AND v_crear_abono THEN$q$);

select pg_temp._rep('public.fn_desasociar_cotizacion_de_ot(uuid)'::regprocedure,
  $q$  IF v_cot.ot_id IS NULL THEN RAISE EXCEPTION 'La cotización no está vinculada a ninguna OT'; END IF;
$q$,
  $q$  IF v_cot.ot_id IS NULL THEN RAISE EXCEPTION 'La cotización no está vinculada a ninguna OT'; END IF;
  IF EXISTS (SELECT 1 FROM ordenes_servicio WHERE id = v_cot.ot_id
              AND estado IN ('entregada','cancelada','abandonada')) THEN
    RAISE EXCEPTION 'La OT de esta cotización ya está cerrada: no se puede desvincular.';
  END IF;
$q$);

-- 1c. Anular: mensaje claro antes de tocar nada.
select pg_temp._rep('public.fn_cancelar_orden(uuid)'::regprocedure,
  $q$  if v_estado = 'cancelada' then raise exception 'La orden ya está cancelada'; end if;$q$,
  $q$  if v_estado = 'cancelada' then raise exception 'La orden ya está cancelada'; end if;
  if v_estado = 'abandonada' then
    raise exception 'La OT está cerrada como abandonada. Si el cliente volvió, primero usa "Reabrir OT".';
  end if;$q$);

-- 1d. Garantías amarradas a una OT abandonada.
select pg_temp._rep('public.fn_anular_garantia_venta(uuid,text)'::regprocedure,
  $q$    if v_ot_estado is not null and v_ot_estado not in ('entregada','cancelada') then$q$,
  $q$    if v_ot_estado is not null and v_ot_estado not in ('entregada','cancelada','abandonada') then$q$);

select pg_temp._rep('public.trg_garantia_venta_cerrar_por_ot()'::regprocedure,
  $q$  IF NEW.estado = 'entregada' AND OLD.estado IS DISTINCT FROM 'entregada' THEN$q$,
  $q$  IF NEW.estado IN ('entregada','abandonada') AND OLD.estado IS DISTINCT FROM NEW.estado THEN$q$);

-- 1e. Producto de segunda: por defecto donde está el equipo, no la sede de la OT.
select pg_temp._rep('public.fn_generar_producto_segunda_ot(uuid,text,text,numeric,numeric,numeric,text,text)'::regprocedure,
  $q$select id, numero, sede_id, estado::text, equipo_descripcion into v_ot$q$,
  $q$select id, numero, coalesce(sede_equipo_id, sede_id) as sede_id, estado::text, equipo_descripcion into v_ot$q$);


-- ═══ 2. Reabrir una OT abandonada (el cliente volvió) ═══════════════════════
alter table public.ordenes_servicio add column if not exists estado_antes_abandono text;
-- Fecha del último cambio de estado: la alerta de equipos sin recoger cuenta
-- desde aquí, no desde updated_at (mover el equipo reiniciaba el contador).
alter table public.ordenes_servicio add column if not exists estado_cambiado_at timestamptz;
update public.ordenes_servicio set estado_cambiado_at = coalesce(pendiente_recogida_at, updated_at, fecha)
 where estado_cambiado_at is null;

create or replace function public.trg_orden_fecha_estado()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
  if NEW.estado is distinct from OLD.estado then
    NEW.estado_cambiado_at := now();
  end if;
  return NEW;
end $$;
drop trigger if exists trg_before_update_orden_fecha_estado on public.ordenes_servicio;
create trigger trg_before_update_orden_fecha_estado
  before update of estado on public.ordenes_servicio
  for each row execute function public.trg_orden_fecha_estado();
revoke all on function public.trg_orden_fecha_estado() from public, anon;

select pg_temp._rep('public.fn_marcar_ot_abandonada(uuid,text,text)'::regprocedure,
  $q$     set estado = 'abandonada',
$q$,
  $q$     set estado = 'abandonada',
         estado_antes_abandono = v_o.estado::text,
$q$);

create or replace function public.fn_reabrir_ot_abandonada(p_orden_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_o record;
  v_volver text;
  v_total_antes numeric;
  v_total_despues numeric;
  v_motivo text := nullif(trim(coalesce(p_motivo,'')), '');
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  if (select get_my_rol()) is distinct from 'Admin' then
    raise exception 'Solo el administrador puede reabrir una OT abandonada.';
  end if;
  if v_motivo is null or length(v_motivo) < 5 then
    raise exception 'Escribe por qué se reabre (por ejemplo: "el cliente volvió por el equipo").';
  end if;
  select * into v_o from ordenes_servicio where id = p_orden_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if v_o.estado <> 'abandonada' then
    raise exception 'La OT #% no está abandonada (está %).', v_o.numero, v_o.estado;
  end if;
  -- Vuelve al estado en que estaba; si no se sabe, a "terminada" (desde ahí
  -- se entrega con "Convertir a venta y entregar").
  v_volver := coalesce(v_o.estado_antes_abandono, 'terminada');
  v_total_antes := v_o.total;

  perform set_config('cdv.anulando_venta', 'on', true);
  update ordenes_servicio
     set estado = v_volver::estado_orden,
         estado_antes_abandono = null,
         observaciones = trim(both E'\n' from coalesce(observaciones,'') || E'\n' ||
           '[' || to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD') || '] Reabierta: ' || v_motivo)
   where id = p_orden_id
   returning total into v_total_despues;
  perform set_config('cdv.anulando_venta', 'off', true);

  if v_total_despues is distinct from v_total_antes then
    raise exception 'Al reabrir, el total cambiaría de % a %. No se hizo nada; revisa la OT.', v_total_antes, v_total_despues;
  end if;
  return jsonb_build_object('orden_id', p_orden_id, 'numero', v_o.numero, 'estado', v_volver);
end $function$;
revoke all on function public.fn_reabrir_ot_abandonada(uuid, text) from public, anon;
grant execute on function public.fn_reabrir_ot_abandonada(uuid, text) to authenticated, service_role;

-- Las 6 que se marcaron hoy no guardaron su estado anterior: se completa del
-- historial de la marca (todas estaban abiertas sin repuestos).
update public.ordenes_servicio o
   set estado_antes_abandono = case o.numero
         when 78 then 'autorizada' when 83 then 'cotizada' when 108 then 'autorizada'
         when 144 then 'recepcion' when 170 then 'terminada' when 181 then 'diagnostico' end
 where o.estado = 'abandonada' and o.estado_antes_abandono is null
   and o.numero in (78, 83, 108, 144, 170, 181);

-- Vista de alertas: días desde el último cambio de estado.
create or replace view public.v_ot_alertas_30_dias
with (security_invoker = true) as
select o.id, o.numero, o.fecha, o.cliente_nombre, o.cliente_telefono, o.equipo_descripcion,
    o.equipo_serie, o.diagnostico, o.trabajo_realizado, o.tecnico_id, o.sede_id, o.estado,
    o.costo_mano_obra, o.costo_repuestos, o.total, o.fecha_entrega, o.observaciones,
    o.created_at, o.updated_at, o.estado_autorizacion, o.valor_revision, o.fecha_alerta_30_dias,
    o.pendiente_recogida_at,
    true as supera_30_dias,
    fn_total_abonos_ot(o.id) as total_abonado,
    ((now() at time zone 'America/Bogota')::date
      - (coalesce(o.pendiente_recogida_at, o.estado_cambiado_at, o.fecha) at time zone 'America/Bogota')::date) as dias_sin_movimiento,
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
   and coalesce(o.pendiente_recogida_at, o.estado_cambiado_at, o.fecha)
       < now() - make_interval(days => coalesce((fn_get_parametro('dias_alerta_ot_abandonada'))::integer, 30));
revoke all on public.v_ot_alertas_30_dias from anon, public;
revoke insert, update, delete, truncate, references, trigger on public.v_ot_alertas_30_dias from authenticated;
grant select on public.v_ot_alertas_30_dias to authenticated;
alter view public.v_ot_alertas_30_dias set (security_invoker = true);


-- ═══ 3. Insumos ═════════════════════════════════════════════════════════════
-- 3a. Préstamo: solo uno activo de verdad.
select pg_temp._rep('public.fn_convertir_a_insumo(uuid,text,integer,jsonb)'::regprocedure,
  $q$FROM herramientas_prestamo WHERE id = v_doc AND activo IS NOT FALSE;$q$,
  $q$FROM herramientas_prestamo WHERE id = v_doc AND activo IS NOT FALSE AND estado_prestamo = 'activo';$q$);
-- 3b. Cada quien convierte en su sede (el técnico descarga en ensambles que
--     le asignan en otras sedes, por eso queda por fuera).
select pg_temp._rep('public.fn_convertir_a_insumo(uuid,text,integer,jsonb)'::regprocedure,
  $q$  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RAISE EXCEPTION 'La cantidad a convertir debe ser mayor a 0'; END IF;$q$,
  $q$  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RAISE EXCEPTION 'La cantidad a convertir debe ser mayor a 0'; END IF;
  IF v_rol NOT IN ('Admin','Tecnico')
     AND p_sede_id IS DISTINCT FROM (SELECT sede_id FROM usuarios WHERE id = v_uid) THEN
    RAISE EXCEPTION 'Solo puedes convertir a insumo el stock de tu sede. Para otra sede, pídeselo a esa sede o al administrador.';
  END IF;$q$);
-- 3c. Vincular a un ensamble solo lo que su receta usa.
select pg_temp._rep('public.fn_vincular_conversiones_ensamble(uuid,bigint[])'::regprocedure,
  $q$and d.created_by = v_uid and m.sede_id = v_sede;$q$,
  $q$and d.created_by = v_uid and m.sede_id = v_sede
     and exists (select 1 from detalle_ensamble de where de.ensamble_id = p_ensamble_id and de.producto_id = m.producto_id);$q$);
-- 3d. Histórico: se suelta lo inferido cuando lo convertido es más del doble
--     de lo que ese documento consumió de ese producto (no es creíble).
delete from public.conversion_destino d
 using public.movimientos m
 where d.inferido and m.id = d.movimiento_id
   and d.tipo in ('ensamble','prestamo','orden')
   and abs(m.cantidad) > 2 * (
     select coalesce(sum(abs(x.cantidad)), 0) from public.movimientos x
      where x.referencia_id = coalesce(d.orden_id, d.ensamble_id, d.prestamo_id)
        and x.producto_id = m.producto_id
        and x.tipo in ('orden_consumo','ensamble_consumo','ajuste') and x.cantidad < 0);


-- ═══ 4. Compras y pagos ═════════════════════════════════════════════════════
-- 4a. Recibir incompleto una compra ya pagada dejaría la cuenta en negativo.
select pg_temp._rep('public.fn_recibir_compra(uuid,jsonb)'::regprocedure,
  $q$  UPDATE compras SET recibida = true, fecha_recepcion = now() WHERE id = p_compra_id;$q$,
  $q$  IF EXISTS (
       SELECT 1 FROM compras c
        WHERE c.id = p_compra_id AND c.metodo_pago = 'Crédito'
          AND (SELECT coalesce(sum(p.monto),0) FROM pagos_cuenta p
                WHERE p.compra_id = c.id AND p.tipo = 'pago' AND coalesce(p.anulado,false) = false)
              > (c.total - coalesce(c.retenciones_total,0)) + 0.01) THEN
    RAISE EXCEPTION 'A esta compra ya se le pagó más de lo que vale lo que llegó. No ajustes el faltante: márcalo para reclamar al proveedor (que lo mande o devuelva la plata).';
  END IF;
  UPDATE compras SET recibida = true, fecha_recepcion = now() WHERE id = p_compra_id;$q$);

-- 4b. ¿De qué caja sale el pago? (decisión de David, 2026-10-17)
alter table public.pagos_cuenta add column if not exists sede_caja text references public.sedes(id);

select pg_temp._rep('public.fn_registrar_pago_cuenta(jsonb)'::regprocedure,
  $q$v_dia date; v_fecha timestamptz;$q$,
  $q$v_dia date; v_fecha timestamptz; v_caja text;$q$);
select pg_temp._rep('public.fn_registrar_pago_cuenta(jsonb)'::regprocedure,
  $q$    insert into pagos_cuenta (tipo, compra_id, monto, metodo_pago, cuenta_bancaria, observaciones, registrado_por, fecha)
    values ('pago', v_compra.id, v_monto, v_metodo, v_cuenta, nullif(trim(p_payload->>'observaciones'),''), v_uid, v_fecha);$q$,
  $q$    -- La caja de la que sale: el Admin la escoge (por defecto la de la
    -- compra); Bodega paga de la suya.
    v_caja := case when v_rol = 'Admin'
                   then coalesce(nullif(trim(p_payload->>'sede_caja'),''), v_compra.sede_destino_id)
                   else v_sede end;
    if not exists (select 1 from sedes where id = v_caja) then
      raise exception 'La caja escogida no existe (%).', v_caja;
    end if;
    insert into pagos_cuenta (tipo, compra_id, monto, metodo_pago, cuenta_bancaria, observaciones, registrado_por, fecha, sede_caja)
    values ('pago', v_compra.id, v_monto, v_metodo, v_cuenta, nullif(trim(p_payload->>'observaciones'),''), v_uid, v_fecha, v_caja);$q$);

-- El cierre cuenta cada pago a proveedor en la caja de la que salió.
select pg_temp._rep('public._fn_cierre_totales(date,date,text)'::regprocedure,
  $q$         and (p_sede is null or c.sede_destino_id=p_sede)),0)
  + coalesce((select sum(g.monto_devuelto) from garantias_venta g$q$,
  $q$         and (p_sede is null or coalesce(pc.sede_caja, c.sede_destino_id)=p_sede)),0)
  + coalesce((select sum(g.monto_devuelto) from garantias_venta g$q$);
select pg_temp._rep('public._fn_cierre_totales(date,date,text)'::regprocedure,
  $q$from pagos_cuenta pc join compras c on c.id=pc.compra_id where c.sede_destino_id=se.id and pc.tipo='pago'$q$,
  $q$from pagos_cuenta pc join compras c on c.id=pc.compra_id where coalesce(pc.sede_caja, c.sede_destino_id)=se.id and pc.tipo='pago'$q$);
select pg_temp._rep('public._fn_cierre_totales(date,date,text)'::regprocedure,
  $q$union all select c.sede_destino_id, lower(pc.metodo_pago), 0::numeric, pc.monto from pagos_cuenta pc$q$,
  $q$union all select coalesce(pc.sede_caja, c.sede_destino_id), lower(pc.metodo_pago), 0::numeric, pc.monto from pagos_cuenta pc$q$);
select pg_temp._rep('public._fn_cierre_totales(date,date,text)'::regprocedure,
  $q$union all select c.sede_destino_id, nullif(trim(pc.cuenta_bancaria),''), 0::numeric, pc.monto from pagos_cuenta pc$q$,
  $q$union all select coalesce(pc.sede_caja, c.sede_destino_id), nullif(trim(pc.cuenta_bancaria),''), 0::numeric, pc.monto from pagos_cuenta pc$q$);
select pg_temp._rep('public._fn_cierre_totales(date,date,text)'::regprocedure,
  $q$    from pagos_cuenta pc join compras c on c.id=pc.compra_id join sedes se on se.id=c.sede_destino_id$q$,
  $q$    from pagos_cuenta pc join compras c on c.id=pc.compra_id join sedes se on se.id=coalesce(pc.sede_caja, c.sede_destino_id)$q$);
select pg_temp._rep('public._fn_cierre_totales(date,date,text)'::regprocedure,
  $q$      jsonb_build_object('sede_id', c.sede_destino_id, 'sede_nombre', se.nombre,
        'proveedor', c.proveedor, 'concepto', 'Pago compra a crédito #'||c.numero$q$,
  $q$      jsonb_build_object('sede_id', coalesce(pc.sede_caja, c.sede_destino_id), 'sede_nombre', se.nombre,
        'proveedor', c.proveedor, 'concepto', 'Pago compra a crédito #'||c.numero$q$);
select pg_temp._rep('public._fn_cierre_totales(date,date,text)'::regprocedure,
  $q$      and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or c.sede_destino_id=p_sede)
    union all$q$,
  $q$      and (pc.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta and (p_sede is null or coalesce(pc.sede_caja, c.sede_destino_id)=p_sede)
    union all$q$);
select pg_temp._rep('public._fn_cierre_totales(date,date,text)'::regprocedure,
  $q$                where c.sede_destino_id=se.id and pc.tipo='pago' and coalesce(pc.anulado,false)=false and (pc.fecha$q$,
  $q$                where coalesce(pc.sede_caja, c.sede_destino_id)=se.id and pc.tipo='pago' and coalesce(pc.anulado,false)=false and (pc.fecha$q$);

-- 4c. El aviso de "ese día ya tiene cierre" necesita el rango exacto para el
--     complementario, y prefiere el diario.
create or replace function public.fn_dia_tiene_cierre(p_fecha date, p_sede text default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select jsonb_build_object('numero', c.numero, 'tipo', c.tipo, 'sede_id', c.sede_id,
                               'fecha_desde', c.fecha_desde, 'fecha_hasta', c.fecha_hasta)
       from cierres c
      where auth.uid() is not null
        and p_fecha between c.fecha_desde and c.fecha_hasta
        and (c.sede_id is null or p_sede is null or c.sede_id = p_sede)
      order by (c.fecha_desde = c.fecha_hasta) desc, c.created_at desc
      limit 1),
    'null'::jsonb);
$$;
revoke all on function public.fn_dia_tiene_cierre(date, text) from public, anon;
grant execute on function public.fn_dia_tiene_cierre(date, text) to authenticated, service_role;

notify pgrst, 'reload schema';
