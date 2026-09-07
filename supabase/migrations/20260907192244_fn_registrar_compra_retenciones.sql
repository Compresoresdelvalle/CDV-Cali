-- fn_registrar_compra guarda los tres porcentajes de retencion.
--
-- La empresa como agente retenedor: cuando le compra a un proveedor pequeno le
-- descuenta la retencion de la factura y la consigna ella misma a la DIAN.
--
-- Los tres parametros van AL FINAL de la firma y con default 0, asi que la
-- llamada que hace hoy CompraNueva sigue siendo valida y esta migracion puede
-- quedar en produccion antes que el frontend sin romper nada.
--
-- Solo se guardan PORCENTAJES. Los valores los calcula la base, porque desde la
-- migracion anterior retefuente_valor, reteica_valor, reteiva_valor y
-- retenciones_total son columnas generadas.

-- OJO: agregar parametros crea una SOBRECARGA, no reemplaza. Si la firma de 10
-- argumentos se quedara viva, una llamada por nombre desde PostgREST podria
-- coincidir con las dos y fallar con "function is not unique" en tiempo de
-- ejecucion, sin que build ni lint digan nada. Por eso se baja primero.
drop function if exists public.fn_registrar_compra(
  text, text, text, text, boolean, jsonb, numeric, text, text, numeric);

