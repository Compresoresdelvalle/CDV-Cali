-- ============================================================================
-- P2 (Cierre): `por_cuenta` no desglosaba los abonos por cuenta bancaria.
--
-- Un abono por transferencia aparecía en `por_metodo` como 'transferencia',
-- pero en `por_cuenta` caía bajo NULL ("sin cuenta"), porque ni `abonos` (OT)
-- ni `abonos_cotizacion` guardaban la cuenta. El motor lo tenía hardcodeado
-- como `null::text`. Hueco de diseño preexistente (NO lo introdujo S3-05),
-- simétrico en los dos flujos: se cierra en ambos.
--
-- La columna es OPCIONAL a propósito: la app es una PWA y hay clientes con
-- código cacheado que aún no envían la cuenta. Si la BD la exigiera, un abono
-- desde una versión vieja fallaría y rompería el flujo en producción. La
-- exigencia vive en la UI nueva; los abonos viejos siguen agrupados bajo
-- "sin cuenta" como hasta hoy, sin perder ni mover un peso.
--
-- Formato del texto: el mismo del resto del sistema (`cuentaBancariaLabel` /
-- CompraNueva / pagos_cuenta): "<banco> <tipo> <numero> · <titular>".
-- ============================================================================

ALTER TABLE public.abonos             ADD COLUMN IF NOT EXISTS cuenta_bancaria text;
ALTER TABLE public.abonos_cotizacion  ADD COLUMN IF NOT EXISTS cuenta_bancaria text;

-- ── RPC de abono de cotización: acepta la cuenta ────────────────────────────
-- Se DROPea la firma de 4 args para no dejar una sobrecarga ambigua; la nueva
-- tiene el 5º parámetro con DEFAULT, así que los clientes viejos (4 args por
-- nombre) siguen funcionando igual.
DROP FUNCTION IF EXISTS public.fn_registrar_abono_cotizacion(uuid, numeric, text, text);

CREATE OR REPLACE FUNCTION public.fn_registrar_abono_cotizacion(
  p_cotizacion_id uuid,
  p_monto numeric,
  p_metodo_pago text DEFAULT 'efectivo'::text,
  p_observaciones text DEFAULT NULL::text,
  p_cuenta_bancaria text DEFAULT NULL::text
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
  v_cuenta text := nullif(trim(p_cuenta_bancaria), '');
  v_abono_id bigint;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del abono debe ser mayor a 0';
  end if;
  if p_metodo_pago not in ('efectivo', 'transferencia', 'tarjeta', 'otro') then
    raise exception 'Método de pago inválido (%)', p_metodo_pago;
  end if;
  -- La cuenta solo tiene sentido en pagos electrónicos; en efectivo se ignora
  -- para que no ensucie el desglose por cuenta.
  if p_metodo_pago not in ('transferencia', 'tarjeta') then
    v_cuenta := null;
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

  insert into abonos_cotizacion (cotizacion_id, monto, metodo_pago, observaciones, registrado_por, cuenta_bancaria)
  values (p_cotizacion_id, p_monto, p_metodo_pago, p_observaciones, v_uid, v_cuenta)
  returning id into v_abono_id;

  return jsonb_build_object('abono_id', v_abono_id);
end;
$function$;

-- El DROP+CREATE resetea la ACL al default (EXECUTE a PUBLIC). Se restaura la
-- postura original: solo authenticated y service_role.
REVOKE EXECUTE ON FUNCTION public.fn_registrar_abono_cotizacion(uuid, numeric, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_registrar_abono_cotizacion(uuid, numeric, text, text, text) TO authenticated, service_role;

-- ── Motor del cierre: `por_cuenta` usa la cuenta real de los abonos ─────────
-- Se parchea la definición VIVA (pg_get_functiondef) en vez de reescribir las
-- 212 líneas del motor: así es imposible introducir un cambio accidental en la
-- lógica de dinero. Las aserciones impiden un no-op silencioso si el texto
-- cambiara en el futuro.
DO $mig$
DECLARE
  v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
   WHERE p.proname = '_fn_cierre_totales' AND p.pronamespace = 'public'::regnamespace;
  IF v_def IS NULL THEN
    RAISE EXCEPTION '_fn_cierre_totales no existe';
  END IF;

  v_new := replace(v_def,
    'union all select o.sede_id, null::text, a.monto, 0::numeric from abonos a',
    'union all select o.sede_id, nullif(trim(a.cuenta_bancaria),''''), a.monto, 0::numeric from abonos a');
  v_new := replace(v_new,
    'union all select co.sede_id, null::text, ac.monto, 0::numeric from abonos_cotizacion ac',
    'union all select co.sede_id, nullif(trim(ac.cuenta_bancaria),''''), ac.monto, 0::numeric from abonos_cotizacion ac');

  IF v_new = v_def THEN
    RAISE EXCEPTION 'No se aplicó ningún cambio a _fn_cierre_totales (el texto esperado no coincide)';
  END IF;
  IF position('nullif(trim(a.cuenta_bancaria)' in v_new) = 0
     OR position('nullif(trim(ac.cuenta_bancaria)' in v_new) = 0 THEN
    RAISE EXCEPTION 'Falta uno de los dos reemplazos esperados en _fn_cierre_totales';
  END IF;

  EXECUTE v_new;
END $mig$;
