-- fn_registrar_venta captura las tres tarifas de retencion.
--
-- Los parametros van AL FINAL y con DEFAULT 0: PostgREST llama por nombre, asi
-- que ningun llamado existente se rompe y una venta sin retencion se comporta
-- exactamente igual que antes.
--
-- La RPC solo guarda los PORCENTAJES. Los valores los calculan las columnas
-- generadas, que no pueden discrepar de la factura.
--
-- El cambio delicado es la validacion de Mixto. Hoy exige que los pagos sumen
-- `total`. Con retencion, el cliente entrega el NETO, y los desgloses del cierre
-- (por metodo, por sede y metodo, por cuenta y arqueo) leen esos pagos para las
-- ventas Mixto. Si sumaran el total, esos cuatro desgloses contarian de mas y
-- dejarian de cuadrar con el ingreso general.
CREATE OR REPLACE FUNCTION public.fn_registrar_venta(
  p_sede_id text,
  p_cliente_nombre text DEFAULT NULL::text,
  p_cliente_nit text DEFAULT NULL::text,
  p_metodo_pago text DEFAULT 'Efectivo'::text,
  p_descuento_pct numeric DEFAULT 0,
  p_observaciones text DEFAULT NULL::text,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_iva_pct numeric DEFAULT 19,
  p_cuenta_bancaria text DEFAULT NULL::text,
  p_descuento_valor numeric DEFAULT NULL::numeric,
  p_domicilio numeric DEFAULT 0,
  p_pagos jsonb DEFAULT NULL::jsonb,
  p_retefuente_pct numeric DEFAULT 0,   -- RETENCIONES
  p_reteica_pct numeric DEFAULT 0,      -- RETENCIONES
  p_reteiva_pct numeric DEFAULT 0       -- RETENCIONES
)
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
  v_rf          numeric;  -- RETENCIONES
  v_ri          numeric;  -- RETENCIONES
  v_riva        numeric;  -- RETENCIONES
  v_neto        numeric;  -- RETENCIONES
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

  -- RETENCIONES: se recortan a [0, 100]. El CHECK de la tabla los rechazaria,
  -- pero un mensaje de constraint no le dice nada a la vendedora.
  v_rf   := greatest(0, least(100, coalesce(p_retefuente_pct, 0)));
  v_ri   := greatest(0, least(100, coalesce(p_reteica_pct, 0)));
  v_riva := greatest(0, least(100, coalesce(p_reteiva_pct, 0)));

  insert into ventas (
    vendedor_id, sede_id, cliente_nombre, cliente_nit,
    metodo_pago, descuento_pct, descuento_valor, domicilio, iva_pct,
    observaciones, subtotal, total, cuenta_bancaria,
    retefuente_pct, reteica_pct, reteiva_pct                          -- RETENCIONES
  ) values (
    v_vendedor_id, p_sede_id, p_cliente_nombre, p_cliente_nit,
    public._fn_metodo_pago_canonico(p_metodo_pago), p_descuento_pct, p_descuento_valor, greatest(0, coalesce(p_domicilio, 0)), v_iva,
    p_observaciones, 0, 0, nullif(btrim(coalesce(p_cuenta_bancaria, '')), ''),
    v_rf, v_ri, v_riva                                                -- RETENCIONES
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
    -- RETENCIONES: lo que el cliente entrega es el NETO. Se lee despues del
    -- clamp del descuento para que la columna generada ya este al dia.
    select total, total - coalesce(retenciones_total, 0)
      into v_total_real, v_neto
      from ventas where id = v_venta_id;
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
    -- RETENCIONES: contra el NETO, no contra el total facturado.
    if abs(v_suma - coalesce(v_neto,0)) > 1 then
      if v_total_real <> v_neto then
        raise exception 'La suma de los pagos (%) no coincide con lo que el cliente debe entregar (%): el total es % y le retienen %',
          v_suma, v_neto, v_total_real, v_total_real - v_neto;
      else
        raise exception 'La suma de los pagos (%) no coincide con el total de la venta (%)', v_suma, v_total_real;
      end if;
    end if;
    update ventas set metodo_pago = 'Mixto', cuenta_bancaria = null where id = v_venta_id;
  end if;

  return (
    select jsonb_build_object(
      'venta_id', v.id, 'numero', v.numero, 'total', v.total, 'fecha', v.fecha,
      'retenciones_total', coalesce(v.retenciones_total, 0),          -- RETENCIONES
      'neto', v.total - coalesce(v.retenciones_total, 0)              -- RETENCIONES
    ) from ventas v where v.id = v_venta_id
  );
end;
$function$;
