-- OT: el anticipo deja de ser obligatorio para iniciar el trabajo — 2026-06-30
--
-- Petición de la clienta: poder continuar la OT con o sin abono. Hoy la
-- transición autorizada → en_proceso exige al menos un abono cuando el cliente
-- autorizó ("Falta registrar el anticipo para iniciar el trabajo").
--
-- FIX: se elimina SOLO ese bloque del validador de transiciones. Todas las
-- demás validaciones se conservan intactas (diagnóstico antes de cotizar,
-- cotización antes de autorizar, trabajo realizado antes de terminar, etc.).
-- El abono sigue disponible como opcional; la entrega final sigue exigiendo el
-- saldo cubierto (esa regla vive en el front/flujo de entrega, no aquí).

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
  if NEW.estado='autorizada' and jsonb_array_length(coalesce(NEW.cotizacion_draft,'[]'::jsonb))=0
     and coalesce(NEW.costo_mano_obra,0)=0 and coalesce(NEW.valor_revision,0)=0 then
    raise exception 'Falta cotizar (repuesto, mano de obra o valor de revisión)';
  end if;
  -- (Se eliminó el requisito de anticipo > 0 para pasar a en_proceso: el abono
  --  es opcional. Antes aquí se exigía "Falta registrar el anticipo...".)
  if NEW.estado='terminada' and coalesce(NEW.trabajo_realizado,'')='' then
    raise exception 'Falta registrar el trabajo realizado para terminar';
  end if;
  if NEW.estado='pendiente_recogida' and OLD.estado<>'pendiente_recogida' then
    NEW.pendiente_recogida_at := now();
  end if;
  return NEW;
end $function$;
