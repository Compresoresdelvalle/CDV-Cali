-- TAREA A (revisión de problemas, Sección 11): blindar recibos y detalle_recibo.
-- Hoy authenticated y anon tienen INSERT/UPDATE/DELETE/TRUNCATE, lo que permite por
-- REST directo borrar un recibo (rompe el consecutivo) o marcarlo anulado saltándose
-- fn_anular_recibo (que limpia el abono → quedaría abono huérfano).
-- Replicamos el patrón ya usado en ventas/compras/garantias_venta: solo SELECT.
-- Toda escritura pasa por los RPC SECURITY DEFINER fn_registrar_recibo / fn_anular_recibo,
-- que corren como owner y NO dependen de estos grants.
-- Las policies recibos_rw / detalle_recibo_rw (tipo ALL) se conservan: siguen dando el
-- SELECT por sede y quedan INERTES para escritura al no existir grant que las respalde
-- (mismo criterio que garantias_venta / ventas).

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.recibos        FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.detalle_recibo FROM authenticated, anon;
