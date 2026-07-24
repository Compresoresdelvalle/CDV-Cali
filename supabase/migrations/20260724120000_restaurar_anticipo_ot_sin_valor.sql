-- Restaura el anticipo en OT que todavía no tienen valor cotizado.
--
-- El arreglo del saldo con centavos (20260724000001) hizo dos cosas en el mismo
-- bloque: comparar el tope contra round(total,0) —que era el arreglo buscado y
-- se conserva— y, de paso, convertir el caso "total = 0" en una excepción:
--
--     if v_total <= 0 then
--       raise exception 'La OT aún no tiene valor. Cotiza los repuestos...';
--     end if;
--
-- Eso revirtió una decisión de negocio explícita y documentada en
-- 20260610000034: "En OTs aún sin costos (total=0) se permite el anticipo que
-- exige el flujo de autorización". Antes, con total = 0 sencillamente no se
-- aplicaba ningún tope y el abono entraba.
--
-- Por qué importa, con datos de producción al 2026-07-24:
--   * 9 OT tienen abonos registrados cuando su total todavía era 0 → el flujo
--     no es teórico, se usa.
--   * 30 OT abiertas están hoy sin valor: si un cliente entrega un anticipo
--     mientras se termina de cotizar, la plata ya está en la caja y el sistema
--     no deja asentarla. Es peor que el bug que se arregló.
--
-- El anticipo antes de cotizar es justo lo que pide el paso de Autorización: el
-- cliente aprueba y deja un adelanto mientras la vendedora carga los repuestos.
--
-- Se mantiene todo lo demás del arreglo anterior: el monto sigue teniendo que
-- ser mayor que 0, y cuando la OT ya tiene valor el tope se mide en pesos
-- enteros con round(total,0), que es lo que destrabó el saldo de 0,86.
--
-- Verificado en producción dentro de una transacción revertida: el anticipo en
-- una OT sin valor vuelve a aceptarse, y un abono que se pasa del total en una
-- OT con valor sigue rechazándose.

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
    -- Pesos enteros: el tope se mide contra el total redondeado, consistente
    -- con el frontend (Math.round) y con el input, que solo admite dígitos.
    -- Así el saldo siempre se puede saldar exactamente.
    select round(coalesce(total, 0), 0) into v_total
      from ordenes_servicio where id = NEW.orden_id;
    -- Con la OT aún sin cotizar (total = 0) no hay techo contra el que medir:
    -- se acepta el anticipo, como antes del 2026-07-24. En cuanto la OT tenga
    -- valor, el tope vuelve a aplicarse y un acumulado que se pase se rechaza.
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
