-- El abono de $1 que cerró el saldo de OT-151 quedó marcado como 'efectivo',
-- pero nadie metió ese peso a la caja: es un asiento contable de redondeo.
--
-- Consecuencia real: el cierre de caja suma los abonos 'efectivo' del día por
-- sede para calcular el efectivo que debería estar físicamente en la gaveta
-- (fn de 20260622000001_cierres_detalle_avanzado). El cierre de CV del
-- 2026-07-24 todavía no se ha corrido, así que al hacer el arqueo el sistema
-- esperaría $1 más del que hay y Deyanira o Edna tendrían que explicar un
-- faltante que no existe.
--
-- Se pasa a 'otro', que la app ya conoce y rotula como "Otro" en el cierre
-- (METODO_LABELS en src/pages/admin/Cierres.jsx) y que no entra al arqueo de
-- efectivo. El monto sigue contando para el saldo de la OT: lo que cambia es
-- de qué caja se dice que salió, no cuánto se pagó.
--
-- Idempotente: solo toca la fila si sigue siendo el ajuste en efectivo.
--
-- Estado tras aplicarla (verificado): OT-151 con total 399.000, un abono de
-- 398.999 por transferencia y el ajuste de 1 como 'otro'. Saldo 0.

update public.abonos
   set metodo_pago = 'otro'
 where metodo_pago = 'efectivo'
   and observaciones like 'Ajuste por redondeo%'
   and orden_id = (select id from ordenes_servicio where numero = 151);
