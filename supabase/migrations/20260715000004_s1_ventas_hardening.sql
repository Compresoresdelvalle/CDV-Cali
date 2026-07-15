-- ============================================================================
-- Sección 1 (Ventas y pagos) — Endurecimiento de integridad y seguridad
-- Fecha: 2026-07-15
--
-- Fixes incluidos (todos verificados contra la base de producción):
--   S1-01  Blindar ventas/detalle_venta/pagos_venta contra escritura directa
--          por REST (REVOKE INSERT/UPDATE/DELETE a authenticated y anon).
--   S1-10  fn_registrar_venta exige cuenta bancaria en pagos electrónicos.
--   S1-09  fn_registrar_venta exige cliente identificado en ventas a Crédito.
--   S1-23  fn_registrar_venta clampa descuento_valor a [0, subtotal].
--   S1-14  fn_registrar_venta normaliza (canoniza) el metodo_pago al insertar
--          (sin tocar datos legacy; los métodos no reconocidos pasan tal cual,
--          p.ej. 'Abonos OT').
--   S1-07  fn_anular_venta rechaza anular la venta-diferencia de un cambio.
--   S1-13  fn_upsert_cliente pasa a SECURITY DEFINER (para que Vendedor pueda
--          actualizar clientes existentes; antes fallaba en silencio por RLS).
--   S1-21  El reembolso de un cambio a favor del cliente registra el egreso con
--          el método realmente usado (no siempre 'Efectivo'). Se implementa con
--          una señal transaccional (GUC 'cdv.caja_menor_metodo' / '...cuenta'),
--          NO cambiando la firma de fn_registrar_caja_menor (evita sobrecarga y
--          ambigüedad de PostgREST).
--
-- Fixes NO incluidos en esta migración:
--   S1-08  (DIFERIDO) Aviso de cierre desactualizado al anular. Requiere cambiar
--          el tipo de retorno de fn_anular_venta de void a jsonb, lo que obliga a
--          DROP + CREATE (cambio de contrato). Queda documentado para decisión.
--   S1-22  (SIN CAMBIO) Tolerancia de $1 en pago mixto: es redondeo deliberado.
--
-- Reversibilidad: las definiciones ORIGINALES (pre-migración) de cada función
-- reemplazada quedan guardadas como comentario justo antes de su reemplazo.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- S1-01 — Quitar privilegios de escritura directa. Toda escritura pasa por RPCs
-- SECURITY DEFINER cuyo dueño es 'postgres' (rolbypassrls=true, dueño de las
-- tablas), por lo que siguen funcionando. Se conserva SELECT (app + Realtime).
-- ----------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.ventas        FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.detalle_venta FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.pagos_venta   FROM authenticated, anon;


