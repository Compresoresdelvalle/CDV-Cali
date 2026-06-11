-- BAJO (auditoría 2026-06-09, B9-5): fn_registrar_abono_cotizacion valida monto>0,
-- método, permisos y venta_id IS NULL, pero NO compara contra el total/saldo. Se podía
-- sobre-abonar (abonado>total); la UI ocultaba el exceso con Math.max(0, total-abonado).
-- Combinado con la conversión a venta, podía generar descuadres de caja sin alerta.
--
-- Fix: barrera atómica en la función (un CHECK de fila no aplica a una suma agregada):
-- rechazar si SUM(abonos existentes)+p_monto supera el total de la cotización. El
-- frontend espeja la validación para feedback inmediato.

create or replace function public.fn_registrar_abono_cotizacion(p_cotizacion_id uuid, p_monto numeric, p_metodo_pago text DEFAULT 'efectivo'::text, p_observaciones text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text; v_sede text;
  v_cot_sede text; v_venta_id uuid;
  v_total numeric; v_abonado numeric;
  v_abono_id bigint;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del abono debe ser mayor a 0';
  end if;
  if p_metodo_pago not in ('efectivo', 'transferencia', 'tarjeta', 'otro') then
    raise exception 'Método de pago inválido (%)', p_metodo_pago;
  end if;

  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;
  select sede_id, venta_id, coalesce(total,0) into v_cot_sede, v_venta_id, v_total
    from cotizaciones where id = p_cotizacion_id for update;
  if v_cot_sede is null then
    raise exception 'Cotización no encontrada';
  end if;
  if v_rol not in ('Admin', 'Vendedor') then
    raise exception 'No tienes permiso para registrar abonos';
  end if;
  if v_rol <> 'Admin' and v_cot_sede <> v_sede then
    raise exception 'No puedes abonar a una cotización de otra sede';
  end if;
  if v_venta_id is not null then
    raise exception 'La cotización ya fue convertida en venta; registra el abono en la venta';
  end if;

  select coalesce(sum(monto),0) into v_abonado
    from abonos_cotizacion where cotizacion_id = p_cotizacion_id;
  if v_abonado + p_monto > v_total + 0.01 then
    raise exception 'El abono (%) supera el saldo pendiente de la cotización (%)',
      p_monto, greatest(v_total - v_abonado, 0);
  end if;

  insert into abonos_cotizacion (cotizacion_id, monto, metodo_pago, observaciones, registrado_por)
  values (p_cotizacion_id, p_monto, p_metodo_pago, p_observaciones, v_uid)
  returning id into v_abono_id;

  return jsonb_build_object('abono_id', v_abono_id);
end;
$function$;
