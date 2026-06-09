-- Bloque 10 — Cuentas por cobrar (ventas a crédito) y por pagar (compras a
-- crédito). Ledger de abonos/pagos contra una venta (cobro) o una compra (pago).
-- El saldo de una CxC descuenta además los abonos de cotización vinculados (B4).
-- Solo el Admin registra/elimina cobros y pagos; la lectura está scoped por sede
-- para que el vendedor vea el saldo de las ventas de su sede en el detalle.

create table if not exists public.pagos_cuenta (
  id              bigint generated always as identity primary key,
  tipo            text not null check (tipo in ('cobro','pago')),
  venta_id        uuid references public.ventas(id) on delete cascade,
  compra_id       uuid references public.compras(id) on delete cascade,
  monto           numeric not null check (monto > 0),
  metodo_pago     text not null,
  cuenta_bancaria text,
  fecha           timestamptz not null default now(),
  observaciones   text,
  registrado_por  uuid not null references public.usuarios(id),
  created_at      timestamptz not null default now(),
  constraint pagos_cuenta_xor check ((venta_id is not null) <> (compra_id is not null)),
  constraint pagos_cuenta_tipo_ref check (
    (tipo = 'cobro' and venta_id is not null) or
    (tipo = 'pago'  and compra_id is not null)
  )
);

create index if not exists idx_pagos_cuenta_venta  on public.pagos_cuenta(venta_id)  where venta_id is not null;
create index if not exists idx_pagos_cuenta_compra on public.pagos_cuenta(compra_id) where compra_id is not null;

alter table public.pagos_cuenta enable row level security;

-- Lectura: Admin todo; vendedor/bodeguero ve cobros de ventas de su sede.
drop policy if exists pagos_cuenta_read on public.pagos_cuenta;
create policy pagos_cuenta_read on public.pagos_cuenta
  for select
  using (
    (select get_my_rol()) = 'Admin'
    or (
      venta_id is not null
      and exists (
        select 1 from public.ventas v
        where v.id = pagos_cuenta.venta_id
          and v.sede_id = (select get_my_sede_id())
      )
    )
  );

-- Inserción/borrado: solo Admin (las escrituras reales van por la función SECURITY DEFINER).
drop policy if exists pagos_cuenta_insert on public.pagos_cuenta;
create policy pagos_cuenta_insert on public.pagos_cuenta
  for insert
  with check ((select get_my_rol()) = 'Admin' and registrado_por = auth.uid());

drop policy if exists pagos_cuenta_delete on public.pagos_cuenta;
create policy pagos_cuenta_delete on public.pagos_cuenta
  for delete
  using ((select get_my_rol()) = 'Admin');

grant select, insert, delete on public.pagos_cuenta to authenticated;

-- ── Registrar un cobro (CxC) o pago (CxP). Valida saldo (no sobrepago) ──────
create or replace function public.fn_registrar_pago_cuenta(p_payload jsonb)
returns numeric
language plpgsql
security definer
set search_path to 'public','pg_temp'
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
    if v_venta.metodo_pago is distinct from 'Crédito' then
      raise exception 'La venta no es a crédito';
    end if;
    select coalesce(sum(a.monto),0) into v_abonos_cotiz
      from abonos_cotizacion a join cotizaciones c on c.id = a.cotizacion_id
      where c.venta_id = v_venta.id;
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

grant execute on function public.fn_registrar_pago_cuenta(jsonb) to authenticated;

-- ── Eliminar un cobro/pago (corregir errores) — solo Admin ──────────────────
create or replace function public.fn_eliminar_pago_cuenta(p_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'Usuario no autenticado'; end if;
  if (select get_my_rol()) <> 'Admin' then
    raise exception 'Solo el administrador puede eliminar pagos';
  end if;
  delete from pagos_cuenta where id = p_id;
end $function$;

grant execute on function public.fn_eliminar_pago_cuenta(bigint) to authenticated;

-- Quitar EXECUTE por defecto a anon/public (solo Admin autenticado).
revoke execute on function public.fn_registrar_pago_cuenta(jsonb) from public, anon;
revoke execute on function public.fn_eliminar_pago_cuenta(bigint) from public, anon;

-- ── Vistas de saldo (RLS-respecting via security_invoker) ───────────────────
drop view if exists public.v_cuentas_por_cobrar;
create view public.v_cuentas_por_cobrar
with (security_invoker = on) as
select
  v.id              as venta_id,
  v.numero,
  v.fecha,
  v.cliente_nombre,
  v.sede_id,
  v.vendedor_id,
  coalesce(v.total,0)    as total,
  coalesce(ac.abonos,0)  as abonos_cotizacion,
  coalesce(pc.pagos,0)   as pagos_directos,
  (coalesce(v.total,0) - coalesce(ac.abonos,0) - coalesce(pc.pagos,0)) as saldo
from ventas v
left join lateral (
  select sum(a.monto) as abonos
  from abonos_cotizacion a join cotizaciones c on c.id = a.cotizacion_id
  where c.venta_id = v.id
) ac on true
left join lateral (
  select sum(p.monto) as pagos
  from pagos_cuenta p where p.venta_id = v.id and p.tipo = 'cobro'
) pc on true
where v.metodo_pago = 'Crédito' and coalesce(v.anulada, false) = false;

drop view if exists public.v_cuentas_por_pagar;
create view public.v_cuentas_por_pagar
with (security_invoker = on) as
select
  c.id              as compra_id,
  c.numero,
  c.fecha,
  c.proveedor,
  c.sede_destino_id,
  c.estado,
  coalesce(c.total,0)  as total,
  coalesce(pc.pagos,0) as pagos,
  (coalesce(c.total,0) - coalesce(pc.pagos,0)) as saldo
from compras c
left join lateral (
  select sum(p.monto) as pagos
  from pagos_cuenta p where p.compra_id = c.id and p.tipo = 'pago'
) pc on true
where c.metodo_pago = 'Crédito' and c.estado <> 'cancelada';

grant select on public.v_cuentas_por_cobrar to authenticated;
grant select on public.v_cuentas_por_pagar to authenticated;
