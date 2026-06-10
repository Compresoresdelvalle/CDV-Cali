-- ALTO (auditoría 2026-06-09): los abonos hechos contra una cotización
-- (abonos_cotizacion) "desaparecían" tras convertirla en venta. En realidad el
-- dato NO se perdía — abonos_cotizacion sigue ligado vía cotizaciones.venta_id —
-- pero quedaba OCULTO porque toda la maquinaria de cuentas por cobrar exigía
-- metodo_pago = 'Crédito', y fn_convertir_cotizacion crea la venta como 'efectivo'.
--
-- DECISIÓN CLIENTE: mostrar los abonos en TODA venta convertida, sin importar el
-- método de pago (desacoplar la reconciliación de metodo_pago).
--
-- Cambios:
--  (1) v_cuentas_por_cobrar: incluir además las ventas (no anuladas) que tengan
--      abonos_cotizacion, aunque no sean 'Crédito'. El saldo ya venía neto de
--      abonos + cobros directos.
--  (2) fn_registrar_pago_cuenta: permitir registrar un cobro cuando la venta es
--      'Crédito' O tiene abonos_cotizacion (para poder cobrar el saldo pendiente
--      de una venta convertida con abono parcial).
--
-- fn_convertir_cotizacion NO requiere cambio: ya deja cotizaciones.venta_id
-- apuntando a la venta, que es la cadena que usan la vista y el frontend.

-- (1) Vista: Crédito O con abonos de cotización -----------------------------
create or replace view public.v_cuentas_por_cobrar as
  select v.id as venta_id,
         v.numero,
         v.fecha,
         v.cliente_nombre,
         v.sede_id,
         v.vendedor_id,
         coalesce(v.total, 0::numeric) as total,
         coalesce(ac.abonos, 0::numeric) as abonos_cotizacion,
         coalesce(pc.pagos, 0::numeric) as pagos_directos,
         coalesce(v.total, 0::numeric) - coalesce(ac.abonos, 0::numeric) - coalesce(pc.pagos, 0::numeric) as saldo
    from ventas v
    left join lateral (
      select sum(a.monto) as abonos
        from abonos_cotizacion a
        join cotizaciones c on c.id = a.cotizacion_id
       where c.venta_id = v.id
    ) ac on true
    left join lateral (
      select sum(p.monto) as pagos
        from pagos_cuenta p
       where p.venta_id = v.id and p.tipo = 'cobro'::text
    ) pc on true
   where coalesce(v.anulada, false) = false
     and (v.metodo_pago = 'Crédito'::text or ac.abonos is not null);

-- (2) fn_registrar_pago_cuenta: cobro si Crédito O con abonos de cotización ---
create or replace function public.fn_registrar_pago_cuenta(p_payload jsonb)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_tipo text;
  v_venta record; v_compra record;
  v_monto numeric;
  v_metodo text;
  v_cuenta text;
  v_abonos_cotiz numeric := 0;
  v_pagos numeric := 0;
  v_saldo numeric;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  v_rol := (select get_my_rol());
  if v_rol <> 'Admin' then
    raise exception 'Solo el administrador puede registrar cobros/pagos';
  end if;

  v_tipo   := p_payload->>'tipo';
  v_monto  := coalesce(nullif(p_payload->>'monto','')::numeric, 0);
  v_metodo := nullif(trim(p_payload->>'metodo_pago'),'');
  v_cuenta := nullif(trim(p_payload->>'cuenta_bancaria'),'');

  if v_monto <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;
  if v_metodo is null then raise exception 'Falta el método de pago'; end if;
  if v_metodo in ('Transferencia','Tarjeta') and v_cuenta is null then
    raise exception 'Indica la cuenta bancaria para pagos electrónicos';
  end if;

  if v_tipo = 'cobro' then
    select * into v_venta from ventas where id = (p_payload->>'venta_id')::uuid;
    if not found then raise exception 'Venta no encontrada'; end if;
    if coalesce(v_venta.anulada, false) then raise exception 'La venta está anulada'; end if;

    select coalesce(sum(a.monto),0) into v_abonos_cotiz
      from abonos_cotizacion a join cotizaciones c on c.id = a.cotizacion_id
      where c.venta_id = v_venta.id;

    -- Reconciliación desacoplada de metodo_pago: se admite cobro si la venta es a
    -- crédito O si tiene abonos de cotización (venta convertida con saldo).
    if v_venta.metodo_pago is distinct from 'Crédito' and v_abonos_cotiz <= 0 then
      raise exception 'La venta no admite cobros (no es a crédito ni tiene abonos de cotización)';
    end if;

    select coalesce(sum(p.monto),0) into v_pagos
      from pagos_cuenta p where p.venta_id = v_venta.id and p.tipo = 'cobro';
    v_saldo := coalesce(v_venta.total,0) - v_abonos_cotiz - v_pagos;
    if v_monto > v_saldo + 0.01 then
      raise exception 'El monto (%) supera el saldo pendiente (%)', v_monto, v_saldo;
    end if;
    insert into pagos_cuenta (tipo, venta_id, monto, metodo_pago, cuenta_bancaria, observaciones, registrado_por)
    values ('cobro', v_venta.id, v_monto, v_metodo, v_cuenta, nullif(trim(p_payload->>'observaciones'),''), v_uid);
    return v_saldo - v_monto;

  elsif v_tipo = 'pago' then
    select * into v_compra from compras where id = (p_payload->>'compra_id')::uuid;
    if not found then raise exception 'Compra no encontrada'; end if;
    if v_compra.estado = 'cancelada' then raise exception 'La compra está cancelada'; end if;
    if v_compra.metodo_pago is distinct from 'Crédito' then
      raise exception 'La compra no es a crédito';
    end if;
    select coalesce(sum(p.monto),0) into v_pagos
      from pagos_cuenta p where p.compra_id = v_compra.id and p.tipo = 'pago';
    v_saldo := coalesce(v_compra.total,0) - v_pagos;
    if v_monto > v_saldo + 0.01 then
      raise exception 'El monto (%) supera el saldo pendiente (%)', v_monto, v_saldo;
    end if;
    insert into pagos_cuenta (tipo, compra_id, monto, metodo_pago, cuenta_bancaria, observaciones, registrado_por)
    values ('pago', v_compra.id, v_monto, v_metodo, v_cuenta, nullif(trim(p_payload->>'observaciones'),''), v_uid);
    return v_saldo - v_monto;
  else
    raise exception 'tipo inválido (cobro|pago)';
  end if;
end $function$;
