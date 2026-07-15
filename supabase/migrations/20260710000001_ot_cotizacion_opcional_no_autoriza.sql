-- ============================================================================
-- OT — La cotización puede quedar VACÍA cuando el cliente no autoriza.
--
-- Problema reportado por la clienta: al crear una OT, el paso de Cotización
-- obligaba a poner mano de obra (o un repuesto) para poder avanzar. Pero cuando
-- el cliente NO va a autorizar la reparación, no hay nada que cotizar: solo se
-- cobra la revisión, que se define en el paso siguiente (Autorización). Al
-- forzar mano de obra la persona ponía un valor "de gancho" y creía que se
-- sumaba a la revisión (aunque el total sí quedaba bien, porque al no autorizar
-- solo se cobra la revisión; ver trg_orden_recalcular_total_mo).
--
-- Fix: se quita el gate "Falta cotizar" de la transición cotizada -> autorizada
-- (deja pasar con la cotización vacía) y se mueve la exigencia de "algo que
-- cobrar" al INICIO del trabajo (autorizada -> en_proceso), separada según la
-- decisión del cliente:
--   - NO autoriza  -> exige valor_revision > 0.
--   - SÍ autoriza  -> exige algo cotizado (repuesto o mano de obra).
--   - Sin decidir  -> no deja iniciar.
-- El anticipo sigue siendo OPCIONAL (no se reintroduce ese requisito).
--
-- El resto del trigger (transiciones permitidas, guard de anulación de venta,
-- gate de diagnóstico, gate de trabajo_realizado, sello pendiente_recogida) no
-- cambia.
-- ============================================================================

create or replace function public.trg_orden_validar_transicion()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
begin
  if OLD.estado = NEW.estado then return NEW; end if;
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

  -- (Antes aquí se exigía "algo cotizado" para pasar a 'autorizada'. Se retiró:
  --  la cotización puede quedar vacía si el cliente no va a autorizar.)

  -- Al INICIAR el trabajo se exige lo que corresponda según la decisión:
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
