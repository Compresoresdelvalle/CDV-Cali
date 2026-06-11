-- MEDIO (auditoría 2026-06-09, M7): la tabla `abonos` no tenía trigger de
-- validación; abonos_insert.with_check solo valida rol/sede. No había tope: se
-- podían registrar abonos por encima del total de la OT (hoy hay 4 OTs con
-- abono>total), generando saldos negativos / caja descuadrada.
--
-- DECISIÓN CLIENTE: BLOQUEAR que el acumulado de abonos supere el total cobrable.
--
-- Implementación: trigger BEFORE INSERT/UPDATE en abonos que (a) rechaza monto<=0;
-- (b) cuando el total de la OT ya está definido (>0), rechaza que el acumulado
-- supere ese total. Usa ordenes_servicio.total, ya canónico (incluye valor_revision,
-- migración 20260610000033). El tope solo se aplica en INSERT o cuando un UPDATE
-- AUMENTA el monto, para no bloquear la corrección/edición de las OTs que hoy ya
-- están sobre-abonadas (reducir o editar metadata sigue permitido). En OTs aún sin
-- costos (total=0) se permite el anticipo que exige el flujo de autorización.

create or replace function public.trg_abono_validar_tope()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_total     numeric;
  v_acumulado numeric;
begin
  if NEW.monto is null or NEW.monto <= 0 then
    raise exception 'El monto del abono debe ser mayor que 0';
  end if;

  if TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and NEW.monto > OLD.monto) then
    select coalesce(total, 0) into v_total from ordenes_servicio where id = NEW.orden_id;
    if v_total > 0 then
      select coalesce(sum(monto), 0) into v_acumulado
        from abonos where orden_id = NEW.orden_id and id <> coalesce(NEW.id, -1);
      if v_acumulado + NEW.monto > v_total + 0.01 then
        raise exception 'El abono haría que el acumulado (%) supere el total cobrable de la OT (%). Registra a lo sumo el saldo pendiente (%).',
          v_acumulado + NEW.monto, v_total, greatest(v_total - v_acumulado, 0);
      end if;
    end if;
  end if;

  return NEW;
end;
$function$;

drop trigger if exists trg_before_insupd_abono_tope on public.abonos;
create trigger trg_before_insupd_abono_tope
  before insert or update on public.abonos
  for each row
  execute function public.trg_abono_validar_tope();
