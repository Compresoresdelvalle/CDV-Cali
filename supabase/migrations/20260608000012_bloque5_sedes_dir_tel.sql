-- Bloque 5 — Datos de sede para recibos: dirección común + teléfono por sede.
-- Los recibos ya leen estas constantes en pdfStyles.js; se sincroniza la tabla
-- `sedes` para consistencia y uso futuro en vistas data-driven. BODEGA no tiene
-- teléfono propio (se omite la línea de teléfono en los recibos de esa sede).
update public.sedes set direccion = 'Calle 34 #4b-30'
  where id in ('BODEGA', 'CV', 'L3', 'CHV');
update public.sedes set telefono = '3127536787' where id = 'CV';
update public.sedes set telefono = '3114940799' where id = 'L3';
update public.sedes set telefono = '3174675905' where id = 'CHV';
