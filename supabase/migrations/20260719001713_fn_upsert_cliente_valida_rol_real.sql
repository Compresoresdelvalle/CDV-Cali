-- H3: la policy clientes_insert (WITH CHECK rol IN ('Admin','Vendedor','Bodeguero')) es INERTE:
-- el unico camino de alta es fn_upsert_cliente, que es SECURITY DEFINER con owner postgres
-- (BYPASSRLS) y clientes NO tiene FORCE ROW LEVEL SECURITY, asi que la RPC ignora la policy.
-- Se hace el control real validando el rol DENTRO de la funcion.
--
-- Roles permitidos: Admin, Vendedor, Bodeguero (igual que la policy). El Tecnico queda fuera
-- porque no tiene ningun flujo legitimo de alta de clientes: los tres unicos llamadores de
-- upsertCliente en el frontend (VentaNueva.jsx, OrdenNueva.jsx, CotizacionNueva.jsx) estan
-- protegidos por RoleGuard roles={["Admin","Vendedor"]}. OrdenDetalle.jsx importa ClientePicker
-- pero nunca llama a upsertCliente, asi que el Tecnico no pierde nada.

CREATE OR REPLACE FUNCTION public.fn_upsert_cliente(
  p_nombre text,
  p_identificacion text DEFAULT NULL::text,
  p_telefono text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text,
  p_direccion text DEFAULT NULL::text
)
 RETURNS clientes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cliente public.clientes;
  v_rol     text;
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

  -- Control de rol REAL (la policy RLS no aplica dentro de esta funcion).
  v_rol := public.get_my_rol();
  if v_rol is null or v_rol not in ('Admin', 'Vendedor', 'Bodeguero') then
    raise exception 'Tu rol (%) no tiene permiso para crear o modificar clientes',
      coalesce(v_rol, 'desconocido');
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
