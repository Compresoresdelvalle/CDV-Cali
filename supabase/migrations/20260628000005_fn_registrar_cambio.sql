-- ============================================================================
-- Reporte clienta (función nueva): CAMBIO de producto con diferencia de precio.
-- Cuando un cliente regresa a cambiar un producto por otro de distinto precio,
-- el sistema debe: reingresar el devuelto, entregar el nuevo y gestionar la
-- DIFERENCIA (cobrarla si el nuevo es más caro, devolverla si es más barato),
-- vinculado a la factura original y con trazabilidad — sin afectar el cierre.
--
-- DISEÑO (máxima reutilización, cero tablas nuevas, cero cambios al cierre):
-- fn_registrar_cambio es un ORQUESTADOR atómico (una sola transacción) que
-- reutiliza 3 funciones ya probadas:
--   1) fn_registrar_devolucion('cliente', ...)  -> reingresa el devuelto (+stock),
--      valida que el producto estaba en la venta y que no se devuelve de más.
--   2) fn_registrar_venta(... descuento_valor = valor del devuelto ...) -> vende el
--      nuevo aplicando el devuelto como "trade-in". Con el IVA de la venta original,
--      el TOTAL de esa venta queda EXACTAMENTE la diferencia (el trigger
--      trg_recalcular_total_venta clampa el descuento a [0, subtotal], así que si el
--      nuevo es más barato la venta queda en 0 — nunca negativa).
--   3) Si el nuevo es más barato, fn_registrar_caja_menor(...) registra la diferencia
--      a favor del cliente como EGRESO de caja.
--
-- Contabilidad ("solo la diferencia"): el cierre cuenta ventas origen='directa'
-- (metodo<>Crédito) como ingreso y compras/caja menor como egreso; las devoluciones
-- no mueven dinero. Por eso el ingreso/egreso del día es exactamente la diferencia,
-- sin doble conteo y sin tocar _fn_cierre_totales.
-- ============================================================================

create or replace function public.fn_registrar_cambio(
  p_venta_original_id uuid,
  p_producto_devuelto_id uuid,
  p_cant_dev integer,
  p_producto_nuevo_id uuid,
  p_cant_nuevo integer,
  p_sede_id text,
  p_metodo text default 'Efectivo',
  p_cuenta_bancaria text default null,
  p_motivo text default null
) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text; v_sede text;
  v_venta record;
  v_sub_dev numeric;        -- subtotal pagado (pre-IVA) del producto devuelto en la venta
  v_vendido integer;        -- unidades de ese producto en la venta original
  v_precio_nuevo numeric;   -- precio de catálogo (pre-IVA) del producto nuevo
  v_valor_dev numeric;      -- crédito por lo devuelto (pre-IVA)
  v_valor_nuevo numeric;    -- valor del nuevo (pre-IVA)
  v_diferencia numeric;     -- (nuevo - devuelto) pre-IVA
  v_iva_factor numeric;     -- 1 + iva/100 de la venta original
  v_dev jsonb; v_venta_nueva jsonb; v_egreso jsonb := null;
  v_venta_nueva_id uuid;
  v_reembolso numeric;      -- monto a devolver al cliente (con IVA), si aplica
begin
  if v_uid is null then raise exception 'Usuario no autenticado'; end if;

  select rol::text, sede_id into v_rol, v_sede from usuarios where id = v_uid;
  -- El cambio crea una venta: solo roles que pueden vender.
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

  -- Venta original
  select * into v_venta from ventas where id = p_venta_original_id;
  if not found then raise exception 'Venta original no encontrada'; end if;
  if v_venta.anulada then raise exception 'No se puede cambiar sobre una venta anulada'; end if;

  -- Valor pagado (pre-IVA) del producto devuelto: subtotal de sus líneas / unidades.
  select coalesce(sum(subtotal),0), coalesce(sum(cantidad),0)
    into v_sub_dev, v_vendido
  from detalle_venta
  where venta_id = p_venta_original_id and producto_id = p_producto_devuelto_id;
  if v_vendido = 0 then
    raise exception 'El producto a devolver no estaba en la venta original';
  end if;
  v_valor_dev := round((v_sub_dev / v_vendido) * p_cant_dev);

  -- Valor (pre-IVA) del producto nuevo a precio de catálogo.
  select precio_venta into v_precio_nuevo from productos where id = p_producto_nuevo_id and activo = true;
  if v_precio_nuevo is null then raise exception 'Producto nuevo no encontrado o inactivo'; end if;
  v_valor_nuevo := round(v_precio_nuevo * p_cant_nuevo);

  v_diferencia := v_valor_nuevo - v_valor_dev;
  v_iva_factor := 1 + coalesce(v_venta.iva_pct, 0) / 100.0;

  -- 1) Reingresa el producto devuelto (valida pertenencia y tope de devolución).
  v_dev := fn_registrar_devolucion(
    'cliente', p_producto_devuelto_id, p_sede_id, p_cant_dev,
    coalesce(nullif(btrim(p_motivo), ''), 'Cambio de producto'),
    p_venta_original_id
  );

  -- 2) Vende el producto nuevo con el devuelto como trade-in (descuento_valor).
  --    Mismo IVA de la venta original => total = diferencia (×(1+iva)); si el nuevo
  --    es más barato, el descuento se clampa al subtotal y el total queda en 0.
  v_venta_nueva := fn_registrar_venta(
    p_sede_id,
    v_venta.cliente_nombre,
    v_venta.cliente_nit,
    p_metodo,
    0,                                  -- p_descuento_pct
    format('Cambio por venta #%s: entrega %s u. del nuevo, devuelve %s u. del original',
           v_venta.numero, p_cant_nuevo, p_cant_dev),
    jsonb_build_array(jsonb_build_object(
      'producto_id', p_producto_nuevo_id, 'cantidad', p_cant_nuevo)),
    coalesce(v_venta.iva_pct, 0),       -- p_iva_pct (mismo de la venta original)
    p_cuenta_bancaria,
    v_valor_dev,                        -- p_descuento_valor (trade-in)
    0                                   -- p_domicilio
  );
  v_venta_nueva_id := (v_venta_nueva->>'venta_id')::uuid;

  -- 3) Nuevo más barato: se devuelve la diferencia (con IVA) al cliente (egreso de caja).
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

revoke execute on function public.fn_registrar_cambio(uuid,uuid,integer,uuid,integer,text,text,text,text) from public, anon;
grant execute on function public.fn_registrar_cambio(uuid,uuid,integer,uuid,integer,text,text,text,text) to authenticated;
