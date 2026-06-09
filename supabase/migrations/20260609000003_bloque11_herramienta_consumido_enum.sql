-- Bloque 11 — Herramientas: nuevo estado 'consumido' (no regresa a inventario).
-- (ADD VALUE va en su propia migración: no se puede usar un valor de enum
--  recién creado dentro de la misma transacción.)
alter type public.estado_herramienta add value if not exists 'consumido';
