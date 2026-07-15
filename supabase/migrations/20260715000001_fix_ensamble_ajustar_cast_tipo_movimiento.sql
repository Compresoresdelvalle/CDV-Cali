-- ============================================================================
-- FIX: cambiar la cantidad de un insumo en un ensamble fallaba SIEMPRE.
--
-- El trigger trg_ensamble_detalle_ajustar (AFTER UPDATE OF cantidad ON
-- detalle_ensamble) construía el `tipo` del movimiento con un CASE:
--     CASE WHEN v_diff > 0 THEN 'ensamble_consumo' ELSE 'devolucion' END
-- Una expresión CASE con literales resuelve a `text`, y la columna
-- movimientos.tipo es el enum tipo_movimiento. Postgres no castea implícito
-- text -> enum, así que el INSERT reventaba con:
--   "column tipo is of type tipo_movimiento but expression is of type text"
-- y el UPDATE de detalle_ensamble se revertía. Efecto para la usuaria: al
-- editar la cantidad de un componente del ensamble, "el botón no servía".
--
-- (Los triggers de INSERT y DELETE no fallan porque usan un literal simple,
--  que sí se coacciona directo al enum.)
--
-- Fix: castear la expresión a ::tipo_movimiento. Sin otros cambios de lógica.
-- ============================================================================
create or replace function public.trg_ensamble_detalle_ajustar()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
DECLARE v_sede text; v_cant int; v_diff int; v_nombre text; v_actor uuid;
BEGIN
  v_diff := NEW.cantidad - OLD.cantidad;
  IF v_diff = 0 THEN RETURN NEW; END IF;
  SELECT sede_id, realizado_por INTO v_sede, v_actor FROM ensambles WHERE id = NEW.ensamble_id;
  SELECT cantidad_insumo INTO v_cant FROM inventario
   WHERE producto_id = NEW.producto_id AND sede_id = v_sede FOR UPDATE;
  IF v_diff > 0 AND COALESCE(v_cant, 0) < v_diff THEN
    SELECT nombre INTO v_nombre FROM productos WHERE id = NEW.producto_id;
    RAISE EXCEPTION 'Stock de insumo insuficiente para aumentar "%" (necesita % más, hay %).',
      COALESCE(v_nombre, NEW.producto_id::text), v_diff, COALESCE(v_cant, 0);
  END IF;
  UPDATE inventario SET cantidad_insumo = cantidad_insumo - v_diff,
    ultimo_movimiento = now(), updated_at = now()
   WHERE producto_id = NEW.producto_id AND sede_id = v_sede;
  INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id, observaciones)
  VALUES ((CASE WHEN v_diff > 0 THEN 'ensamble_consumo' ELSE 'devolucion' END)::tipo_movimiento,
    NEW.producto_id, v_sede, -v_diff, COALESCE(v_cant,0), COALESCE(v_cant,0) - v_diff,
    NEW.ensamble_id, 'ensamble', COALESCE(auth.uid(), v_actor),
    'Ajuste de insumo de ensamble');
  PERFORM fn_actualizar_estado_stock(NEW.producto_id, v_sede);
  RETURN NEW;
END $function$;
