-- TAREA B (revisión de problemas, Sección 11): mejorar fn_upsert_cliente.
-- 1) La rama que empareja por IDENTIFICACIÓN antes hacía RETURN sin actualizar nada;
--    ahora completa teléfono/email/dirección con COALESCE (solo llena lo que está NULL,
--    nunca pisa datos existentes), igual que la rama por nombre.
-- 2) Deduplicación por escritura: al buscar por nombre se normaliza colapsando espacios
--    internos múltiples y recortando (regexp_replace(...,'\s+',' ','g')) + case-insensitive,
--    para que "PRO  ESTIBAS" (doble espacio) empareje con "PRO ESTIBAS".
--    DECISIÓN: NO se quitan TODOS los espacios. "PROESTIBAS" (sin espacio) vs "PRO ESTIBAS"
--    (con espacio) se dejan como clientes distintos a propósito: colapsar a cero espacios
--    tiene alto riesgo de falsos positivos (fusionaría "LA CASA" con "LACASA", nombres
--    cortos genéricos, etc.) y este upsert fusiona registros de forma irreversible en caliente.
--    Se limita a colapsar espacios repetidos, que es seguro.
-- Firma sin cambios (no rompe ACL ni llamadas existentes).

CREATE OR REPLACE FUNCTION public.fn_upsert_cliente(p_nombre text, p_identificacion text DEFAULT NULL::text, p_telefono text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_direccion text DEFAULT NULL::text)
 RETURNS public.clientes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cliente public.clientes;
  v_nombre  text := nullif(btrim(p_nombre), '');
  v_ident   text := nullif(btrim(p_identificacion), '');
  v_tel     text := nullif(btrim(p_telefono), '');
  v_email   text := nullif(btrim(p_email), '');
  v_dir     text := nullif(btrim(p_direccion), '');
  v_nombre_norm text;
begin
  if auth.uid() is null then
    raise exception 'Usuario no autenticado';
  end if;

  if v_nombre is null then
    raise exception 'El nombre del cliente es obligatorio';
  end if;

  -- Nombre normalizado: recorta y colapsa espacios internos múltiples, minúsculas.
  v_nombre_norm := lower(regexp_replace(v_nombre, '\s+', ' ', 'g'));

  -- 1) Coincidencia por identificación: ahora TAMBIÉN completa los campos vacíos.
  if v_ident is not null then
    select * into v_cliente
      from public.clientes
     where identificacion = v_ident and activo
     limit 1;
    if found then
      update public.clientes set
        identificacion = coalesce(identificacion, v_ident),
        telefono       = coalesce(telefono, v_tel),
        email          = coalesce(email, v_email),
        direccion      = coalesce(direccion, v_dir),
        updated_at     = now()
      where id = v_cliente.id
      returning * into v_cliente;
      return v_cliente;
    end if;
  end if;

  -- 2) Coincidencia por nombre normalizado (espacios colapsados, case-insensitive).
  select * into v_cliente
    from public.clientes
   where activo
     and lower(regexp_replace(btrim(nombre), '\s+', ' ', 'g')) = v_nombre_norm
     and (identificacion is null or v_ident is null or identificacion = v_ident)
   order by (identificacion is null), created_at asc
   limit 1;
  if found then
    update public.clientes set
      identificacion = coalesce(identificacion, v_ident),
      telefono       = coalesce(telefono, v_tel),
      email          = coalesce(email, v_email),
      direccion      = coalesce(direccion, v_dir),
      updated_at     = now()
    where id = v_cliente.id
    returning * into v_cliente;
    return v_cliente;
  end if;

  -- 3) Cliente nuevo.
  insert into public.clientes (nombre, identificacion, telefono, email, direccion)
  values (v_nombre, v_ident, v_tel, v_email, v_dir)
  returning * into v_cliente;

  return v_cliente;
end;
$function$;
