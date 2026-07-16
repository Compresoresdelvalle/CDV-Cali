-- S4-06: fn_actualizar_estado_stock — Sobrestock solo cuando stock_maximo>0 (max=0/NULL = sin techo)
CREATE OR REPLACE FUNCTION public.fn_actualizar_estado_stock(p_producto_id uuid, p_sede_id text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_cantidad INTEGER; v_min INTEGER; v_max INTEGER; v_nuevo estado_stock;
BEGIN
  SELECT i.cantidad, p.stock_minimo, p.stock_maximo
  INTO v_cantidad, v_min, v_max
  FROM inventario i JOIN productos p ON p.id = i.producto_id
  WHERE i.producto_id = p_producto_id AND i.sede_id = p_sede_id;

  v_nuevo := CASE
    WHEN v_cantidad <= 0 THEN 'Agotado'   -- #10: negativo también es Agotado
    WHEN v_cantidad <= v_min THEN 'Bajo'
    WHEN v_max IS NOT NULL AND v_max > 0 AND v_cantidad > v_max THEN 'Sobrestock'  -- S4-06: max=0/NULL = sin techo
    ELSE 'OK'
  END;

  UPDATE inventario SET estado_stock = v_nuevo, updated_at = now()
  WHERE producto_id = p_producto_id AND sede_id = p_sede_id;
END; $function$;

-- S4-06 + S4-D2 BACKFILL: recalcular estado_stock con la fórmula corregida para filas incorrectas
WITH calc AS (
  SELECT i.producto_id, i.sede_id,
    CASE
      WHEN i.cantidad <= 0 THEN 'Agotado'
      WHEN i.cantidad <= p.stock_minimo THEN 'Bajo'
      WHEN p.stock_maximo IS NOT NULL AND p.stock_maximo > 0 AND i.cantidad > p.stock_maximo THEN 'Sobrestock'
      ELSE 'OK'
    END::estado_stock AS correcto
  FROM inventario i JOIN productos p ON p.id = i.producto_id
)
UPDATE inventario inv SET estado_stock = c.correcto, updated_at = now()
FROM calc c
WHERE inv.producto_id = c.producto_id AND inv.sede_id = c.sede_id
  AND inv.estado_stock IS DISTINCT FROM c.correcto;
