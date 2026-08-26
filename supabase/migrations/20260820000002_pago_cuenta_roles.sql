-- Cuentas por cobrar y por pagar para vendedoras y bodega.
--
-- Antes: solo el Admin podía registrar cobros o pagos, así que abrir la
-- pantalla a otros roles habría mostrado una lista con un botón que revienta.
--
-- Ahora cada rol registra lo suyo y solo en su sede:
--   Vendedor  -> cobros de ventas de su sede
--   Bodeguero -> pagos de compras que llegan a su sede
--   Admin     -> todo, en cualquier sede
--
-- Anular un pago sigue siendo exclusivo del Admin (fn_eliminar_pago_cuenta):
-- registrar y anular no son simétricos, anular deshace un movimiento contable.
--
-- El control vive aquí y no en la pantalla: un vendedor que llame la RPC a mano
-- con tipo 'pago' es rechazado por la función.
--
-- Todo lo demás se conserva literal de la versión anterior: tope contra el
-- saldo, método de pago obligatorio, cuenta bancaria en electrónicos, bloqueo
-- de ventas anuladas y compras canceladas, y el FOR UPDATE.

CREATE OR REPLACE FUNCTION public.fn_registrar_pago_cuenta(p_payload jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  if v_tipo = 'cobro' then
    select * into v_venta from ventas where id = (p_payload->>'venta_id')::uuid for update;
    if not found then raise exception 'Venta no encontrada'; end if;

    if v_rol <> 'Admin' and v_venta.sede_id is distinct from v_sede then
      raise exception 'Solo puedes registrar cobros de ventas de tu propia sede';
    end if;

    if coalesce(v_venta.anulada, false) then raise exception 'La venta está anulada'; end if;

    select coalesce(sum(a.monto),0) into v_abonos_cotiz
      from abonos_cotizacion a join cotizaciones c on c.id = a.cotizacion_id
      where c.venta_id = v_venta.id;

    if v_venta.metodo_pago is distinct from 'Crédito' and v_abonos_cotiz <= 0 then
      raise exception 'La venta no admite cobros (no es a crédito ni tiene abonos de cotización)';
    end if;

    select coalesce(sum(p.monto),0) into v_pagos
      from pagos_cuenta p
     where p.venta_id = v_venta.id and p.tipo = 'cobro' and coalesce(p.anulado,false) = false;
    v_saldo := coalesce(v_venta.total,0) - v_abonos_cotiz - v_pagos;
    if v_monto > v_saldo + 0.01 then
      raise exception 'El monto (%) supera el saldo pendiente (%)', v_monto, v_saldo;
    end if;
    insert into pagos_cuenta (tipo, venta_id, monto, metodo_pago, cuenta_bancaria, observaciones, registrado_por)
    values ('cobro', v_venta.id, v_monto, v_metodo, v_cuenta, nullif(trim(p_payload->>'observaciones'),''), v_uid);
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
    select coalesce(sum(p.monto),0) into v_pagos
      from pagos_cuenta p
     where p.compra_id = v_compra.id and p.tipo = 'pago' and coalesce(p.anulado,false) = false;
    v_saldo := coalesce(v_compra.total,0) - v_pagos;
    if v_monto > v_saldo + 0.01 then
      raise exception 'El monto (%) supera el saldo pendiente (%)', v_monto, v_saldo;
    end if;
    insert into pagos_cuenta (tipo, compra_id, monto, metodo_pago, cuenta_bancaria, observaciones, registrado_por)
    values ('pago', v_compra.id, v_monto, v_metodo, v_cuenta, nullif(trim(p_payload->>'observaciones'),''), v_uid);
    return v_saldo - v_monto;
  else
    raise exception 'tipo inválido (cobro|pago)';
  end if;
end $function$;
