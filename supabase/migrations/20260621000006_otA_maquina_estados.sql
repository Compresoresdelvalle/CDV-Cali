-- ============================================================================
-- Rediseño OT — Opción A — FASE 3: Máquina de estados guiada (MODO DUAL)
-- Tolera el flujo VIEJO (abierta→en_proceso→completada→pendiente_recogida→
-- entregada) y el NUEVO (recepcion→diagnostico→cotizada→autorizada→en_proceso→
-- terminada→entregada) a la vez, para no romper la app en producción hasta el
-- despliegue del frontend nuevo. Los GATES (diagnóstico/cotización/anticipo/
-- trabajo) solo aplican al flujo nuevo.
-- Se retira el trigger anti-anticipo viejo (sus reglas quedan en este trigger).
-- ============================================================================

create or replace function public.trg_orden_validar_transicion()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_abonos numeric;
begin
  if OLD.estado = NEW.estado then return NEW; end if;

  if OLD.estado in ('entregada','cancelada') then
    raise exception 'La OT % es inmutable (estado %)', OLD.numero, OLD.estado;
  end if;
  if NEW.estado = 'cancelada' then return NEW; end if;

  if not (
    -- NUEVO flujo
       (OLD.estado='recepcion'          and NEW.estado='diagnostico')
    or (OLD.estado='diagnostico'        and NEW.estado='cotizada')
    or (OLD.estado='cotizada'           and NEW.estado='autorizada')
    or (OLD.estado='autorizada'         and NEW.estado='en_proceso')
    or (OLD.estado='en_proceso'         and NEW.estado in ('esperando_repuesto','terminada'))
    or (OLD.estado='esperando_repuesto' and NEW.estado in ('en_proceso','terminada'))
    or (OLD.estado='terminada'          and NEW.estado='entregada')
    -- LEGACY (flujo viejo, vivo en producción hasta el deploy)
    or (OLD.estado='abierta'            and NEW.estado in ('en_proceso','esperando_repuesto','completada','diagnostico'))
    or (OLD.estado='en_proceso'         and NEW.estado='completada')
    or (OLD.estado='esperando_repuesto' and NEW.estado='completada')
    or (OLD.estado='completada'         and NEW.estado in ('pendiente_recogida','entregada'))
    or (OLD.estado='pendiente_recogida' and NEW.estado='entregada')
  ) then
    raise exception 'Transición no permitida: % -> %', OLD.estado, NEW.estado;
  end if;

  -- GATES del flujo nuevo
  if NEW.estado='cotizada' and coalesce(NEW.diagnostico,'')='' then
    raise exception 'Falta el diagnóstico para cotizar';
  end if;
  if NEW.estado='autorizada' and jsonb_array_length(coalesce(NEW.cotizacion_draft,'[]'::jsonb))=0
     and coalesce(NEW.costo_mano_obra,0)=0 and coalesce(NEW.valor_revision,0)=0 then
    raise exception 'Falta cotizar (repuesto, mano de obra o valor de revisión)';
  end if;
  -- Anticipo: solo al INICIAR trabajo desde autorizada y si el cliente autorizó.
  if NEW.estado='en_proceso' and OLD.estado='autorizada'
     and coalesce(NEW.estado_autorizacion,'') = 'autorizado' then
    select coalesce(sum(monto),0) into v_abonos from abonos where orden_id=NEW.id;
    if v_abonos<=0 then raise exception 'Falta registrar el anticipo para iniciar el trabajo'; end if;
  end if;
  if NEW.estado='terminada' and coalesce(NEW.trabajo_realizado,'')='' then
    raise exception 'Falta registrar el trabajo realizado para terminar';
  end if;

  -- Sello de "lista para recoger" (legacy)
  if NEW.estado='pendiente_recogida' and OLD.estado<>'pendiente_recogida' then
    NEW.pendiente_recogida_at := now();
  end if;

  return NEW;
end $$;

-- Retirar el trigger anti-anticipo viejo (sus reglas quedan arriba).
drop trigger if exists tg_orden_validar_anticipo on ordenes_servicio;
