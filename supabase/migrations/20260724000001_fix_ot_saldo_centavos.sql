-- Fix: OT con "total" en centavos congela el pago del saldo (bucle infinito).
--
-- Contexto (caso real OT-151):
--   base = mano_obra + repuestos - descuento = 30.000 + 320.000 - 14.706 = 335.294
--   iva 19%                                    = 63.705,86
--   total (sin redondear)                      = 398.999,86  ← con centavos
--
-- El redondeo a pesos ENTEROS del total de la OT se añadió después de que esta
-- orden fue creada, así que su total quedó con 0,86 de centavos. El resto de la
-- app trabaja en pesos enteros:
--   • frontend: calcularMontos() usa Math.round() para total y saldo,
--   • input de "Monto" del abono: solo acepta dígitos (borra la coma).
-- Pero el tope del backend (trg_abono_validar_tope) comparaba contra el total
-- CRUDO con centavos. Resultado del bucle:
--   1. Paga saldo completo (399.000) → tope: "máximo 398.999" (398.999,86).
--   2. Abona 398.999 → saldo real 0,86; el front muestra "saldo 1".
--   3. Intenta pagar 1 → tope: "máximo 0,86"; el input no deja escribir 0,86.
--   → nunca cuadra: la OT queda en "terminada" sin poder facturarse.
--
-- Arreglo (dos partes):

-- 1) El tope de abonos trabaja en pesos enteros, igual que el frontend y el
--    input. Con totales ya enteros es un no-op; sólo evita que un total con
--    centavos residuales vuelva a dejar un saldo fraccionario impagable.
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
    -- Pesos enteros: el tope se mide contra el total redondeado (round(...,0)),
    -- consistente con el frontend (Math.round) y con el input que sólo admite
    -- dígitos. Así el saldo siempre se puede saldar exactamente.
    select round(coalesce(total, 0), 0) into v_total
      from ordenes_servicio where id = NEW.orden_id;
    if v_total <= 0 then
      raise exception 'La OT aún no tiene valor. Cotiza los repuestos / mano de obra antes de registrar un abono.';
    end if;
    select coalesce(sum(monto), 0) into v_acumulado
      from abonos where orden_id = NEW.orden_id and id <> coalesce(NEW.id, -1);
    if v_acumulado + NEW.monto > v_total + 0.01 then
      raise exception 'El abono haría que el acumulado (%) supere el total cobrable de la OT (%). Registra a lo sumo el saldo pendiente (%).',
        v_acumulado + NEW.monto, v_total, greatest(v_total - v_acumulado, 0);
    end if;
  end if;
  return NEW;
end;
$function$;

-- 2) Saneo de datos: redondear a pesos enteros los totales heredados con
--    centavos. Sólo toca 'total'; no cambia columnas base, así que no dispara
--    el recálculo de trg_orden_recalcular_total_mo (que ya redondea de por sí).
update public.ordenes_servicio
   set total = round(total, 0)
 where total is distinct from round(total, 0);
