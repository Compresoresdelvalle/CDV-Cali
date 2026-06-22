-- ============================================================================
-- Rediseño OT — Opción A — FIX: anular venta-OT + total en INSERT.
-- 1) BUG CRÍTICO: anular una venta de OT fallaba porque revertir la OT
--    (entregada → terminada) chocaba con la inmutabilidad del trigger de
--    estados. Se permite la transición cuando hay anulación en curso
--    (GUC cdv.anulando_venta = 'on'), y fn_anular_venta mantiene la bandera
--    encendida durante la reversión de la OT.
-- 2) Blindaje: el total de la OT se calcula también en INSERT (no solo UPDATE).
-- ============================================================================

-- 1a) Trigger de estados: bypass durante anulación de venta.
create or replace function public.trg_orden_validar_transicion()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_abonos numeric;
begin
  if OLD.estado = NEW.estado then return NEW; end if;

  -- Bypass cuando se está anulando una venta-OT (revierte entregada → terminada).
  if coalesce(current_setting('cdv.anulando_venta', true), 'off') = 'on' then
    return NEW;
  end if;

  if OLD.estado in ('entregada','cancelada') then
    raise exception 'La OT % es inmutable (estado %)', OLD.numero, OLD.estado;
  end if;
  if NEW.estado = 'cancelada' then return NEW; end if;

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
  if NEW.estado='autorizada' and jsonb_array_length(coalesce(NEW.cotizacion_draft,'[]'::jsonb))=0
     and coalesce(NEW.costo_mano_obra,0)=0 and coalesce(NEW.valor_revision,0)=0 then
    raise exception 'Falta cotizar (repuesto, mano de obra o valor de revisión)';
  end if;
  if NEW.estado='en_proceso' and OLD.estado='autorizada'
     and coalesce(NEW.estado_autorizacion,'') = 'autorizado' then
    select coalesce(sum(monto),0) into v_abonos from abonos where orden_id=NEW.id;
    if v_abonos<=0 then raise exception 'Falta registrar el anticipo para iniciar el trabajo'; end if;
  end if;
  if NEW.estado='terminada' and coalesce(NEW.trabajo_realizado,'')='' then
    raise exception 'Falta registrar el trabajo realizado para terminar';
  end if;

  if NEW.estado='pendiente_recogida' and OLD.estado<>'pendiente_recogida' then
    NEW.pendiente_recogida_at := now();
  end if;

  return NEW;
end $$;

-- 1b) fn_anular_venta: mantener la bandera encendida durante la reversión de la OT.
create or replace function public.fn_anular_venta(p_venta_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid(); v_rol text; v_anulada boolean;
  v_item detalle_venta%rowtype; v_sede_id text; v_origen text; v_orden_id uuid;
  v_stock_ant integer; v_stock_post integer;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select get_my_rol() into v_rol;
  if v_rol is distinct from 'Admin' then raise exception 'Solo el administrador puede anular ventas'; end if;

  select anulada, sede_id, origen, orden_id into v_anulada, v_sede_id, v_origen, v_orden_id
  from ventas where id = p_venta_id;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v_anulada then raise exception 'La venta ya fue anulada anteriormente'; end if;

  perform set_config('cdv.anulando_venta', 'on', true);
  update ventas set anulada=true, anulada_por=v_uid, anulada_en=now(), motivo_anulacion=v_motivo
   where id = p_venta_id;

  update pagos_cuenta set anulado=true, anulado_por=v_uid, anulado_en=now(),
         motivo_anulacion=coalesce(v_motivo,'Venta anulada')
   where venta_id = p_venta_id and coalesce(anulado,false)=false;

  -- Venta de OT: no movió stock. Revertir la OT (bandera sigue 'on' → permite entregada→terminada).
  if v_origen = 'ot' then
    update abonos set venta_id = null where venta_id = p_venta_id;
    update ordenes_servicio set venta_id = null, estado = 'terminada', fecha_entrega = null
     where id = v_orden_id;
    perform set_config('cdv.anulando_venta', 'off', true);
    return;
  end if;

  perform set_config('cdv.anulando_venta', 'off', true);

  -- Venta directa: reintegrar stock.
  for v_item in select * from detalle_venta where venta_id = p_venta_id loop
    if v_item.producto_id is null then continue; end if;
    select cantidad into v_stock_ant from inventario
     where producto_id = v_item.producto_id and sede_id = v_sede_id for update;
    v_stock_post := coalesce(v_stock_ant,0) + v_item.cantidad;
    update inventario set cantidad = v_stock_post, updated_at = now()
     where producto_id = v_item.producto_id and sede_id = v_sede_id;
    insert into movimientos (producto_id, sede_id, tipo, cantidad, stock_anterior, stock_posterior,
                            referencia_id, referencia_tipo, usuario_id, observaciones)
    select v_item.producto_id, v_sede_id, 'ajuste', v_item.cantidad,
           coalesce(v_stock_ant,0), v_stock_post, p_venta_id, 'venta', v_uid,
           'Anulación de venta #' || v.numero
    from ventas v where v.id = p_venta_id;
    perform fn_actualizar_estado_stock(v_item.producto_id, v_sede_id);
  end loop;
end;
$function$;

-- 2) Total de la OT calculado también en INSERT.
create or replace function public.trg_orden_recalcular_total_mo()
returns trigger language plpgsql set search_path to 'public','pg_temp'
as $$
begin
  if TG_OP = 'UPDATE' and OLD.estado = 'entregada' and NEW.estado = 'entregada' then
    if NEW.costo_mano_obra   is distinct from OLD.costo_mano_obra
       or NEW.cliente_nombre is distinct from OLD.cliente_nombre
       or NEW.cliente_telefono is distinct from OLD.cliente_telefono
       or NEW.equipo_descripcion is distinct from OLD.equipo_descripcion
       or NEW.diagnostico   is distinct from OLD.diagnostico
       or NEW.trabajo_realizado is distinct from OLD.trabajo_realizado then
      raise exception 'No se puede modificar una orden entregada';
    end if;
  end if;

  if TG_OP = 'INSERT'
     or NEW.costo_mano_obra is distinct from OLD.costo_mano_obra
     or NEW.valor_repuestos is distinct from OLD.valor_repuestos
     or NEW.valor_revision is distinct from OLD.valor_revision
     or NEW.iva_pct        is distinct from OLD.iva_pct
     or NEW.descuento_valor is distinct from OLD.descuento_valor then
    NEW.total := round((coalesce(NEW.costo_mano_obra,0) + coalesce(NEW.valor_repuestos,0)
                        + coalesce(NEW.valor_revision,0) - coalesce(NEW.descuento_valor,0))
                       * (1 + coalesce(NEW.iva_pct,0)/100), 2);
  end if;
  return NEW;
end $$;

drop trigger if exists trg_before_update_orden_mo on ordenes_servicio;
create trigger trg_before_insupd_orden_mo
  before insert or update on ordenes_servicio
  for each row execute function trg_orden_recalcular_total_mo();
