-- El saldo de una factura retenida baja en la retencion desde el momento en que
-- se emite. Esa plata no la va a pagar el cliente: ya la consigno a la DIAN.
--
-- Sin este cambio pasan dos cosas, y la segunda es peor que la primera:
--   1. La factura queda para siempre con un saldo fantasma en Cuentas por Cobrar.
--   2. El ULTIMO cobro se rechaza. fn_registrar_pago_cuenta compara el monto
--      contra total - abonos - pagos, cree que todavia falta la retencion, y
--      responde "el monto supera el saldo pendiente". La factura no se puede
--      cerrar por ningun camino desde la app.
--
-- CREATE OR REPLACE VIEW solo permite AGREGAR columnas al final, no insertarlas
-- en medio, y hay que conservar security_invoker (verificado: la vista lo tiene,
-- y sin el cada vendedora veria las cuentas de las otras sedes).

CREATE OR REPLACE VIEW public.v_cuentas_por_cobrar
WITH (security_invoker = true) AS
 SELECT v.id AS venta_id,
    v.numero,
    v.fecha,
    v.cliente_nombre,
    v.sede_id,
    v.vendedor_id,
    COALESCE(v.total, 0::numeric) AS total,
    COALESCE(ac.abonos, 0::numeric) AS abonos_cotizacion,
    COALESCE(pc.pagos, 0::numeric) AS pagos_directos,
    COALESCE(v.total, 0::numeric)
      - COALESCE(v.retenciones_total, 0::numeric)
      - COALESCE(ac.abonos, 0::numeric)
      - COALESCE(pc.pagos, 0::numeric) AS saldo,
    COALESCE(v.retenciones_total, 0::numeric) AS retenciones_total
   FROM ventas v
     LEFT JOIN LATERAL ( SELECT sum(a.monto) AS abonos
           FROM abonos_cotizacion a
             JOIN cotizaciones c ON c.id = a.cotizacion_id
          WHERE c.venta_id = v.id) ac ON true
     LEFT JOIN LATERAL ( SELECT sum(p.monto) AS pagos
           FROM pagos_cuenta p
          WHERE p.venta_id = v.id AND p.tipo = 'cobro'::text AND COALESCE(p.anulado, false) = false) pc ON true
  WHERE COALESCE(v.anulada, false) = false AND (v.metodo_pago = 'Crédito'::text OR ac.abonos IS NOT NULL);

-- El tope de un cobro es el saldo NETO, con la misma formula que la vista.
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
    -- Lo cobrable es el NETO: la retencion no la paga el cliente, la consigna a
    -- la DIAN. Misma formula que v_cuentas_por_cobrar.saldo.
    v_saldo := coalesce(v_venta.total,0) - coalesce(v_venta.retenciones_total,0)
               - v_abonos_cotiz - v_pagos;
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
    -- Compras: la retencion siempre vale 0 hasta la fase 2, asi que restarla no
    -- cambia nada hoy y deja el camino listo.
    v_saldo := coalesce(v_compra.total,0) - coalesce(v_compra.retenciones_total,0) - v_pagos;
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
