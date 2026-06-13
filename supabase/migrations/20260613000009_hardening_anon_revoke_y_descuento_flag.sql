-- Paso 9 (parte 1) — RLS-09 + RLS-04 (MEDIA)
--
-- RLS-09: ~38 funciones SECURITY DEFINER tenían EXECUTE para anon (vía grant explícito o el
--   default PUBLIC). Aunque cada una valida auth.uid() por dentro, es superficie innecesaria
--   (la app no llama RPC como anon; el login usa Supabase Auth + lectura de `usuarios`).
--   Fix: revocar EXECUTE a anon/PUBLIC de TODAS las funciones SECURITY DEFINER de public,
--   excepto get_my_rol/get_my_sede_id (se usan dentro de políticas RLS y son inocuas para
--   anon → devuelven NULL). Se re-otorga a authenticated/service_role para no romper la app.
--
-- RLS-04: trg_usuarios_inmutables bloquea a un no-admin cambiar rol/sede_id/activo de su fila,
--   pero NO puede_descuento_alto → un Vendedor podía auto-activarse el permiso de descuento.
--   Fix: añadir puede_descuento_alto a las columnas inmutables para no-admin.
--   (El tope de descuento server-side que USARÍA este flag = RLS-05, queda pendiente de que
--    el cliente defina el límite.)

-- ── RLS-09: revocar anon/PUBLIC de las SECURITY DEFINER (salvo helpers de RLS) ─────
do $$
declare r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
      and p.proname not in ('get_my_rol', 'get_my_sede_id')
  loop
    execute format('revoke execute on function public.%I(%s) from anon, public;', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to authenticated, service_role;', r.proname, r.args);
  end loop;
end $$;

-- ── RLS-04: puede_descuento_alto inmutable para no-admin ──────────────────────────
create or replace function public.trg_usuarios_inmutables()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE v_rol_actor TEXT;
BEGIN
  -- Anti-lockout: nadie (ni un Admin) puede desactivar su propio usuario.
  IF NEW.activo = false
     AND COALESCE(OLD.activo, true) = true
     AND NEW.id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes desactivar tu propio usuario (evita el lockout del panel)';
  END IF;

  SELECT rol::TEXT INTO v_rol_actor FROM usuarios WHERE id = auth.uid();
  IF v_rol_actor = 'Admin' THEN
    RETURN NEW;  -- Admin puede cambiar todo lo demás
  END IF;
  IF NEW.rol IS DISTINCT FROM OLD.rol
     OR NEW.sede_id IS DISTINCT FROM OLD.sede_id
     OR NEW.activo IS DISTINCT FROM OLD.activo
     OR NEW.puede_descuento_alto IS DISTINCT FROM OLD.puede_descuento_alto THEN
    RAISE EXCEPTION 'No tienes permiso para modificar rol, sede, estado activo o permiso de descuento';
  END IF;
  RETURN NEW;
END;
$function$;
