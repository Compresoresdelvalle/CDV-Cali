-- Bloque 3 (plata que sale a proveedores).
--
-- 3.1 Pagar la compra en partes (decisión de David, 2026-10-17): Nueva Compra
--     puede llevar una lista de pagos (forma, cuenta, monto). La compra queda a
--     Crédito y cada pago entra en pagos_cuenta, que es lo que el cierre ya sabe
--     contar. Sirve a cualquier rol que registre compras, vendedoras incluidas,
--     sin abrirles Cuentas por Pagar.
-- 3.2 Gasto a crédito: la caja menor acepta Crédito y queda en Cuentas por Pagar.
-- 3.3 Pago o cobro con la fecha real: hasta 30 días atrás, nunca a futuro.

-- ── 3.1 ────────────────────────────────────────────────────────────────────
drop function if exists public.fn_registrar_compra(text,text,text,text,boolean,jsonb,numeric,text,text,numeric,numeric,numeric,numeric);

create function public.fn_registrar_compra(
  p_sede_id text, p_proveedor text, p_factura_proveedor text default null,
  p_observaciones text default null, p_recibir boolean default false,
  p_items jsonb default '[]'::jsonb, p_iva_pct numeric default 19,
  p_metodo_pago text default 'Efectivo', p_cuenta_bancaria text default null,
  p_descuento_valor numeric default null, p_retefuente_pct numeric default 0,
  p_reteica_pct numeric default 0, p_reteiva_pct numeric default 0,
  p_pagos jsonb default null   -- [{"metodo_pago":"Efectivo","cuenta_bancaria":null,"monto":60000}, ...]
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
  v_ret        numeric;
  v_pago       jsonb;
  v_p_monto    numeric;
  v_p_metodo   text;
  v_p_cuenta   text;
  v_pagado     numeric := 0;
  v_n_pagos    int := 0;
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

  -- Pagos en partes: la compra es a crédito y los pagos se registran aparte.
  if p_pagos is not null and jsonb_typeof(p_pagos) = 'array' and jsonb_array_length(p_pagos) > 0 then
    if v_metodo <> 'Crédito' then
      raise exception 'Para pagar en partes la compra va a Crédito: cada parte queda como un pago a la compra.';
    end if;
  end if;

  -- S6-I: cuenta bancaria obligatoria para pagos electrónicos (espeja S1-10 de fn_registrar_venta)
  if v_metodo in ('Transferencia', 'Tarjeta')
     and nullif(trim(coalesce(p_cuenta_bancaria, '')), '') is null then
    raise exception 'Indica la cuenta bancaria para pagos con % (Transferencia o Tarjeta).', v_metodo;
  end if;

  v_iva_pct := greatest(0, least(100, coalesce(p_iva_pct, 19)));

  -- Retenciones: la empresa como agente retenedor. Se recortan a [0,100] igual
  -- que el CHECK de la tabla. Los VALORES no se calculan aqui: las columnas de
  -- compras son generadas.
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

  -- Las retenciones no pueden pasarse del total: si se pasaran, el cierre
  -- registraria la compra como un INGRESO.
  v_ret := round(greatest(0, v_subtotal - v_desc) * v_rf / 100)
         + round(greatest(0, v_subtotal - v_desc) * v_ri / 100)
         + round(v_iva * v_riva / 100);
  if v_ret > v_total then
    raise exception 'Las retenciones suman % y el total de la factura es %. Revisa los porcentajes: retefuente y reteICA van sobre la base (subtotal menos descuento) y reteIVA sobre el IVA. Si querias 2,5%% escribe 2,5, no 25.', v_ret, v_total;
  end if;

  -- Validar los pagos antes de escribir nada.
  if p_pagos is not null and jsonb_typeof(p_pagos) = 'array' then
    for v_pago in select * from jsonb_array_elements(p_pagos) loop
      v_p_monto  := coalesce(nullif(v_pago->>'monto','')::numeric, 0);
      v_p_metodo := nullif(trim(coalesce(v_pago->>'metodo_pago','')), '');
      v_p_cuenta := nullif(trim(coalesce(v_pago->>'cuenta_bancaria','')), '');
      if v_p_monto <= 0 then
        raise exception 'Cada pago tiene que ser mayor que 0. Quita el renglón vacío o escribe el monto.';
      end if;
      if v_p_metodo is null or v_p_metodo not in ('Efectivo','Transferencia','Tarjeta') then
        raise exception 'Cada pago es en Efectivo, Transferencia o Tarjeta (llegó %).', coalesce(v_p_metodo, 'vacío');
      end if;
      if v_p_metodo in ('Transferencia','Tarjeta') and v_p_cuenta is null then
        raise exception 'Indica la cuenta bancaria del pago por %.', v_p_metodo;
      end if;
      v_pagado := v_pagado + v_p_monto;
      v_n_pagos := v_n_pagos + 1;
    end loop;
    if v_pagado > (v_total - v_ret) + 0.01 then
      raise exception 'Los pagos suman % y a la compra solo se le deben % (total % menos retenciones %). Revisa los montos.',
        v_pagado, v_total - v_ret, v_total, v_ret;
    end if;
  end if;

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

  -- Los pagos se registran como pagos a la compra: así los ve Cuentas por
  -- Pagar y el cierre los cuenta por su forma de pago, sin camino nuevo.
  if v_n_pagos > 0 then
    for v_pago in select * from jsonb_array_elements(p_pagos) loop
      v_p_metodo := trim(v_pago->>'metodo_pago');
      insert into pagos_cuenta (tipo, compra_id, monto, metodo_pago, cuenta_bancaria, observaciones, registrado_por)
      values ('pago', v_compra_id, (v_pago->>'monto')::numeric, v_p_metodo,
              case when v_p_metodo in ('Transferencia','Tarjeta')
                   then nullif(trim(coalesce(v_pago->>'cuenta_bancaria','')), '') end,
              'Pagado al registrar la compra', v_usuario_id);
    end loop;
  end if;

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
    'recibida', p_recibir, 'pagado', v_pagado,
    'saldo', case when v_metodo = 'Crédito' then (v_total - v_ret) - v_pagado else 0 end
  );
