-- S6 · Pendiente tecnico #3 — Bloquear el UPDATE directo por REST de compras.recibida
--
-- Contexto: hasta hoy, un Admin/Bodeguero podia marcar `compras.recibida = true`
-- por REST sin pasar por fn_recibir_compra, saltandose la validacion de recepcion
-- parcial (ajuste de lineas y recalculo del total) y dejando inventario inflado.
-- Verificado como hueco VIVO en produccion antes de aplicar este bloqueo.
--
-- Diseño: se reutiliza el patron que ya usa esta base (flag transaccional
-- `cdv.compra_admin` + trigger BEFORE UPDATE), en vez de un REVOKE, porque:
--   1. el Vendedor "todero" DEBE poder recibir compras (decision del dueño) y un
--      REVOKE de UPDATE dejaria la policy `compras_update` inalcanzable;
--   2. las columnas materiales de `compras` ya se protegen con este mismo trigger,
--      asi que la recepcion queda custodiada en un solo lugar coherente;
--   3. un UPDATE legitimo de otras columnas (p.ej. observaciones) sigue pasando.
--
-- Cambios:
--   A. trg_compra_proteger_materiales: añade `recibida` y `fecha_recepcion` al
--      conjunto custodiado. Solo pasan con el flag encendido (= dentro de una RPC).
--   B. fn_registrar_compra: enciende el flag alrededor de su UPDATE interno de
--      recepcion (p_recibir = true). Sin esto, registrar una compra "ya recibida"
--      quedaria roto por el cambio A. Misma firma => CREATE OR REPLACE conserva ACL.

-- A. -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_compra_proteger_materiales()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.estado = 'cancelada' and new.estado is distinct from 'cancelada' then
    raise exception 'No se puede reactivar una compra cancelada';
  end if;

  -- S6-A/S6-J: las RPCs legitimas (fn_cancelar_compra, fn_abrir/anular_garantia_compra,
  -- fn_recibir_compra, fn_registrar_compra) activan cdv.compra_admin para sus UPDATE internos.
  if coalesce(current_setting('cdv.compra_admin', true), '') = 'on' then
    return new;
  end if;

  -- S6 pendiente #3: la recepcion solo se registra via fn_recibir_compra.
  if new.recibida is distinct from old.recibida
     or new.fecha_recepcion is distinct from old.fecha_recepcion then
    raise exception 'La recepcion de una compra solo se registra con la funcion del sistema (fn_recibir_compra); no se puede modificar recibida ni fecha_recepcion directamente';
  end if;

  if new.estado is distinct from old.estado
     or new.fecha is distinct from old.fecha
     or new.registrado_por is distinct from old.registrado_por then
    raise exception 'No se pueden modificar estado, fecha ni registrado_por de una compra directamente; usa las funciones del sistema';
  end if;

  if new.sede_destino_id    is distinct from old.sede_destino_id
     or new.subtotal          is distinct from old.subtotal
     or new.iva               is distinct from old.iva
     or new.iva_pct           is distinct from old.iva_pct
     or new.total             is distinct from old.total
     or new.descuento_valor   is distinct from old.descuento_valor
     or new.proveedor         is distinct from old.proveedor
     or new.factura_proveedor is distinct from old.factura_proveedor
     or new.metodo_pago       is distinct from old.metodo_pago
     or new.cuenta_bancaria   is distinct from old.cuenta_bancaria
     or new.concepto          is distinct from old.concepto
     or new.es_caja_menor     is distinct from old.es_caja_menor then
    raise exception 'No se pueden modificar los datos materiales (sede, importes, proveedor, factura, método de pago) de una compra ya registrada';
  end if;

  return new;
end;
$function$;

-- B. -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_registrar_compra(p_sede_id text, p_proveedor text, p_factura_proveedor text DEFAULT NULL::text, p_observaciones text DEFAULT NULL::text, p_recibir boolean DEFAULT false, p_items jsonb DEFAULT '[]'::jsonb, p_iva_pct numeric DEFAULT 19, p_metodo_pago text DEFAULT 'Efectivo'::text, p_cuenta_bancaria text DEFAULT NULL::text, p_descuento_valor numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    metodo_pago, cuenta_bancaria, descuento_valor
  ) values (
    trim(p_proveedor), v_usuario_id, p_sede_id, v_subtotal, v_iva, v_iva_pct, v_total,
    nullif(trim(coalesce(p_factura_proveedor, '')), ''),
    nullif(trim(coalesce(p_observaciones, '')), ''),
    false,
    v_metodo,
    case when v_metodo in ('Transferencia', 'Tarjeta')
      then nullif(trim(coalesce(p_cuenta_bancaria, '')), '') else null end,
    nullif(v_desc, 0)
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
