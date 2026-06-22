-- ============================================================================
-- REQ6 — Permitir borrar conteos PENDIENTES (no aplicados) por error.
-- A nivel RLS ya se podía borrar (política cont_all ALL para Admin/Bodeguero),
-- pero faltaba: (1) blindar que NUNCA se borre un conteo ya aplicado (auditoría)
-- y (2) restringir el borrado a Admin (decisión de negocio). Un trigger BEFORE
-- DELETE lo garantiza a nivel de base, independiente de la UI.
-- ============================================================================

create or replace function public.trg_conteo_proteger_borrado()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
begin
  if coalesce(OLD.ajuste_aplicado, false) then
    raise exception 'No se puede borrar un conteo ya aplicado (#%). Quedaría sin rastro de auditoría.', OLD.id;
  end if;
  if get_my_rol() is distinct from 'Admin' then
    raise exception 'Solo el Admin puede borrar conteos pendientes';
  end if;
  return OLD;
end $$;

drop trigger if exists trg_before_delete_conteo on public.conteos;
create trigger trg_before_delete_conteo
  before delete on public.conteos
  for each row execute function public.trg_conteo_proteger_borrado();
