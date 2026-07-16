-- S4-08: recalcular inventario.estado_stock cuando se editan productos.stock_minimo/stock_maximo
CREATE OR REPLACE FUNCTION public.trg_productos_recalc_estado_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT sede_id FROM inventario WHERE producto_id = NEW.id LOOP
    PERFORM fn_actualizar_estado_stock(NEW.id, r.sede_id);
  END LOOP;
  RETURN NEW;
END $function$;

CREATE TRIGGER trg_productos_recalc_estado_stock
  AFTER UPDATE OF stock_minimo, stock_maximo ON public.productos
  FOR EACH ROW
  WHEN (OLD.stock_minimo IS DISTINCT FROM NEW.stock_minimo OR OLD.stock_maximo IS DISTINCT FROM NEW.stock_maximo)
  EXECUTE FUNCTION trg_productos_recalc_estado_stock();
