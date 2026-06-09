-- Bloque 8 — Ensambles: crear ESPUMADORA 45 GL como producto ensamblable.
-- Precio y costo en 0 (PLACEHOLDER): el Admin los ajusta luego en el catálogo.
-- Los ensambles eligen sus componentes al armar (no usan receta BOM fija), por
-- lo que basta con que el producto exista y sea `ensamblable`.
insert into public.productos (
  referencia, nombre, categoria, precio_venta, costo_promedio,
  ensamblable, vendible, activo
)
select 'E45GL', 'ESPUMADORA 45 GL', 'ESPUMADORAS', 0, 0, true, true, true
where not exists (select 1 from productos where referencia = 'E45GL');