end;
$function$;

revoke all on function public.fn_registrar_compra(text,text,text,text,boolean,jsonb,numeric,text,text,numeric,numeric,numeric,numeric,jsonb) from public, anon;
grant execute on function public.fn_registrar_compra(text,text,text,text,boolean,jsonb,numeric,text,text,numeric,numeric,numeric,numeric,jsonb) to authenticated, service_role;


-- ── 3.2 Gasto a crédito ───────────────────────────────────────────────────
create or replace function public.fn_registrar_caja_menor(
  p_sede_id text, p_concepto text, p_monto numeric, p_proveedor text default null,
  p_observaciones text default null, p_metodo_pago text default null,
  p_cuenta_bancaria text default null, p_categoria_gasto_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_usuario_id UUID;
  v_mi_sede    TEXT;
  v_mi_rol     TEXT;
  v_compra_id  UUID;
  v_numero     INT;
  v_monto      NUMERIC;
  v_metodo     TEXT;
  v_cuenta     TEXT;
  v_categoria  BIGINT;
BEGIN
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT sede_id, rol::TEXT INTO v_mi_sede, v_mi_rol
    FROM usuarios WHERE id = v_usuario_id;

  IF v_mi_rol NOT IN ('Admin', 'Bodeguero', 'Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar compras';
  END IF;
  IF v_mi_rol <> 'Admin' AND v_mi_sede IS DISTINCT FROM p_sede_id THEN
    RAISE EXCEPTION 'No puedes registrar en una sede distinta a la tuya';
  END IF;

  IF p_concepto IS NULL OR TRIM(p_concepto) = '' THEN
    RAISE EXCEPTION 'El concepto es obligatorio para una compra de caja menor';
  END IF;

  v_monto := ROUND(COALESCE(p_monto, 0), 2);
  IF v_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0';
  END IF;

  -- Una categoria que no existe o esta inactiva se rechaza; una AUSENTE se
  -- acepta y cae a la bandeja de clasificacion.
  IF p_categoria_gasto_id IS NOT NULL THEN
    SELECT id INTO v_categoria
      FROM categorias_gasto WHERE id = p_categoria_gasto_id AND activa = true;
    IF v_categoria IS NULL THEN
      RAISE EXCEPTION 'La categoría de gasto no existe o está inactiva';
    END IF;
  END IF;

  -- S6-E: prioridad parámetro explícito > GUC (S1-21, fn_registrar_cambio) > 'Efectivo'
  v_metodo := public._fn_metodo_pago_canonico(
                COALESCE(NULLIF(TRIM(COALESCE(p_metodo_pago,'')), ''),
                         NULLIF(current_setting('cdv.caja_menor_metodo', true), ''),
                         'Efectivo'));
  -- 3.2: Crédito = gasto que se debe. Queda en Cuentas por Pagar y no toca el
  -- cierre hasta el día en que se paga (todos los sitios del cierre excluyen
  -- metodo_pago = 'Crédito' y cuentan el pago en pagos_cuenta).
  IF v_metodo NOT IN ('Efectivo','Transferencia','Tarjeta','Crédito') THEN
    RAISE EXCEPTION 'Método de pago inválido para caja menor (%)', v_metodo;
  END IF;

  v_cuenta := COALESCE(NULLIF(TRIM(COALESCE(p_cuenta_bancaria,'')), ''),
                       NULLIF(current_setting('cdv.caja_menor_cuenta', true), ''));
  IF v_metodo IN ('Transferencia','Tarjeta') AND v_cuenta IS NULL THEN
    RAISE EXCEPTION 'Indica la cuenta bancaria para pagos con % (Transferencia o Tarjeta).', v_metodo;
  END IF;
  IF v_metodo IN ('Efectivo','Crédito') THEN
    v_cuenta := NULL;
  END IF;

  INSERT INTO compras (
    proveedor, registrado_por, sede_destino_id, subtotal, iva, total,
    factura_proveedor, observaciones, recibida, fecha_recepcion,
    es_caja_menor, concepto, metodo_pago, cuenta_bancaria,
    categoria_gasto_id
  ) VALUES (
    COALESCE(NULLIF(TRIM(COALESCE(p_proveedor, '')), ''), 'Caja menor'),
    v_usuario_id, p_sede_id, v_monto, 0, v_monto,
    NULL,
    NULLIF(TRIM(COALESCE(p_observaciones, '')), ''),
    true, now(),
    true, TRIM(p_concepto), v_metodo, v_cuenta,
    v_categoria
  ) RETURNING id, numero INTO v_compra_id, v_numero;

  RETURN jsonb_build_object(
    'compra_id', v_compra_id, 'numero', v_numero,
    'total', v_monto, 'es_caja_menor', true,
    'metodo_pago', v_metodo, 'cuenta_bancaria', v_cuenta,
    'categoria_gasto_id', v_categoria
  );
END;
$function$;

revoke all on function public.fn_registrar_caja_menor(text,text,numeric,text,text,text,text,bigint) from public, anon;
grant execute on function public.fn_registrar_caja_menor(text,text,numeric,text,text,text,text,bigint) to authenticated, service_role;


-- ── 3.3 Pago o cobro con la fecha real ────────────────────────────────────
create or replace function public.fn_registrar_pago_cuenta(p_payload jsonb)
returns numeric
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_sede text;
  v_tipo text;
  v_venta record; v_compra record;
  v_monto numeric;
  v_metodo text;
  v_cuenta text;
  v_abonos_cotiz numeric := 0;
  v_pagos numeric := 0;
  v_saldo numeric;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_dia date;
  v_fecha timestamptz;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  v_rol  := (select get_my_rol());
  v_sede := (select get_my_sede_id());
  v_tipo := p_payload->>'tipo';

  -- Matriz de rol y tipo. La sede se comprueba mas abajo, cuando ya se sabe a
  -- que sede pertenece la venta o la compra.
  if v_rol not in ('Admin','Vendedor','Bodeguero') then
    raise exception 'No tienes permiso para registrar cobros o pagos';
  end if;
  if v_tipo = 'cobro' and v_rol = 'Bodeguero' then
    raise exception 'Bodega registra pagos a proveedores, no cobros a clientes';
  end if;
  if v_tipo = 'pago' and v_rol = 'Vendedor' then
    raise exception 'Los pagos a proveedores los registra bodega o el administrador';
  end if;

  v_monto  := coalesce(nullif(p_payload->>'monto','')::numeric, 0);
  v_metodo := nullif(trim(p_payload->>'metodo_pago'),'');
  v_cuenta := nullif(trim(p_payload->>'cuenta_bancaria'),'');

  if v_monto <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;
  if v_metodo is null then raise exception 'Falta el método de pago'; end if;
  if v_metodo in ('Transferencia','Tarjeta') and v_cuenta is null then
    raise exception 'Indica la cuenta bancaria para pagos electrónicos';
  end if;

  -- 3.3: el día en que salió o entró la plata. Sin fecha = ahora (como antes).
  v_dia := nullif(trim(coalesce(p_payload->>'fecha','')), '')::date;
  if v_dia is null or v_dia = v_hoy then
    v_fecha := now();
  else
    if v_dia > v_hoy then
      raise exception 'La fecha del pago no puede ser futura. Si todavía no ha salido la plata, regístralo el día que salga.';
    end if;
    if v_dia < v_hoy - 30 then
      raise exception 'Solo se pueden registrar pagos de hasta 30 días atrás (desde el %). Para algo más viejo habla con el administrador.', to_char(v_hoy - 30, 'DD/MM/YYYY');
    end if;
    -- Mediodía en Colombia: cae en ese día en cualquier cierre.
    v_fecha := (v_dia + time '12:00') at time zone 'America/Bogota';
  end if;

  if v_tipo = 'cobro' then
    select * into v_venta from ventas where id = (p_payload->>'venta_id')::uuid for update;
    if not found then raise exception 'Venta no encontrada'; end if;

    if v_rol <> 'Admin' and v_venta.sede_id is distinct from v_sede then
      raise exception 'Solo puedes registrar cobros de ventas de tu propia sede';
    end if;

    if coalesce(v_venta.anulada, false) then raise exception 'La venta está anulada'; end if;
    if v_fecha < v_venta.fecha - interval '1 day' then
      raise exception 'El cobro no puede ser de antes de la venta (%).', to_char(v_venta.fecha at time zone 'America/Bogota', 'DD/MM/YYYY');
    end if;

    select coalesce(sum(a.monto),0) into v_abonos_cotiz
      from abonos_cotizacion a join cotizaciones c on c.id = a.cotizacion_id
      where c.venta_id = v_venta.id;

    if v_venta.metodo_pago is distinct from 'Crédito' and v_abonos_cotiz <= 0 then
      raise exception 'La venta no admite cobros (no es a crédito ni tiene abonos de cotización)';
    end if;

    select coalesce(sum(p.monto),0) into v_pagos
      from pagos_cuenta p
     where p.venta_id = v_venta.id and p.tipo = 'cobro' and coalesce(p.anulado,false) = false;
    -- Lo cobrable es el NETO: la retencion no la paga el cliente, la consigna a
    -- la DIAN. Misma formula que v_cuentas_por_cobrar.saldo.
    v_saldo := coalesce(v_venta.total,0) - coalesce(v_venta.retenciones_total,0)
               - v_abonos_cotiz - v_pagos;
    if v_monto > v_saldo + 0.01 then
      raise exception 'El monto (%) supera el saldo pendiente (%)', v_monto, v_saldo;
    end if;
    insert into pagos_cuenta (tipo, venta_id, monto, metodo_pago, cuenta_bancaria, observaciones, registrado_por, fecha)
    values ('cobro', v_venta.id, v_monto, v_metodo, v_cuenta, nullif(trim(p_payload->>'observaciones'),''), v_uid, v_fecha);
    return v_saldo - v_monto;

  elsif v_tipo = 'pago' then
    select * into v_compra from compras where id = (p_payload->>'compra_id')::uuid for update;
    if not found then raise exception 'Compra no encontrada'; end if;

    if v_rol <> 'Admin' and v_compra.sede_destino_id is distinct from v_sede then
      raise exception 'Solo puedes registrar pagos de compras de tu propia sede';
    end if;

    if v_compra.estado = 'cancelada' then raise exception 'La compra está cancelada'; end if;
    if v_compra.metodo_pago is distinct from 'Crédito' then
      raise exception 'La compra no es a crédito';
    end if;
    -- Un anticipo puede ser de antes de la compra (se pagó y luego llegó la
    -- factura), por eso aquí no se compara con la fecha de la compra.
    select coalesce(sum(p.monto),0) into v_pagos
      from pagos_cuenta p
     where p.compra_id = v_compra.id and p.tipo = 'pago' and coalesce(p.anulado,false) = false;
    v_saldo := coalesce(v_compra.total,0) - coalesce(v_compra.retenciones_total,0) - v_pagos;
    if v_monto > v_saldo + 0.01 then
      raise exception 'El monto (%) supera el saldo pendiente (%)', v_monto, v_saldo;
    end if;
    insert into pagos_cuenta (tipo, compra_id, monto, metodo_pago, cuenta_bancaria, observaciones, registrado_por, fecha)
    values ('pago', v_compra.id, v_monto, v_metodo, v_cuenta, nullif(trim(p_payload->>'observaciones'),''), v_uid, v_fecha);
    return v_saldo - v_monto;
  else
    raise exception 'tipo inválido (cobro|pago)';
  end if;
end $function$;

revoke all on function public.fn_registrar_pago_cuenta(jsonb) from public, anon;
grant execute on function public.fn_registrar_pago_cuenta(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
