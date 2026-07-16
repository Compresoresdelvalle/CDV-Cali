-- ============================================================================
-- P1 (S3-05/COT-D-E): un abono sobre una cotización ligada a una OT contamina
-- el cierre de caja.
--
-- Desde S3-05 los abonos de cotización entran al cierre (ingresos_productos +
-- arqueo). Pero una cotización con `ot_id` NUNCA puede convertirse en venta
-- (fn_convertir_cotizacion lo bloquea), así que ese abono jamás se reconcilia
-- contra una venta: queda como ingreso flotante permanente. Y si el mismo
-- dinero físico se registra también en la OT (tabla `abonos`), se cuenta DOS
-- veces: una como productos (cotización) y otra como servicios (OT).
--
-- El anticipo de una OT va SIEMPRE en la OT. Se cierra el hueco en el RPC —
-- que es la única vía real de escritura, porque COT-B revocó el INSERT directo
-- a `authenticated` (la policy RLS de INSERT quedó inalcanzable por REST).
--
-- El resto de guardas ya existentes se conservan intactas (venta_id, estado
-- rechazada/vencida, tope de sobreabono, rol, sede, FOR UPDATE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_registrar_abono_cotizacion(
  p_cotizacion_id uuid,
  p_monto numeric,
  p_metodo_pago text DEFAULT 'efectivo'::text,
  p_observaciones text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_rol text; v_sede text;
  v_cot_sede text; v_venta_id uuid;
  v_total numeric; v_abonado numeric;
  v_estado text;
  v_ot_id uuid; v_ot_numero text;
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
  select sede_id, venta_id, coalesce(total,0), estado::text, ot_id
    into v_cot_sede, v_venta_id, v_total, v_estado, v_ot_id
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

  -- P1: el anticipo de una OT se registra en la OT, no en su cotización.
  -- Mensaje accionable: explica por qué no deja y a dónde debe ir el dinero.
  if v_ot_id is not null then
    select numero::text into v_ot_numero from ordenes_servicio where id = v_ot_id;
    raise exception 'Esta cotización pertenece a la orden de trabajo #%. El anticipo debe registrarse en la OT, no aquí (si no, el dinero se contaría dos veces en el cierre de caja). Abre la OT #% y registra el abono allí.',
      coalesce(v_ot_numero, '?'), coalesce(v_ot_numero, '?');
  end if;

  if v_estado in ('rechazada','vencida') then
    raise exception 'No se puede registrar un abono sobre una cotización % (rechazada o vencida)', v_estado;
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
