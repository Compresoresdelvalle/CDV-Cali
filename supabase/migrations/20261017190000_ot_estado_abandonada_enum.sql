-- Bloque 5 (decisión 5.0 de David, 2026-10-17): estado final "abandonada" para
-- la OT cuyo equipo el cliente nunca recogió. A diferencia de "cancelada", sus
-- abonos SIGUEN contando en el cierre (el cliente sí pagó la revisión).
--
-- Va sola porque un valor nuevo de enum no se puede usar en la misma
-- transacción en que se crea. La lógica va en la migración siguiente.
alter type public.estado_orden add value if not exists 'abandonada';
