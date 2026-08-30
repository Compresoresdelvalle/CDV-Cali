-- El DROP es obligatorio: agregar un parámetro con DEFAULT crea una función
-- NUEVA y deja viva la de 9 argumentos. PostgREST vería dos candidatas y
-- fallaría con "Could not choose the best candidate function".
DROP FUNCTION IF EXISTS public.fn_registrar_cambio(
  uuid, uuid, integer, uuid, integer, text, text, text, text);

CREATE OR REPLACE FUNCTION public.fn_registrar_cambio(
  p_venta_original_id uuid,
  p_producto_devuelto_id uuid,
  p_cant_dev integer,
  p_producto_nuevo_id uuid,
  p_cant_nuevo integer,
  p_sede_id text,
  p_metodo text DEFAULT 'Efectivo'::text,
  p_cuenta_bancaria text DEFAULT NULL::text,
  p_motivo text DEFAULT NULL::text,
  p_precio_nuevo numeric DEFAULT NULL::numeric
)
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
  v_precio_lista numeric;
  v_precio_nuevo numeric;
  v_valor_dev numeric;
  v_valor_nuevo numeric;
  v_diferencia numeric;
  v_iva_factor numeric;
  v_obs text;
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
  -- Se valida ANTES de mover stock o plata.
  if p_precio_nuevo is not null and p_precio_nuevo < 0 then
    raise exception 'El precio acordado no puede ser negativo';
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

  -- Crédito por lo que devuelve.
  --
  -- En una venta de CAMBIO, `descuento_valor` guarda la permuta (lo que valía
  -- el producto que el cliente entregó), no un descuento comercial. Aplicarle
  -- el ratio subvaloraba el crédito: revertir un cambio terminaba cobrándole al
  -- cliente. Ahí el crédito correcto es el subtotal de la línea, tal cual.
  if v_venta.cambio_de_venta_id is not null then
    v_ratio := 1;
  else
    v_sub_total := coalesce(v_venta.subtotal, 0);
    v_desc_v := coalesce(v_venta.descuento_valor, v_sub_total * coalesce(v_venta.descuento_pct, 0) / 100.0);
    v_desc_v := greatest(0, least(v_desc_v, v_sub_total));
    v_ratio := case when v_sub_total > 0 then (v_sub_total - v_desc_v) / v_sub_total else 1 end;
  end if;

  v_valor_dev := round((v_sub_dev / v_vendido) * p_cant_dev * v_ratio);

  select precio_venta into v_precio_lista from productos where id = p_producto_nuevo_id and activo = true;
  if v_precio_lista is null then raise exception 'Producto nuevo no encontrado o inactivo'; end if;

  -- ESTE es el arreglo: antes siempre se usaba el precio de lista, así que el
  -- descuento dado en la venta original se le cobraba de vuelta al cliente y
  -- entraba a la caja del día una plata que nadie había entregado.
  -- Sin precio acordado se cae en la lista, o sea el comportamiento de siempre.
  v_precio_nuevo := coalesce(p_precio_nuevo, v_precio_lista);
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

  -- El prefijo "Cambio por venta #" lo detecta VentaDetalle para bloquear la
  -- anulación por separado: no se puede cambiar.
  v_obs := format('Cambio por venta #%s: entrega %s u. del nuevo, devuelve %s u. del original',
                  v_venta.numero, p_cant_nuevo, p_cant_dev);
  if v_precio_nuevo is distinct from v_precio_lista then
    v_obs := v_obs || format(' · precio acordado %s (lista %s)',
                             round(v_precio_nuevo), round(v_precio_lista));
  end if;

  v_venta_nueva := fn_registrar_venta(
    p_sede_id,
    v_venta.cliente_nombre,
    v_venta.cliente_nit,
    p_metodo,
    0,
    v_obs,
    jsonb_build_array(jsonb_build_object(
      'producto_id', p_producto_nuevo_id,
      'cantidad', p_cant_nuevo,
      'precio_unitario', v_precio_nuevo)),
    coalesce(v_venta.iva_pct, 0),
    p_cuenta_bancaria,
    v_valor_dev,
    0
  );
  v_venta_nueva_id := (v_venta_nueva->>'venta_id')::uuid;

  -- Enlace explícito. El trigger trg_ventas_proteger_anulacion solo se opone a
  -- que cambie `anulada`, así que este UPDATE pasa sin señales de sesión.
  update ventas set cambio_de_venta_id = p_venta_original_id
   where id = v_venta_nueva_id;

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
    'precio_nuevo_aplicado', v_precio_nuevo,
    'precio_lista_nuevo', v_precio_lista,
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

-- El DROP se llevó los permisos. Supabase concede EXECUTE a `anon` por defecto
-- a toda función nueva de public, y REVOKE ... FROM PUBLIC no lo quita porque
-- el de anon es un grant explícito. Regla del proyecto: la anon key nunca
-- escribe.
REVOKE ALL ON FUNCTION public.fn_registrar_cambio(uuid,uuid,integer,uuid,integer,text,text,text,text,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_registrar_cambio(uuid,uuid,integer,uuid,integer,text,text,text,text,numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_registrar_cambio(uuid,uuid,integer,uuid,integer,text,text,text,text,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_registrar_cambio(uuid,uuid,integer,uuid,integer,text,text,text,text,numeric) TO service_role;
