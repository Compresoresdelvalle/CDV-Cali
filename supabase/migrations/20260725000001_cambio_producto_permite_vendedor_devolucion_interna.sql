-- Bug: una vendedora no podía completar un cambio de producto (venta #1079,
-- "no se pudo registrar el cambio"). Causa real reproducida: fn_registrar_cambio
-- —que sí permite Admin/Vendedor— compone por dentro fn_registrar_devolucion, y
-- a esa se le añadió después (TAREA B) un guard que la restringe a
-- Admin/Bodeguero. Así, el cambio quedó roto para Vendedores desde ese
-- endurecimiento, sin que nadie lo notara: la devolución directa se protegió,
-- pero se rompió la composición.
--
-- Arreglo: la devolución DIRECTA (pantalla Devoluciones) sigue siendo solo
-- Admin/Bodeguero. Pero cuando la invoca fn_registrar_cambio —que ya validó que
-- el usuario es Admin/Vendedor y que opera en su propia sede— se salta ese
-- guard mediante una señal de sesión, exactamente el mismo mecanismo que la
-- propia fn_registrar_cambio ya usa para pasarle el método de pago al egreso de
-- caja menor (cdv.caja_menor_metodo). La señal es transaccional (set_config con
-- is_local=true) y no es forjable desde el cliente: por PostgREST cada RPC corre
-- como una sola llamada en su propia transacción, sin sentencias previas que el
-- cliente controle.
--
-- Verificado en producción (transacciones revertidas): la vendedora de CV
-- completa el cambio de la venta #1079 (acción "par", $6000 por $6000), y la
-- devolución directa le sigue devolviendo "No tienes permiso para registrar
-- devoluciones".

