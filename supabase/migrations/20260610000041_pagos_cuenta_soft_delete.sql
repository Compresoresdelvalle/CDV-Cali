-- MEDIO (auditoría 2026-06-09, M15): fn_eliminar_pago_cuenta borraba FÍSICAMENTE un
-- registro financiero (cobro/pago) sin soft-delete, sin auditoría y sin lock,
-- destruyendo el rastro (quién, cuánto, método, cuenta bancaria) — contra el
-- principio append-only del proyecto.
--
-- Fix: (1) columnas de anulación en pagos_cuenta; (2) fn_eliminar_pago_cuenta pasa a
-- ANULAR (soft-delete, con FOR UPDATE y auditoría); (3) trigger que impide DELETE
-- físico; (4) excluir anulados en todos los SELECT de saldo (vistas v_cuentas_*,
-- fn_registrar_pago_cuenta). El frontend (PagoCuentaModal, VentaDetalle) filtra
-- anulado=false aparte. Tabla vacía hoy (pre-producción): sin backfill.

alter table public.pagos_cuenta
  add column if not exists anulado boolean not null default false,
  add column if not exists anulado_por uuid,
  add column if not exists anulado_en timestamptz,
  add column if not exists motivo_anulacion text;

-- (2) Anulación en vez de DELETE físico --------------------------------------------
create or replace function public.fn_eliminar_pago_cuenta(p_id bigint, p_motivo text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_anulado boolean;
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  if (select get_my_rol()) <> 'Admin' then
    raise exception 'Solo el administrador puede anular pagos';
  end if;

  select anulado into v_anulado from pagos_cuenta where id = p_id for update;
  if not found then raise exception 'Pago no encontrado'; end if;
  if v_anulado then raise exception 'El pago ya está anulado'; end if;

  update pagos_cuenta
     set anulado = true,
         anulado_por = auth.uid(),
         anulado_en = now(),
         motivo_anulacion = nullif(trim(coalesce(p_motivo,'')),'')
   where id = p_id;
end $function$;

-- (3) Bloquear DELETE físico (reutiliza el guardián genérico).
drop trigger if exists trg_no_delete_pagos_cuenta on public.pagos_cuenta;
create trigger trg_no_delete_pagos_cuenta before delete on public.pagos_cuenta
  for each row execute function public.trg_prevent_delete();

-- (4a) v_cuentas_por_cobrar: excluir cobros anulados -------------------------------
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
         and coalesce(p.anulado, false) = false
    ) pc on true
   where coalesce(v.anulada, false) = false
     and (v.metodo_pago = 'Crédito'::text or ac.abonos is not null);

-- (4b) v_cuentas_por_pagar: excluir pagos anulados ---------------------------------
create or replace view public.v_cuentas_por_pagar as
  select c.id as compra_id,
         c.numero,
         c.fecha,
         c.proveedor,
         c.sede_destino_id,
         c.estado,
         coalesce(c.total, 0::numeric) as total,
         coalesce(pc.pagos, 0::numeric) as pagos,
         coalesce(c.total, 0::numeric) - coalesce(pc.pagos, 0::numeric) as saldo
    from compras c
    left join lateral (
      select sum(p.monto) as pagos
        from pagos_cuenta p
       where p.compra_id = c.id and p.tipo = 'pago'::text
         and coalesce(p.anulado, false) = false
    ) pc on true
   where c.metodo_pago = 'Crédito'::text and c.estado <> 'cancelada'::estado_compra;

-- (4c) fn_registrar_pago_cuenta: excluir anulados en el cálculo de saldo -----------
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

    if v_venta.metodo_pago is distinct from 'Crédito' and v_abonos_cotiz <= 0 then
      raise exception 'La venta no admite cobros (no es a crédito ni tiene abonos de cotización)';
    end if;

    select coalesce(sum(p.monto),0) into v_pagos
      from pagos_cuenta p
     where p.venta_id = v_venta.id and p.tipo = 'cobro' and coalesce(p.anulado,false) = false;
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
      from pagos_cuenta p
     where p.compra_id = v_compra.id and p.tipo = 'pago' and coalesce(p.anulado,false) = false;
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
