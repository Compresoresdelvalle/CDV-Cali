-- Enlace explícito de una venta de CAMBIO con la venta original.
--
-- Sirve para dos cosas. La primera es el cálculo del crédito: en una venta de
-- cambio, `descuento_valor` guarda la PERMUTA (lo que valía el producto que el
-- cliente entregó), no un descuento comercial. Aplicarle el ratio de descuento
-- al devolver ese producto subvaloraba el crédito — en la venta #1677 daba
-- $5.000 en vez de $30.000, y revertir un cambio terminaba cobrándole al
-- cliente. La segunda es reemplazar el parseo por regex de la observación con
-- el que hoy VentaDetalle averigua de qué venta viene un cambio.
--
-- NO participa en ningún cálculo de dinero: no toca `total`, `subtotal` ni
-- `descuento_valor`, y el cierre no la mira.
alter table ventas
  add column if not exists cambio_de_venta_id uuid references ventas(id);

comment on column ventas.cambio_de_venta_id is
  'Venta original de la que proviene este cambio. Cuando no es nula, descuento_valor es una permuta, no un descuento comercial.';

create index if not exists idx_ventas_cambio_de_venta
  on ventas(cambio_de_venta_id) where cambio_de_venta_id is not null;

-- Backfill de los cambios ya registrados, por el número que quedó en la
-- observación. `ventas.numero` es identity, así que es único en toda la tabla.
-- Lo que no matchee se queda en nulo y se comporta como hasta hoy.
update ventas v
   set cambio_de_venta_id = o.id
  from ventas o
 where v.observaciones ~ '^Cambio por venta #[0-9]+'
   and v.cambio_de_venta_id is null
   and o.numero = (regexp_match(v.observaciones, '^Cambio por venta #([0-9]+)'))[1]::int;
