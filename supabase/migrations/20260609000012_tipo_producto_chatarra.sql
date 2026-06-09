-- Nuevo tipo de producto: 'chatarra' (retorno defectuoso por garantía, no
-- vendible). Va en su propia migración porque Postgres no permite usar un valor
-- de enum recién agregado dentro de la misma transacción que lo crea.
alter type public.tipo_producto add value if not exists 'chatarra';