create or replace function public.fn_registrar_devolucion(
  p_tipo text, p_producto_id uuid, p_sede_id text, p_cantidad integer,
  p_motivo text default 'Sin motivo especificado'::text, p_venta_id uuid default null::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_usuario_id UUID;
  v_rol TEXT;
  v_dev_id UUID;
  v_numero INT;
  v_stock_ant INTEGER;
  v_stock_post INTEGER;
  v_anulada BOOLEAN;
  v_cantidad_original INTEGER;
  v_devuelto_previo INTEGER;
  v_signo INTEGER;
  v_reingresa BOOLEAN;
BEGIN
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;

  -- TAREA B: guard de rol/sede (antes solo validaba auth.uid()).
  -- El RoleGuard (Admin/Bodeguero) era solo client-side.
  --
  -- Excepción: cuando fn_registrar_cambio compone una devolución como parte de
  -- un cambio de producto, marca la señal de sesión cdv.cambio_interno. Esa
  -- función ya validó rol (Admin/Vendedor) y sede antes de llamar aquí, así que
  -- volver a exigir Admin/Bodeguero rompería el cambio para las vendedoras (bug
  -- real, venta #1079). La devolución DIRECTA sigue protegida: sin la señal,
  -- este guard aplica igual que siempre.
  SELECT rol::text INTO v_rol FROM usuarios WHERE id = v_usuario_id;
  IF current_setting('cdv.cambio_interno', true) IS DISTINCT FROM '1' THEN
    IF v_rol IS NULL OR v_rol NOT IN ('Admin','Bodeguero') THEN
      RAISE EXCEPTION 'No tienes permiso para registrar devoluciones';
    END IF;
    IF v_rol <> 'Admin' AND p_sede_id IS DISTINCT FROM get_my_sede_id() THEN
      RAISE EXCEPTION 'Solo puedes registrar devoluciones en tu sede';
    END IF;
  END IF;

  IF p_tipo NOT IN ('cliente','proveedor') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  IF p_cantidad <= 0 THEN RAISE EXCEPTION 'Cantidad debe ser mayor a 0'; END IF;

  IF p_tipo = 'cliente' THEN
    v_signo := 1;
    v_reingresa := true;
    IF p_venta_id IS NULL THEN
      RAISE EXCEPTION 'Devolución de cliente requiere venta_id';
    END IF;
    SELECT anulada INTO v_anulada FROM ventas WHERE id = p_venta_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Venta no encontrada';
    END IF;
    IF v_anulada THEN
      RAISE EXCEPTION 'No se puede devolver de una venta anulada';
    END IF;
    SELECT COALESCE(SUM(cantidad), 0) INTO v_cantidad_original
      FROM detalle_venta WHERE venta_id = p_venta_id AND producto_id = p_producto_id;
    IF v_cantidad_original = 0 THEN
      RAISE EXCEPTION 'Producto no estaba en la venta original';
    END IF;
    SELECT COALESCE(SUM(cantidad), 0) INTO v_devuelto_previo
      FROM devoluciones WHERE venta_id = p_venta_id AND producto_id = p_producto_id;
    IF v_devuelto_previo + p_cantidad > v_cantidad_original THEN
      RAISE EXCEPTION 'Cantidad excede lo vendido (vendido=%, ya devuelto=%, intentas=%)',
        v_cantidad_original, v_devuelto_previo, p_cantidad;
    END IF;
  ELSE
    v_signo := -1;
    v_reingresa := false;
  END IF;

  INSERT INTO inventario (producto_id, sede_id, cantidad, estado_stock)
  VALUES (p_producto_id, p_sede_id, 0, 'OK')
  ON CONFLICT (producto_id, sede_id) DO NOTHING;

  SELECT cantidad INTO v_stock_ant FROM inventario
   WHERE producto_id = p_producto_id AND sede_id = p_sede_id FOR UPDATE;

  IF v_signo = -1 AND v_stock_ant < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente para devolver al proveedor (disponible=%, requerido=%)',
      v_stock_ant, p_cantidad;
  END IF;

  INSERT INTO devoluciones (venta_id, producto_id, sede_id, cantidad, motivo,
    registrado_por, reingresa_stock, estado)
  VALUES (p_venta_id, p_producto_id, p_sede_id, p_cantidad,
    COALESCE(p_motivo, 'Sin motivo'), v_usuario_id, v_reingresa, 'procesada')
  RETURNING id, numero INTO v_dev_id, v_numero;

  UPDATE inventario
     SET cantidad = cantidad + (v_signo * p_cantidad),
         ultimo_movimiento = now(), updated_at = now()
   WHERE producto_id = p_producto_id AND sede_id = p_sede_id
   RETURNING cantidad INTO v_stock_post;

  INSERT INTO movimientos (producto_id, sede_id, tipo, cantidad,
    stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
  VALUES (p_producto_id, p_sede_id, 'devolucion', v_signo * p_cantidad,
    v_stock_ant, v_stock_post, v_dev_id, 'devolucion', v_usuario_id,
    CASE WHEN p_tipo = 'cliente' THEN 'Devolución de cliente #' || v_numero
         ELSE 'Devolución a proveedor #' || v_numero END);

  PERFORM fn_actualizar_estado_stock(p_producto_id, p_sede_id);

  RETURN jsonb_build_object(
    'devolucion_id', v_dev_id, 'numero', v_numero, 'tipo', p_tipo,
    'delta_stock', v_signo * p_cantidad,
    'stock_anterior', v_stock_ant, 'stock_posterior', v_stock_post
  );
END;
$function$;

-- fn_registrar_cambio: encender la señal cdv.cambio_interno justo alrededor de
-- la llamada a la devolución y apagarla enseguida (misma mecánica que ya usa
-- para cdv.caja_menor_metodo). El resto de la función queda idéntico.
create or replace function public.fn_registrar_cambio(
  p_venta_original_id uuid, p_producto_devuelto_id uuid, p_cant_dev integer,
  p_producto_nuevo_id uuid, p_cant_nuevo integer, p_sede_id text,
  p_metodo text default 'Efectivo'::text, p_cuenta_bancaria text default null::text,
  p_motivo text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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

  -- Señal para que fn_registrar_devolucion permita esta devolución compuesta:
  -- el rol y la sede ya se validaron arriba. Se apaga justo después.
  perform set_config('cdv.cambio_interno', '1', true);
  v_dev := fn_registrar_devolucion(
    'cliente', p_producto_devuelto_id, p_sede_id, p_cant_dev,
    coalesce(nullif(btrim(p_motivo), ''), 'Cambio de producto'),
    p_venta_original_id
  );
  perform set_config('cdv.cambio_interno', '', true);

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
      perform set_config('cdv.caja_menor_metodo', coalesce(p_metodo, ''), true);
      perform set_config('cdv.caja_menor_cuenta', coalesce(nullif(btrim(coalesce(p_cuenta_bancaria, '')), ''), ''), true);
      v_egreso := fn_registrar_caja_menor(
        p_sede_id,
        format('Devolución por cambio - venta #%s', v_venta.numero),
        v_reembolso,
        coalesce(nullif(v_venta.cliente_nombre, ''), 'Cliente'),
        format('Diferencia a favor del cliente en cambio de producto (venta #%s)', v_venta.numero)
      );
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