create function public.fn_registrar_compra(
  p_sede_id text,
  p_proveedor text,
  p_factura_proveedor text default null::text,
  p_observaciones text default null::text,
  p_recibir boolean default false,
  p_items jsonb default '[]'::jsonb,
  p_iva_pct numeric default 19,
  p_metodo_pago text default 'Efectivo'::text,
  p_cuenta_bancaria text default null::text,
  p_descuento_valor numeric default null::numeric,
  p_retefuente_pct numeric default 0,
  p_reteica_pct numeric default 0,
  p_reteiva_pct numeric default 0
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_usuario_id uuid;
  v_mi_sede    text;
  v_mi_rol     text;
  v_compra_id  uuid;
  v_numero     int;
  item         jsonb;
  v_prod_id    uuid;
  v_cantidad   integer;
  v_costo      numeric;
  v_destino    text;
  v_subtotal   numeric := 0;
  v_desc       numeric;
  v_iva_pct    numeric;
  v_iva        numeric;
  v_total      numeric;
  v_metodo     text;
  v_rf         numeric;
  v_ri         numeric;
  v_riva       numeric;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La compra debe tener al menos un ítem';
  end if;

  v_usuario_id := auth.uid();
  if v_usuario_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  select sede_id, rol::text into v_mi_sede, v_mi_rol
    from usuarios where id = v_usuario_id;

  if v_mi_rol not in ('Admin', 'Bodeguero', 'Vendedor') then
    raise exception 'No tienes permiso para registrar compras';
  end if;
  if v_mi_rol <> 'Admin' and v_mi_sede is distinct from p_sede_id then
    raise exception 'No puedes registrar compras en una sede distinta a la tuya';
  end if;
  if p_proveedor is null or trim(p_proveedor) = '' then
    raise exception 'El proveedor es obligatorio';
  end if;

  v_metodo := coalesce(nullif(trim(p_metodo_pago), ''), 'Efectivo');
  if v_metodo not in ('Efectivo', 'Transferencia', 'Tarjeta', 'Crédito') then
    raise exception 'Método de pago inválido (%)', v_metodo;
  end if;

  -- S6-I: cuenta bancaria obligatoria para pagos electrónicos (espeja S1-10 de fn_registrar_venta)
  if v_metodo in ('Transferencia', 'Tarjeta')
     and nullif(trim(coalesce(p_cuenta_bancaria, '')), '') is null then
    raise exception 'Indica la cuenta bancaria para pagos con % (Transferencia o Tarjeta).', v_metodo;
  end if;

  v_iva_pct := greatest(0, least(100, coalesce(p_iva_pct, 19)));

  -- Retenciones: la empresa como agente retenedor. Se recortan a [0,100] igual
  -- que el CHECK de la tabla, para no mandar nunca algo que el servidor vaya a
  -- rechazar con un mensaje de constraint. Los VALORES no se calculan aqui: las
  -- columnas de compras son generadas.
  v_rf   := greatest(0, least(100, coalesce(p_retefuente_pct, 0)));
  v_ri   := greatest(0, least(100, coalesce(p_reteica_pct, 0)));
  v_riva := greatest(0, least(100, coalesce(p_reteiva_pct, 0)));

  for item in select * from jsonb_array_elements(p_items) loop
    v_prod_id  := (item->>'producto_id')::uuid;
    v_cantidad := (item->>'cantidad')::integer;
    v_costo    := (item->>'costo_unitario')::numeric;
    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cantidad inválida para el producto %', v_prod_id;
    end if;
    if v_costo is null or v_costo < 0 then
      raise exception 'Costo inválido para el producto %', v_prod_id;
    end if;
    if not exists (select 1 from productos where id = v_prod_id and activo = true) then
      raise exception 'Producto % no encontrado o inactivo', v_prod_id;
    end if;
    v_subtotal := v_subtotal + v_cantidad * v_costo;
  end loop;

  v_desc  := greatest(0, least(coalesce(p_descuento_valor, 0), v_subtotal));
  v_iva   := round((v_subtotal - v_desc) * v_iva_pct / 100, 0);
  v_total := round((v_subtotal - v_desc) + v_iva);

  insert into compras (
    proveedor, registrado_por, sede_destino_id, subtotal, iva, iva_pct, total,
    factura_proveedor, observaciones, recibida,
    metodo_pago, cuenta_bancaria, descuento_valor,
    retefuente_pct, reteica_pct, reteiva_pct
  ) values (
    trim(p_proveedor), v_usuario_id, p_sede_id, v_subtotal, v_iva, v_iva_pct, v_total,
    nullif(trim(coalesce(p_factura_proveedor, '')), ''),
    nullif(trim(coalesce(p_observaciones, '')), ''),
    false,
    v_metodo,
    case when v_metodo in ('Transferencia', 'Tarjeta')
      then nullif(trim(coalesce(p_cuenta_bancaria, '')), '') else null end,
    nullif(v_desc, 0),
    v_rf, v_ri, v_riva
  ) returning id, numero into v_compra_id, v_numero;

  for item in select * from jsonb_array_elements(p_items) loop
    v_prod_id  := (item->>'producto_id')::uuid;
    v_cantidad := (item->>'cantidad')::integer;
    v_costo    := (item->>'costo_unitario')::numeric;
    v_destino  := lower(coalesce(nullif(trim(item->>'destino'), ''), 'venta'));
    if v_destino not in ('venta', 'insumo') then
      v_destino := 'venta';
    end if;
    insert into detalle_compra (compra_id, producto_id, cantidad, costo_unitario, subtotal, destino)
    values (v_compra_id, v_prod_id, v_cantidad, v_costo, v_cantidad * v_costo, v_destino);
  end loop;

  if p_recibir then
    -- S6 pendiente #3: este UPDATE de recepción es legítimo (lo hace el sistema),
    -- así que enciende el flag para pasar trg_compra_proteger_materiales.
    perform set_config('cdv.compra_admin', 'on', true);
    update compras set recibida = true, fecha_recepcion = now()
     where id = v_compra_id;
    perform set_config('cdv.compra_admin', '', true);
  end if;

  return jsonb_build_object(
    'compra_id', v_compra_id, 'numero', v_numero,
    'subtotal', v_subtotal, 'iva_pct', v_iva_pct, 'iva', v_iva, 'total', v_total,
    'recibida', p_recibir
  );
end;
$function$;

-- Al bajar y volver a crear la funcion se pierden sus GRANTs, y el default del
-- esquema se los regala a PUBLIC y a `anon`. La firma vieja tenia EXECUTE solo
-- para postgres, authenticated y service_role. Se repone exactamente eso: una
-- funcion SECURITY DEFINER ejecutable por `anon` seria un agujero, porque corre
-- con los derechos del dueno y solo se defiende con el auth.uid() de adentro.
revoke all on function public.fn_registrar_compra(
  text, text, text, text, boolean, jsonb, numeric, text, text, numeric,
  numeric, numeric, numeric) from public, anon;
grant execute on function public.fn_registrar_compra(
  text, text, text, text, boolean, jsonb, numeric, text, text, numeric,
  numeric, numeric, numeric) to authenticated, service_role;
