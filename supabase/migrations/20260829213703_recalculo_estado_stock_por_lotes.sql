-- Min/max por sede, paso final: recalcular el estado de todas las filas.
--
-- `inventario` esta publicada en supabase_realtime: un UPDATE masivo emite un
-- evento por fila a cada cliente conectado. Por eso la funcion no escribe
-- cuando el estado no cambia (IS DISTINCT FROM) y aqui se pausa cada 250 filas.
--
-- Medido antes de correr: de las 5.624 filas solo ~30 cambian de estado, casi
-- todas por el arreglo de los insumos. Esto es consecuencia de haber dejado
-- `estado_stock` como un hecho fisico en vez de meterle un valor nuevo al enum:
-- si el minimo 0 hubiera cambiado el estado, habrian sido ~2.900.
DO $$
DECLARE r RECORD; n INT := 0;
BEGIN
  FOR r IN SELECT producto_id, sede_id FROM inventario ORDER BY producto_id, sede_id LOOP
    PERFORM public.fn_actualizar_estado_stock(r.producto_id, r.sede_id);
    n := n + 1;
    IF n % 250 = 0 THEN PERFORM pg_sleep(0.4); END IF;
  END LOOP;
  RAISE NOTICE 'Estado recalculado sobre % filas de inventario', n;
END $$;
