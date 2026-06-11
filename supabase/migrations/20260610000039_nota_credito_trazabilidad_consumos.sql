-- MEDIO (auditoría 2026-06-09, M14): fn_consumir_nota_credito decrementa
-- saldo_restante pero NO registraba dónde/para qué se consumió ni dejaba rastro
-- (no hay forma de reconstruir el histórico ni de revertir). La función viva ya
-- toma FOR UPDATE y valida monto<=saldo; el gap es la trazabilidad.
--
-- Fix: (1) tabla append-only notas_credito_consumos (nota, compra opcional, monto,
-- quién, cuándo); (2) fn_consumir_nota_credito registra cada consumo allí (se le
-- agregan params opcionales p_compra_id / p_observaciones; no había callers que
-- romper); (3) CHECK saldo_restante BETWEEN 0 AND monto como red de seguridad.

-- (1) Tabla append-only de consumos ----------------------------------------------
create table if not exists public.notas_credito_consumos (
  id             bigint generated always as identity primary key,
  nota_id        uuid not null references public.notas_credito_proveedor(id),
  compra_id      uuid references public.compras(id),
  monto          numeric not null check (monto > 0),
  registrado_por uuid,
  observaciones  text,
  created_at     timestamptz not null default now()
);

alter table public.notas_credito_consumos enable row level security;

drop policy if exists ncc_select on public.notas_credito_consumos;
create policy ncc_select on public.notas_credito_consumos
  for select to authenticated
  using ((select get_my_rol()) = any (array['Admin','Bodeguero']));
-- Escritura solo vía la función SECURITY DEFINER (propiedad de postgres, bypassa RLS).

-- Append-only (reutiliza los guardianes genéricos de movimientos).
drop trigger if exists trg_no_delete_ncc on public.notas_credito_consumos;
create trigger trg_no_delete_ncc before delete on public.notas_credito_consumos
  for each row execute function public.trg_prevent_delete();
drop trigger if exists trg_no_update_ncc on public.notas_credito_consumos;
create trigger trg_no_update_ncc before update on public.notas_credito_consumos
  for each row execute function public.trg_no_update_movimiento();

-- (2) fn_consumir_nota_credito con registro de consumo ----------------------------
-- Se reemplaza la firma de 2 args por una de 4 (2 con default). No hay callers de la
-- versión vieja, así que se elimina para evitar ambigüedad de overload.
drop function if exists public.fn_consumir_nota_credito(uuid, numeric);

create or replace function public.fn_consumir_nota_credito(
  p_nota_id uuid,
  p_monto numeric,
  p_compra_id uuid default null,
  p_observaciones text default null
)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT;
  v_saldo NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol NOT IN ('Admin','Bodeguero') THEN
    RAISE EXCEPTION 'No tienes permiso';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser positivo';
  END IF;

  SELECT saldo_restante INTO v_saldo FROM notas_credito_proveedor
    WHERE id = p_nota_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nota crédito no encontrada'; END IF;
  IF p_monto > v_saldo THEN
    RAISE EXCEPTION 'El monto excede el saldo restante (%) de la nota crédito', v_saldo;
  END IF;

  UPDATE notas_credito_proveedor
     SET saldo_restante = saldo_restante - p_monto
   WHERE id = p_nota_id;

  INSERT INTO notas_credito_consumos (nota_id, compra_id, monto, registrado_por, observaciones)
  VALUES (p_nota_id, p_compra_id, p_monto, v_uid, nullif(trim(coalesce(p_observaciones,'')),''));

  RETURN v_saldo - p_monto;
END $function$;

-- (3) Red de seguridad: el saldo nunca fuera de [0, monto] ------------------------
alter table public.notas_credito_proveedor
  add constraint notas_credito_saldo_rango check (saldo_restante >= 0 and saldo_restante <= monto);
