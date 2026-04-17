-- Tarea 2: Asignar mínimo 50 unidades por producto en todas las sedes (para pruebas funcionales)
UPDATE inventario
SET
  cantidad = GREATEST(cantidad, 50),
  estado_stock = CASE
    WHEN GREATEST(cantidad, 50) >= COALESCE(
      (SELECT stock_minimo FROM productos p WHERE p.id = inventario.producto_id), 0
    ) THEN 'OK'::estado_stock
    WHEN GREATEST(cantidad, 50) > 0 THEN 'Bajo'::estado_stock
    ELSE 'Agotado'::estado_stock
  END;
