-- Bloque 1 — Admin puede cancelar OT y compras.
-- Paso 1/2: agregar el estado 'cancelada' a los enums. Debe ir en una migración
-- SEPARADA de las funciones que lo usan (Postgres no permite usar un valor de
-- enum recién agregado en la misma transacción). Aditivo y reversible-en-uso.

alter type estado_orden add value if not exists 'cancelada';
alter type estado_compra add value if not exists 'cancelada';