-- ----------------------------------------------------------------------------
-- Helper: canonicaliza el método de pago a su forma estándar.
-- Los métodos desconocidos (p.ej. 'Abonos OT') se devuelven SIN cambios, para
-- no romper flujos que usan valores propios y para no tocar datos legacy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._fn_metodo_pago_canonico(p_metodo text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE lower(btrim(coalesce(p_metodo, '')))
    WHEN 'efectivo'      THEN 'Efectivo'
    WHEN 'transferencia' THEN 'Transferencia'
    WHEN 'tarjeta'       THEN 'Tarjeta'
    WHEN 'crédito'       THEN 'Crédito'
    WHEN 'credito'       THEN 'Crédito'
    WHEN 'mixto'         THEN 'Mixto'
    ELSE p_metodo
  END
$function$;


-- ----------------------------------------------------------------------------
-- fn_registrar_venta — S1-09, S1-10, S1-14, S1-23
--
-- ORIGINAL (pre-migración), para reversibilidad:
/*
CREATE OR REPLACE FUNCTION public.fn_registrar_venta(p_sede_id text, p_cliente_nombre text DEFAULT NULL::text, p_cliente_nit text DEFAULT NULL::text, p_metodo_pago text DEFAULT 'Efectivo'::text, p_descuento_pct numeric DEFAULT 0, p_observaciones text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb, p_iva_pct numeric DEFAULT 19, p_cuenta_bancaria text DEFAULT NULL::text, p_descuento_valor numeric DEFAULT NULL::numeric, p_domicilio numeric DEFAULT 0, p_pagos jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_vendedor_id uuid;
  v_mi_sede     text;
  v_mi_rol      text;
  v_venta_id    uuid;
  v_numero      int;
  v_iva         numeric;
  item          jsonb;
  v_prod_id     uuid;
  v_serv_id     bigint;
  v_serv_nombre text;
  v_serv_precio numeric;
  v_cantidad    numeric;
  v_precio      numeric;
  v_precio_cat  numeric;
  v_precio_in   numeric;
  v_costo       numeric;
  pago          jsonb;
  v_pm          text;
  v_pmonto      numeric;
  v_suma        numeric := 0;
  v_total_real  numeric;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe tener al menos un ítem';
  end if;
  v_vendedor_id := auth.uid();
  if v_vendedor_id is null then
    raise exception 'Usuario no autenticado';
  end if;
  select sede_id, rol::text into v_mi_sede, v_mi_rol
    from usuarios where id = v_vendedor_id;
  if v_mi_rol is null or v_mi_rol not in ('Admin', 'Vendedor') then
    raise exception 'No tienes permiso para registrar ventas (rol %)', coalesce(v_mi_rol, 'desconocido');
  end if;
  if v_mi_rol <> 'Admin' and v_mi_sede is distinct from p_sede_id then
    raise exception 'No puedes vender desde otra sede. Tu sede es %, la sede solicitada es %', v_mi_sede, p_sede_id;
  end if;
  v_iva := greatest(0, least(100, coalesce(p_iva_pct, 19)));
  insert into ventas (
    vendedor_id, sede_id, cliente_nombre, cliente_nit,
    metodo_pago, descuento_pct, descuento_valor, domicilio, iva_pct,
    observaciones, subtotal, total, cuenta_bancaria
  ) values (
    v_vendedor_id, p_sede_id, p_cliente_nombre, p_cliente_nit,
    p_metodo_pago, p_descuento_pct, p_descuento_valor, greatest(0, coalesce(p_domicilio, 0)), v_iva,
    p_observaciones, 0, 0, nullif(btrim(coalesce(p_cuenta_bancaria, '')), '')
  )
  returning id, numero into v_venta_id, v_numero;
  for item in select * from jsonb_array_elements(p_items)
  loop
    v_cantidad := (item->>'cantidad')::numeric;
    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cantidad inválida en un ítem de la venta';
    end if;
    v_precio_in := nullif(item->>'precio_unitario', '')::numeric;
    v_serv_id   := nullif(item->>'servicio_id', '')::bigint;
    if v_serv_id is not null then
      select nombre, precio into v_serv_nombre, v_serv_precio
        from servicios where id = v_serv_id and activo = true;
      if v_serv_nombre is null then
        raise exception 'Servicio % no encontrado o inactivo', v_serv_id;
      end if;
      v_precio := case
        when v_precio_in is not null and v_precio_in >= 0 then v_precio_in
        else v_serv_precio
      end;
      insert into detalle_venta (
        venta_id, producto_id, servicio_id, descripcion,
        cantidad, precio_unitario, costo_unitario, subtotal, precio_catalogo
      ) values (
        v_venta_id, null, v_serv_id, v_serv_nombre,
        v_cantidad, v_precio, 0, v_cantidad * v_precio, v_serv_precio
      );
    else
      v_prod_id := (item->>'producto_id')::uuid;
      select precio_venta, coalesce(costo_promedio, 0)
        into v_precio_cat, v_costo
        from productos where id = v_prod_id and activo = true;
      if v_precio_cat is null then
        raise exception 'Producto % no encontrado o inactivo', v_prod_id;
      end if;
      v_precio := case
        when v_precio_in is not null and v_precio_in >= 0 then v_precio_in
        else v_precio_cat
      end;
      insert into detalle_venta (
        venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal,
        precio_catalogo
      ) values (
        v_venta_id, v_prod_id, v_cantidad, v_precio, v_costo, v_cantidad * v_precio,
        v_precio_cat
      );
    end if;
  end loop;
  if p_pagos is not null and jsonb_array_length(p_pagos) > 0 then
    select total into v_total_real from ventas where id = v_venta_id;
    for pago in select * from jsonb_array_elements(p_pagos)
    loop
      v_pm := btrim(coalesce(pago->>'metodo_pago', ''));
      v_pmonto := round(coalesce((pago->>'monto')::numeric, 0));
      if v_pm = '' then raise exception 'Cada pago debe indicar el método'; end if;
      if v_pmonto <= 0 then raise exception 'Cada pago debe tener un monto mayor a 0'; end if;
      insert into pagos_venta (venta_id, metodo_pago, cuenta_bancaria, monto)
      values (v_venta_id, v_pm, nullif(btrim(coalesce(pago->>'cuenta_bancaria','')), ''), v_pmonto);
      v_suma := v_suma + v_pmonto;
    end loop;
    if abs(v_suma - coalesce(v_total_real,0)) > 1 then
      raise exception 'La suma de los pagos (%) no coincide con el total de la venta (%)', v_suma, v_total_real;
    end if;
    update ventas set metodo_pago = 'Mixto', cuenta_bancaria = null where id = v_venta_id;
  end if;
  return (
    select jsonb_build_object(
      'venta_id', v.id, 'numero', v.numero, 'total', v.total, 'fecha', v.fecha
    ) from ventas v where v.id = v_venta_id
  );
end;
$function$;
*/
CREATE OR REPLACE FUNCTION public.fn_registrar_venta(p_sede_id text, p_cliente_nombre text DEFAULT NULL::text, p_cliente_nit text DEFAULT NULL::text, p_metodo_pago text DEFAULT 'Efectivo'::text, p_descuento_pct numeric DEFAULT 0, p_observaciones text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb, p_iva_pct numeric DEFAULT 19, p_cuenta_bancaria text DEFAULT NULL::text, p_descuento_valor numeric DEFAULT NULL::numeric, p_domicilio numeric DEFAULT 0, p_pagos jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_vendedor_id uuid;
  v_mi_sede     text;
  v_mi_rol      text;
  v_venta_id    uuid;
  v_numero      int;
  v_iva         numeric;
  item          jsonb;
  v_prod_id     uuid;
  v_serv_id     bigint;
  v_serv_nombre text;
  v_serv_precio numeric;
  v_cantidad    numeric;
  v_precio      numeric;
  v_precio_cat  numeric;
  v_precio_in   numeric;
  v_costo       numeric;
  pago          jsonb;
  v_pm          text;
  v_pmonto      numeric;
  v_suma        numeric := 0;
  v_total_real  numeric;
  v_tiene_pagos boolean;
  v_cliente_ok  boolean;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe tener al menos un ítem';
  end if;

  v_vendedor_id := auth.uid();
  if v_vendedor_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  select sede_id, rol::text into v_mi_sede, v_mi_rol
    from usuarios where id = v_vendedor_id;

  if v_mi_rol is null or v_mi_rol not in ('Admin', 'Vendedor') then
    raise exception 'No tienes permiso para registrar ventas (rol %)', coalesce(v_mi_rol, 'desconocido');
  end if;

  if v_mi_rol <> 'Admin' and v_mi_sede is distinct from p_sede_id then
    raise exception 'No puedes vender desde otra sede. Tu sede es %, la sede solicitada es %', v_mi_sede, p_sede_id;
  end if;

  v_tiene_pagos := p_pagos is not null and jsonb_array_length(p_pagos) > 0;
  v_cliente_ok  := nullif(btrim(coalesce(p_cliente_nombre, '')), '') is not null;

  -- S1-10 / S1-09: validaciones del método simple (solo cuando NO hay pagos múltiples).
  if not v_tiene_pagos then
    if lower(btrim(coalesce(p_metodo_pago, ''))) in ('transferencia', 'tarjeta')
       and nullif(btrim(coalesce(p_cuenta_bancaria, '')), '') is null then
      raise exception 'Indica la cuenta bancaria para pagos con % (Transferencia o Tarjeta).', p_metodo_pago;
    end if;
    if lower(btrim(coalesce(p_metodo_pago, ''))) in ('crédito', 'credito')
       and not v_cliente_ok then
      raise exception 'Una venta a crédito necesita un cliente identificado para poder cobrarla.';
    end if;
  end if;

  v_iva := greatest(0, least(100, coalesce(p_iva_pct, 19)));

  insert into ventas (
    vendedor_id, sede_id, cliente_nombre, cliente_nit,
    metodo_pago, descuento_pct, descuento_valor, domicilio, iva_pct,
    observaciones, subtotal, total, cuenta_bancaria
  ) values (
    v_vendedor_id, p_sede_id, p_cliente_nombre, p_cliente_nit,
    public._fn_metodo_pago_canonico(p_metodo_pago), p_descuento_pct, p_descuento_valor, greatest(0, coalesce(p_domicilio, 0)), v_iva,
    p_observaciones, 0, 0, nullif(btrim(coalesce(p_cuenta_bancaria, '')), '')
  )
  returning id, numero into v_venta_id, v_numero;

  for item in select * from jsonb_array_elements(p_items)
  loop
    v_cantidad := (item->>'cantidad')::numeric;
    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cantidad inválida en un ítem de la venta';
    end if;

    v_precio_in := nullif(item->>'precio_unitario', '')::numeric;
    v_serv_id   := nullif(item->>'servicio_id', '')::bigint;

    if v_serv_id is not null then
      select nombre, precio into v_serv_nombre, v_serv_precio
        from servicios where id = v_serv_id and activo = true;

      if v_serv_nombre is null then
        raise exception 'Servicio % no encontrado o inactivo', v_serv_id;
      end if;

      v_precio := case
        when v_precio_in is not null and v_precio_in >= 0 then v_precio_in
        else v_serv_precio
      end;

      insert into detalle_venta (
        venta_id, producto_id, servicio_id, descripcion,
        cantidad, precio_unitario, costo_unitario, subtotal, precio_catalogo
      ) values (
        v_venta_id, null, v_serv_id, v_serv_nombre,
        v_cantidad, v_precio, 0, v_cantidad * v_precio, v_serv_precio
      );
    else
      v_prod_id := (item->>'producto_id')::uuid;

      select precio_venta, coalesce(costo_promedio, 0)
        into v_precio_cat, v_costo
        from productos where id = v_prod_id and activo = true;

      if v_precio_cat is null then
        raise exception 'Producto % no encontrado o inactivo', v_prod_id;
      end if;

      v_precio := case
        when v_precio_in is not null and v_precio_in >= 0 then v_precio_in
        else v_precio_cat
      end;

      insert into detalle_venta (
        venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal,
        precio_catalogo
      ) values (
        v_venta_id, v_prod_id, v_cantidad, v_precio, v_costo, v_cantidad * v_precio,
        v_precio_cat
      );
    end if;
  end loop;

  -- S1-23: clampar descuento_valor a [0, subtotal] (el trigger ya clampa el total,
  -- usando el mismo greatest/least, por lo que el total queda consistente).
  update ventas
     set descuento_valor = greatest(0, least(descuento_valor, subtotal))
   where id = v_venta_id and descuento_valor is not null;

  if v_tiene_pagos then
    select total into v_total_real from ventas where id = v_venta_id;
    for pago in select * from jsonb_array_elements(p_pagos)
    loop
      v_pm := btrim(coalesce(pago->>'metodo_pago', ''));
      v_pmonto := round(coalesce((pago->>'monto')::numeric, 0));
      if v_pm = '' then raise exception 'Cada pago debe indicar el método'; end if;
      if v_pmonto <= 0 then raise exception 'Cada pago debe tener un monto mayor a 0'; end if;
      -- S1-10: cada pago electrónico exige cuenta bancaria.
      if lower(v_pm) in ('transferencia', 'tarjeta')
         and nullif(btrim(coalesce(pago->>'cuenta_bancaria', '')), '') is null then
        raise exception 'El pago con % requiere indicar la cuenta bancaria.', v_pm;
      end if;
      -- S1-09: un pago a crédito exige cliente identificado.
      if lower(v_pm) in ('crédito', 'credito') and not v_cliente_ok then
        raise exception 'Una venta a crédito necesita un cliente identificado para poder cobrarla.';
      end if;
      insert into pagos_venta (venta_id, metodo_pago, cuenta_bancaria, monto)
      values (v_venta_id, public._fn_metodo_pago_canonico(v_pm), nullif(btrim(coalesce(pago->>'cuenta_bancaria','')), ''), v_pmonto);
      v_suma := v_suma + v_pmonto;
    end loop;
    if abs(v_suma - coalesce(v_total_real,0)) > 1 then
      raise exception 'La suma de los pagos (%) no coincide con el total de la venta (%)', v_suma, v_total_real;
    end if;
    update ventas set metodo_pago = 'Mixto', cuenta_bancaria = null where id = v_venta_id;
  end if;

  return (
    select jsonb_build_object(
      'venta_id', v.id, 'numero', v.numero, 'total', v.total, 'fecha', v.fecha
    ) from ventas v where v.id = v_venta_id
  );
end;
$function$;


-- ----------------------------------------------------------------------------
-- fn_anular_venta — S1-07 (rechazar anular la venta-diferencia de un cambio).
-- Se conserva RETURNS void y TODA la lógica original; solo se agrega la lectura
-- de observaciones y el guard S1-07. (S1-08 queda DIFERIDO: exigiría cambiar el
-- tipo de retorno a jsonb, lo que obliga a DROP + CREATE.)
--
-- ORIGINAL (pre-migración), para reversibilidad:
/*
CREATE OR REPLACE FUNCTION public.fn_anular_venta(p_venta_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); v_rol text; v_anulada boolean;
  v_item detalle_venta%rowtype; v_sede_id text; v_origen text; v_orden_id uuid;
  v_stock_ant integer; v_stock_post integer;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select get_my_rol() into v_rol;
  if v_rol is distinct from 'Admin' then raise exception 'Solo el administrador puede anular ventas'; end if;
  select anulada, sede_id, origen, orden_id into v_anulada, v_sede_id, v_origen, v_orden_id
  from ventas where id = p_venta_id;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v_anulada then raise exception 'La venta ya fue anulada anteriormente'; end if;
  perform set_config('cdv.anulando_venta', 'on', true);
  update ventas set anulada=true, anulada_por=v_uid, anulada_en=now(), motivo_anulacion=v_motivo
   where id = p_venta_id;
  update pagos_cuenta set anulado=true, anulado_por=v_uid, anulado_en=now(),
         motivo_anulacion=coalesce(v_motivo,'Venta anulada')
   where venta_id = p_venta_id and coalesce(anulado,false)=false;
  if v_origen = 'ot' then
    update abonos set venta_id = null where venta_id = p_venta_id;
    update ordenes_servicio set venta_id = null, estado = 'terminada', fecha_entrega = null
     where id = v_orden_id;
    perform set_config('cdv.anulando_venta', 'off', true);
    return;
  end if;
  perform set_config('cdv.anulando_venta', 'off', true);
  for v_item in select * from detalle_venta where venta_id = p_venta_id loop
    if v_item.producto_id is null then continue; end if;
    select cantidad into v_stock_ant from inventario
     where producto_id = v_item.producto_id and sede_id = v_sede_id for update;
    v_stock_post := coalesce(v_stock_ant,0) + v_item.cantidad;
    update inventario set cantidad = v_stock_post, updated_at = now()
     where producto_id = v_item.producto_id and sede_id = v_sede_id;
    insert into movimientos (producto_id, sede_id, tipo, cantidad, stock_anterior, stock_posterior,
                            referencia_id, referencia_tipo, usuario_id, observaciones)
    select v_item.producto_id, v_sede_id, 'ajuste', v_item.cantidad,
           coalesce(v_stock_ant,0), v_stock_post, p_venta_id, 'venta', v_uid,
           'Anulación de venta #' || v.numero
    from ventas v where v.id = p_venta_id;
    perform fn_actualizar_estado_stock(v_item.producto_id, v_sede_id);
  end loop;
end;
$function$;
*/
CREATE OR REPLACE FUNCTION public.fn_anular_venta(p_venta_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); v_rol text; v_anulada boolean;
  v_item detalle_venta%rowtype; v_sede_id text; v_origen text; v_orden_id uuid;
  v_obs text;
  v_stock_ant integer; v_stock_post integer;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select get_my_rol() into v_rol;
  if v_rol is distinct from 'Admin' then raise exception 'Solo el administrador puede anular ventas'; end if;
  select anulada, sede_id, origen, orden_id, observaciones
    into v_anulada, v_sede_id, v_origen, v_orden_id, v_obs
  from ventas where id = p_venta_id;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v_anulada then raise exception 'La venta ya fue anulada anteriormente'; end if;
  -- S1-07: la venta-diferencia de un cambio de producto no puede anularse directo
  -- (anularla reingresaría por duplicado el stock del producto nuevo).
  if v_obs is not null and v_obs like 'Cambio por venta #%' then
    raise exception 'Esta venta es la diferencia de un cambio de producto; no se puede anular directamente.';
  end if;
  perform set_config('cdv.anulando_venta', 'on', true);
  update ventas set anulada=true, anulada_por=v_uid, anulada_en=now(), motivo_anulacion=v_motivo
   where id = p_venta_id;
  update pagos_cuenta set anulado=true, anulado_por=v_uid, anulado_en=now(),
         motivo_anulacion=coalesce(v_motivo,'Venta anulada')
   where venta_id = p_venta_id and coalesce(anulado,false)=false;
  if v_origen = 'ot' then
    update abonos set venta_id = null where venta_id = p_venta_id;
    update ordenes_servicio set venta_id = null, estado = 'terminada', fecha_entrega = null
     where id = v_orden_id;
    perform set_config('cdv.anulando_venta', 'off', true);
    return;
  end if;
  perform set_config('cdv.anulando_venta', 'off', true);
  for v_item in select * from detalle_venta where venta_id = p_venta_id loop
    if v_item.producto_id is null then continue; end if;
    select cantidad into v_stock_ant from inventario
     where producto_id = v_item.producto_id and sede_id = v_sede_id for update;
    v_stock_post := coalesce(v_stock_ant,0) + v_item.cantidad;
    update inventario set cantidad = v_stock_post, updated_at = now()
     where producto_id = v_item.producto_id and sede_id = v_sede_id;
    insert into movimientos (producto_id, sede_id, tipo, cantidad, stock_anterior, stock_posterior,
                            referencia_id, referencia_tipo, usuario_id, observaciones)
    select v_item.producto_id, v_sede_id, 'ajuste', v_item.cantidad,
           coalesce(v_stock_ant,0), v_stock_post, p_venta_id, 'venta', v_uid,
           'Anulación de venta #' || v.numero
    from ventas v where v.id = p_venta_id;
    perform fn_actualizar_estado_stock(v_item.producto_id, v_sede_id);
  end loop;
end;
$function$;


-- ----------------------------------------------------------------------------
-- fn_upsert_cliente — S1-13 (pasar a SECURITY DEFINER + guard de autenticación).
-- Antes corría como INVOKER; la política clientes_update es solo-Admin, por lo
-- que un Vendedor no lograba actualizar clientes existentes (fallo silencioso).
-- Se agrega guard de auth.uid() porque, al ser DEFINER, bypassa RLS y PUBLIC/anon
-- tienen EXECUTE.
--
-- ORIGINAL (pre-migración), para reversibilidad:
/*
CREATE OR REPLACE FUNCTION public.fn_upsert_cliente(p_nombre text, p_identificacion text DEFAULT NULL::text, p_telefono text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_direccion text DEFAULT NULL::text)
 RETURNS clientes
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_cliente public.clientes;
  v_nombre  text := nullif(btrim(p_nombre), '');
  v_ident   text := nullif(btrim(p_identificacion), '');
  v_tel     text := nullif(btrim(p_telefono), '');
  v_email   text := nullif(btrim(p_email), '');
  v_dir     text := nullif(btrim(p_direccion), '');
begin
  if v_nombre is null then
    raise exception 'El nombre del cliente es obligatorio';
  end if;
  if v_ident is not null then
    select * into v_cliente
      from public.clientes
     where identificacion = v_ident and activo
     limit 1;
    if found then
      return v_cliente;
    end if;
  end if;
  select * into v_cliente
    from public.clientes
   where activo
     and lower(btrim(nombre)) = lower(v_nombre)
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
  insert into public.clientes (nombre, identificacion, telefono, email, direccion)
  values (v_nombre, v_ident, v_tel, v_email, v_dir)
  returning * into v_cliente;
  return v_cliente;
end;
$function$;
*/
CREATE OR REPLACE FUNCTION public.fn_upsert_cliente(p_nombre text, p_identificacion text DEFAULT NULL::text, p_telefono text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_direccion text DEFAULT NULL::text)
 RETURNS clientes
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
begin
  if auth.uid() is null then
    raise exception 'Usuario no autenticado';
  end if;

  if v_nombre is null then
    raise exception 'El nombre del cliente es obligatorio';
  end if;

  if v_ident is not null then
    select * into v_cliente
      from public.clientes
     where identificacion = v_ident and activo
     limit 1;
    if found then
      return v_cliente;
    end if;
  end if;

  select * into v_cliente
    from public.clientes
   where activo
     and lower(btrim(nombre)) = lower(v_nombre)
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

  insert into public.clientes (nombre, identificacion, telefono, email, direccion)
  values (v_nombre, v_ident, v_tel, v_email, v_dir)
  returning * into v_cliente;

  return v_cliente;
end;
$function$;

-- S1-13: al ser SECURITY DEFINER (bypassa RLS), se quita EXECUTE a PUBLIC/anon
-- para que solo usuarios autenticados puedan crear/actualizar clientes (además
-- del guard de auth.uid() dentro de la función). authenticated conserva EXECUTE.
REVOKE EXECUTE ON FUNCTION public.fn_upsert_cliente(text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_upsert_cliente(text, text, text, text, text) FROM PUBLIC;


-- ----------------------------------------------------------------------------
-- fn_registrar_caja_menor — S1-21 (parte 1 de 2).
-- Se agrega soporte para registrar el egreso con un método de pago distinto de
-- Efectivo, leído de una señal transaccional (GUC), SIN cambiar la firma (evita
-- sobrecarga y ambigüedad de PostgREST). Si los GUC no están puestos, el
-- comportamiento es idéntico al anterior: metodo_pago='Efectivo', cuenta NULL.
--
-- ORIGINAL (pre-migración), para reversibilidad:
/*
CREATE OR REPLACE FUNCTION public.fn_registrar_caja_menor(p_sede_id text, p_concepto text, p_monto numeric, p_proveedor text DEFAULT NULL::text, p_observaciones text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario_id UUID;
  v_mi_sede    TEXT;
  v_mi_rol     TEXT;
  v_compra_id  UUID;
  v_numero     INT;
  v_monto      NUMERIC;
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
  INSERT INTO compras (
    proveedor, registrado_por, sede_destino_id, subtotal, iva, total,
    factura_proveedor, observaciones, recibida, fecha_recepcion,
    es_caja_menor, concepto
  ) VALUES (
    COALESCE(NULLIF(TRIM(COALESCE(p_proveedor, '')), ''), 'Caja menor'),
    v_usuario_id, p_sede_id, v_monto, 0, v_monto,
    NULL,
    NULLIF(TRIM(COALESCE(p_observaciones, '')), ''),
    true, now(),
    true, TRIM(p_concepto)
  ) RETURNING id, numero INTO v_compra_id, v_numero;
  RETURN jsonb_build_object(
    'compra_id', v_compra_id, 'numero', v_numero,
    'total', v_monto, 'es_caja_menor', true
  );
END;
$function$;
*/
CREATE OR REPLACE FUNCTION public.fn_registrar_caja_menor(p_sede_id text, p_concepto text, p_monto numeric, p_proveedor text DEFAULT NULL::text, p_observaciones text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario_id UUID;
  v_mi_sede    TEXT;
  v_mi_rol     TEXT;
  v_compra_id  UUID;
  v_numero     INT;
  v_monto      NUMERIC;
  v_metodo     TEXT;
  v_cuenta     TEXT;
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

  -- S1-21: método de pago del egreso (señal transaccional; por defecto Efectivo).
  v_metodo := public._fn_metodo_pago_canonico(
                COALESCE(NULLIF(current_setting('cdv.caja_menor_metodo', true), ''), 'Efectivo'));
  v_cuenta := NULLIF(current_setting('cdv.caja_menor_cuenta', true), '');

  INSERT INTO compras (
    proveedor, registrado_por, sede_destino_id, subtotal, iva, total,
    factura_proveedor, observaciones, recibida, fecha_recepcion,
    es_caja_menor, concepto, metodo_pago, cuenta_bancaria
  ) VALUES (
    COALESCE(NULLIF(TRIM(COALESCE(p_proveedor, '')), ''), 'Caja menor'),
    v_usuario_id, p_sede_id, v_monto, 0, v_monto,
    NULL,
    NULLIF(TRIM(COALESCE(p_observaciones, '')), ''),
    true, now(),
    true, TRIM(p_concepto), v_metodo, v_cuenta
  ) RETURNING id, numero INTO v_compra_id, v_numero;

  RETURN jsonb_build_object(
    'compra_id', v_compra_id, 'numero', v_numero,
    'total', v_monto, 'es_caja_menor', true
  );
END;
$function$;


-- ----------------------------------------------------------------------------
-- fn_registrar_cambio — S1-21 (parte 2 de 2).
-- Antes del egreso de reembolso, se coloca la señal transaccional con el método
-- (y cuenta si aplica) para que fn_registrar_caja_menor lo registre con el
-- método real del cambio en lugar de 'Efectivo' por defecto.
--
-- ORIGINAL (pre-migración), para reversibilidad:
/*
CREATE OR REPLACE FUNCTION public.fn_registrar_cambio(p_venta_original_id uuid, p_producto_devuelto_id uuid, p_cant_dev integer, p_producto_nuevo_id uuid, p_cant_nuevo integer, p_sede_id text, p_metodo text DEFAULT 'Efectivo'::text, p_cuenta_bancaria text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_rol text; v_sede text;
  v_venta record;
  v_sub_dev numeric;
  v_vendido integer;
  v_sub_total numeric;
  v_desc_v numeric;
  v_ratio numeric;
  v_precio_nuevo numeric;
  v_valor_dev numeric;
  v_valor_nuevo numeric;
  v_diferencia numeric;
  v_iva_factor numeric;
  v_dev jsonb; v_venta_nueva jsonb; v_egreso jsonb := null;
  v_venta_nueva_id uuid;
  v_reembolso numeric;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;
  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;
  if v_rol is null or v_rol not in ('Admin','Vendedor') then
    raise exception 'Solo Ventas (Vendedor) o Administración pueden registrar cambios';
  end if;
  if v_rol <> 'Admin' and v_sede is distinct from p_sede_id then
    raise exception 'Solo puedes registrar cambios en tu propia sede';
  end if;
  if p_cant_dev <= 0 or p_cant_nuevo <= 0 then
    raise exception 'Las cantidades deben ser mayores a 0';
  end if;
  if p_producto_devuelto_id = p_producto_nuevo_id then
    raise exception 'El producto nuevo debe ser distinto al devuelto';
  end if;
  if lower(coalesce(p_metodo,'')) not in ('efectivo','transferencia') then
    raise exception 'Método no soportado para cambios (usa Efectivo o Transferencia)';
  end if;
  select * into v_venta from ventas where id = p_venta_original_id;
  if not found then raise exception 'Venta original no encontrada'; end if;
  if v_venta.anulada then raise exception 'No se puede cambiar sobre una venta anulada'; end if;
  select coalesce(sum(subtotal),0), coalesce(sum(cantidad),0)
    into v_sub_dev, v_vendido
  from detalle_venta
  where venta_id = p_venta_original_id and producto_id = p_producto_devuelto_id;
  if v_vendido = 0 then
    raise exception 'El producto a devolver no estaba en la venta original';
  end if;
  v_sub_total := coalesce(v_venta.subtotal, 0);
  v_desc_v := coalesce(v_venta.descuento_valor, v_sub_total * coalesce(v_venta.descuento_pct, 0) / 100.0);
  v_desc_v := greatest(0, least(v_desc_v, v_sub_total));
  v_ratio := case when v_sub_total > 0 then (v_sub_total - v_desc_v) / v_sub_total else 1 end;
  v_valor_dev := round((v_sub_dev / v_vendido) * p_cant_dev * v_ratio);
  select precio_venta into v_precio_nuevo from productos where id = p_producto_nuevo_id and activo = true;
  if v_precio_nuevo is null then raise exception 'Producto nuevo no encontrado o inactivo'; end if;
  v_valor_nuevo := round(v_precio_nuevo * p_cant_nuevo);
  v_diferencia := v_valor_nuevo - v_valor_dev;
  v_iva_factor := 1 + coalesce(v_venta.iva_pct, 0) / 100.0;
  v_dev := fn_registrar_devolucion(
    'cliente', p_producto_devuelto_id, p_sede_id, p_cant_dev,
    coalesce(nullif(btrim(p_motivo), ''), 'Cambio de producto'),
    p_venta_original_id
  );
  v_venta_nueva := fn_registrar_venta(
    p_sede_id,
    v_venta.cliente_nombre,
    v_venta.cliente_nit,
    p_metodo,
    0,
    format('Cambio por venta #%s: entrega %s u. del nuevo, devuelve %s u. del original',
           v_venta.numero, p_cant_nuevo, p_cant_dev),
    jsonb_build_array(jsonb_build_object(
      'producto_id', p_producto_nuevo_id, 'cantidad', p_cant_nuevo)),
    coalesce(v_venta.iva_pct, 0),
    p_cuenta_bancaria,
    v_valor_dev,
    0
  );
  v_venta_nueva_id := (v_venta_nueva->>'venta_id')::uuid;
  if v_diferencia < 0 then
    v_reembolso := round((v_valor_dev - v_valor_nuevo) * v_iva_factor);
    if v_reembolso > 0 then
      v_egreso := fn_registrar_caja_menor(
        p_sede_id,
        format('Devolución por cambio - venta #%s', v_venta.numero),
        v_reembolso,
        coalesce(nullif(v_venta.cliente_nombre, ''), 'Cliente'),
        format('Diferencia a favor del cliente en cambio de producto (venta #%s)', v_venta.numero)
      );
    end if;
  end if;
  return jsonb_build_object(
    'ok', true,
    'venta_original_numero', v_venta.numero,
    'venta_nueva_id', v_venta_nueva_id,
    'venta_nueva_numero', (v_venta_nueva->>'numero'),
    'devolucion', v_dev,
    'valor_devuelto', v_valor_dev,
    'valor_nuevo', v_valor_nuevo,
    'diferencia_sin_iva', v_diferencia,
    'diferencia_con_iva', round(v_diferencia * v_iva_factor),
    'accion', case when v_diferencia > 0 then 'cobro'
                   when v_diferencia < 0 then 'devolucion'
                   else 'par' end,
    'reembolso', coalesce(v_reembolso, 0),
    'egreso', v_egreso
  );
end;
$function$;
*/
CREATE OR REPLACE FUNCTION public.fn_registrar_cambio(p_venta_original_id uuid, p_producto_devuelto_id uuid, p_cant_dev integer, p_producto_nuevo_id uuid, p_cant_nuevo integer, p_sede_id text, p_metodo text DEFAULT 'Efectivo'::text, p_cuenta_bancaria text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_rol text; v_sede text;
  v_venta record;
  v_sub_dev numeric;
  v_vendido integer;
  v_sub_total numeric;
  v_desc_v numeric;
  v_ratio numeric;
  v_precio_nuevo numeric;
  v_valor_dev numeric;
  v_valor_nuevo numeric;
  v_diferencia numeric;
  v_iva_factor numeric;
  v_dev jsonb; v_venta_nueva jsonb; v_egreso jsonb := null;
  v_venta_nueva_id uuid;
  v_reembolso numeric;
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;

  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;
  if v_rol is null or v_rol not in ('Admin','Vendedor') then
    raise exception 'Solo Ventas (Vendedor) o Administración pueden registrar cambios';
  end if;
  if v_rol <> 'Admin' and v_sede is distinct from p_sede_id then
    raise exception 'Solo puedes registrar cambios en tu propia sede';
  end if;

  if p_cant_dev <= 0 or p_cant_nuevo <= 0 then
    raise exception 'Las cantidades deben ser mayores a 0';
  end if;
  if p_producto_devuelto_id = p_producto_nuevo_id then
    raise exception 'El producto nuevo debe ser distinto al devuelto';
  end if;
  if lower(coalesce(p_metodo,'')) not in ('efectivo','transferencia') then
    raise exception 'Método no soportado para cambios (usa Efectivo o Transferencia)';
  end if;

  select * into v_venta from ventas where id = p_venta_original_id;
  if not found then raise exception 'Venta original no encontrada'; end if;
  if v_venta.anulada then raise exception 'No se puede cambiar sobre una venta anulada'; end if;

  select coalesce(sum(subtotal),0), coalesce(sum(cantidad),0)
    into v_sub_dev, v_vendido
  from detalle_venta
  where venta_id = p_venta_original_id and producto_id = p_producto_devuelto_id;
  if v_vendido = 0 then
    raise exception 'El producto a devolver no estaba en la venta original';
  end if;

  v_sub_total := coalesce(v_venta.subtotal, 0);
  v_desc_v := coalesce(v_venta.descuento_valor, v_sub_total * coalesce(v_venta.descuento_pct, 0) / 100.0);
  v_desc_v := greatest(0, least(v_desc_v, v_sub_total));
  v_ratio := case when v_sub_total > 0 then (v_sub_total - v_desc_v) / v_sub_total else 1 end;

  v_valor_dev := round((v_sub_dev / v_vendido) * p_cant_dev * v_ratio);

  select precio_venta into v_precio_nuevo from productos where id = p_producto_nuevo_id and activo = true;
  if v_precio_nuevo is null then raise exception 'Producto nuevo no encontrado o inactivo'; end if;
  v_valor_nuevo := round(v_precio_nuevo * p_cant_nuevo);

  v_diferencia := v_valor_nuevo - v_valor_dev;
  v_iva_factor := 1 + coalesce(v_venta.iva_pct, 0) / 100.0;

  v_dev := fn_registrar_devolucion(
    'cliente', p_producto_devuelto_id, p_sede_id, p_cant_dev,
    coalesce(nullif(btrim(p_motivo), ''), 'Cambio de producto'),
    p_venta_original_id
  );

  v_venta_nueva := fn_registrar_venta(
    p_sede_id,
    v_venta.cliente_nombre,
    v_venta.cliente_nit,
    p_metodo,
    0,
    format('Cambio por venta #%s: entrega %s u. del nuevo, devuelve %s u. del original',
           v_venta.numero, p_cant_nuevo, p_cant_dev),
    jsonb_build_array(jsonb_build_object(
      'producto_id', p_producto_nuevo_id, 'cantidad', p_cant_nuevo)),
    coalesce(v_venta.iva_pct, 0),
    p_cuenta_bancaria,
    v_valor_dev,
    0
  );
  v_venta_nueva_id := (v_venta_nueva->>'venta_id')::uuid;

  if v_diferencia < 0 then
    v_reembolso := round((v_valor_dev - v_valor_nuevo) * v_iva_factor);
    if v_reembolso > 0 then
      -- S1-21: señalar el método (y cuenta) del reembolso para el egreso.
      perform set_config('cdv.caja_menor_metodo', coalesce(p_metodo, ''), true);
      perform set_config('cdv.caja_menor_cuenta', coalesce(nullif(btrim(coalesce(p_cuenta_bancaria, '')), ''), ''), true);
      v_egreso := fn_registrar_caja_menor(
        p_sede_id,
        format('Devolución por cambio - venta #%s', v_venta.numero),
        v_reembolso,
        coalesce(nullif(v_venta.cliente_nombre, ''), 'Cliente'),
        format('Diferencia a favor del cliente en cambio de producto (venta #%s)', v_venta.numero)
      );
      -- limpiar la señal (transaccional; se resetea sola al fin de la tx igualmente).
      perform set_config('cdv.caja_menor_metodo', '', true);
      perform set_config('cdv.caja_menor_cuenta', '', true);
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'venta_original_numero', v_venta.numero,
    'venta_nueva_id', v_venta_nueva_id,
    'venta_nueva_numero', (v_venta_nueva->>'numero'),
    'devolucion', v_dev,
    'valor_devuelto', v_valor_dev,
    'valor_nuevo', v_valor_nuevo,
    'diferencia_sin_iva', v_diferencia,
    'diferencia_con_iva', round(v_diferencia * v_iva_factor),
    'accion', case when v_diferencia > 0 then 'cobro'
                   when v_diferencia < 0 then 'devolucion'
                   else 'par' end,
    'reembolso', coalesce(v_reembolso, 0),
    'egreso', v_egreso
  );
end;
$function$;
