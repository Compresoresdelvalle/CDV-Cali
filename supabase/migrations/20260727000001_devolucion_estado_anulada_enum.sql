-- Anular devoluciones: nuevo estado en el enum. Va en su propia migración porque
-- Postgres no permite USAR un valor de enum recién agregado en la misma
-- transacción en que se agregó; la función que lo usa se crea aparte
-- (20260727000002_fn_anular_devolucion.sql).
ALTER TYPE estado_devolucion ADD VALUE IF NOT EXISTS 'anulada';
