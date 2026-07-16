-- S4-21: impedir productos con stock_maximo <= stock_minimo (salvo 0 = sin tope).
-- Verificado previamente: 0 filas incumplen (CDA ya corregido a 0/0).
alter table productos
  add constraint chk_stock_max_min
  check (stock_maximo = 0 OR stock_maximo > stock_minimo);
