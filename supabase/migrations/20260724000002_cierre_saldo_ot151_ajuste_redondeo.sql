-- Cierre del saldo residual de OT-151 (1 peso) por redondeo a pesos enteros.
--
-- Tras 20260724000001 el total de OT-151 pasó de 398.999,86 a 399.000 (regla de
-- redondeo de la app). El cliente ya había pagado 398.999 por transferencia (lo
-- máximo que el bug del tope le dejó registrar), así que queda 1 peso de saldo.
-- En COP no existe moneda de 1 peso: se salda con un abono de ajuste por
-- redondeo, dejando la OT lista para facturar (Convertir a venta) sin fricción.
--
-- Idempotente y auto-calculado: sólo inserta si aún hay saldo > 0 y no existe ya
-- un ajuste de redondeo para la orden.
insert into public.abonos (orden_id, monto, metodo_pago, observaciones, registrado_por)
select o.id,
       o.total - coalesce((select sum(a.monto) from abonos a where a.orden_id = o.id), 0),
       'efectivo',
       'Ajuste por redondeo a pesos enteros (cierre de saldo residual del fix de centavos).',
       (select id from usuarios where rol = 'Admin' order by nombre limit 1)
  from public.ordenes_servicio o
 where o.numero = 151
   and o.total - coalesce((select sum(a.monto) from abonos a where a.orden_id = o.id), 0) > 0
   and not exists (
     select 1 from abonos a
      where a.orden_id = o.id
        and a.observaciones like 'Ajuste por redondeo%'
   );
