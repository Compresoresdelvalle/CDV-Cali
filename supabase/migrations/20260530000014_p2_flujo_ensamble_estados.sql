-- ============================================================================
-- Parte 2 — A9: nuevo flujo de ensamble (estados + consumo de insumo al ponerlo).
--   - ensambles.tecnico_id (técnico asignado por la vendedora) + terminado (bool).
--     Flujo: en_proceso (creado) → terminado (técnico) → completado (vendedora).
--   - Los INSUMOS se consumen al INSERTAR el detalle (no al completar) y se
--     devuelven al BORRARLO / al ajustar cantidad — vía triggers en detalle_ensamble.
--   - trg_ensamble_stock (completar) ahora SOLO produce el resultado + notifica.
--   - fn_eliminar_ensamble: quita el producido (si completado) y borra el detalle
--     (el trigger de DELETE devuelve los insumos).
-- ============================================================================

ALTER TABLE public.ensambles
  ADD COLUMN IF NOT EXISTS tecnico_id uuid REFERENCES public.usuarios(id);
ALTER TABLE public.ensambles
  ADD COLUMN IF NOT EXISTS terminado boolean NOT NULL DEFAULT false;

-- Migrar existentes: los ya completados se consideran 'terminado'.
UPDATE public.ensambles SET terminado = true WHERE completado = true AND terminado = false;

-- ── detalle_ensamble: consumir insumo al INSERTAR ───────────────────────────
CREATE OR REPLACE FUNCTION public.trg_ensamble_detalle_consumir()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_sede text; v_cant int; v_nombre text; v_actor uuid;
BEGIN
  SELECT sede_id, realizado_por INTO v_sede, v_actor FROM ensambles WHERE id = NEW.ensamble_id;
  SELECT cantidad_insumo INTO v_cant FROM inventario
   WHERE producto_id = NEW.producto_id AND sede_id = v_sede FOR UPDATE;
  IF v_cant IS NULL OR v_cant < NEW.cantidad THEN
    SELECT nombre INTO v_nombre FROM productos WHERE id = NEW.producto_id;
    RAISE EXCEPTION 'Stock de insumo insuficiente del componente "%" (necesita %, hay %). Convierte stock de venta a insumo primero.',
      COALESCE(v_nombre, NEW.producto_id::text), NEW.cantidad, COALESCE(v_cant, 0);
  END IF;
  UPDATE inventario SET cantidad_insumo = cantidad_insumo - NEW.cantidad,
    ultimo_movimiento = now(), updated_at = now()
   WHERE producto_id = NEW.producto_id AND sede_id = v_sede;
  INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id)
  VALUES ('ensamble_consumo', NEW.producto_id, v_sede, -NEW.cantidad,
    v_cant, v_cant - NEW.cantidad, NEW.ensamble_id, 'ensamble', v_actor);
  PERFORM fn_actualizar_estado_stock(NEW.producto_id, v_sede);
  RETURN NEW;
END $function$;

-- ── detalle_ensamble: devolver insumo al BORRAR ─────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_ensamble_detalle_devolver()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_sede text; v_cant int; v_actor uuid;
BEGIN
  SELECT sede_id, realizado_por INTO v_sede, v_actor FROM ensambles WHERE id = OLD.ensamble_id;
  IF v_sede IS NULL THEN RETURN OLD; END IF; -- el ensamble ya no existe (raro): nada que hacer
  SELECT cantidad_insumo INTO v_cant FROM inventario
   WHERE producto_id = OLD.producto_id AND sede_id = v_sede FOR UPDATE;
  IF v_cant IS NULL THEN
    INSERT INTO inventario (producto_id, sede_id, cantidad_insumo)
    VALUES (OLD.producto_id, v_sede, OLD.cantidad);
    v_cant := 0;
  ELSE
    UPDATE inventario SET cantidad_insumo = cantidad_insumo + OLD.cantidad,
      ultimo_movimiento = now(), updated_at = now()
     WHERE producto_id = OLD.producto_id AND sede_id = v_sede;
  END IF;
  INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id, observaciones)
  VALUES ('devolucion', OLD.producto_id, v_sede, OLD.cantidad,
    v_cant, v_cant + OLD.cantidad, OLD.ensamble_id, 'ensamble', COALESCE(auth.uid(), v_actor),
    'Devolución de insumo de ensamble');
  PERFORM fn_actualizar_estado_stock(OLD.producto_id, v_sede);
  RETURN OLD;
END $function$;

-- ── detalle_ensamble: ajustar insumo al CAMBIAR cantidad ────────────────────
CREATE OR REPLACE FUNCTION public.trg_ensamble_detalle_ajustar()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
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
  VALUES (CASE WHEN v_diff > 0 THEN 'ensamble_consumo' ELSE 'devolucion' END,
    NEW.producto_id, v_sede, -v_diff, COALESCE(v_cant,0), COALESCE(v_cant,0) - v_diff,
    NEW.ensamble_id, 'ensamble', COALESCE(auth.uid(), v_actor),
    'Ajuste de insumo de ensamble');
  PERFORM fn_actualizar_estado_stock(NEW.producto_id, v_sede);
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_detalle_ensamble_ins ON public.detalle_ensamble;
CREATE TRIGGER trg_detalle_ensamble_ins AFTER INSERT ON public.detalle_ensamble
  FOR EACH ROW EXECUTE FUNCTION public.trg_ensamble_detalle_consumir();
DROP TRIGGER IF EXISTS trg_detalle_ensamble_del ON public.detalle_ensamble;
CREATE TRIGGER trg_detalle_ensamble_del AFTER DELETE ON public.detalle_ensamble
  FOR EACH ROW EXECUTE FUNCTION public.trg_ensamble_detalle_devolver();
DROP TRIGGER IF EXISTS trg_detalle_ensamble_upd ON public.detalle_ensamble;
CREATE TRIGGER trg_detalle_ensamble_upd AFTER UPDATE OF cantidad ON public.detalle_ensamble
  FOR EACH ROW EXECUTE FUNCTION public.trg_ensamble_detalle_ajustar();

-- ── Completar ensamble: SOLO produce el resultado + notifica ────────────────
-- (el consumo de insumos ya ocurrió al insertar el detalle).
CREATE OR REPLACE FUNCTION public.trg_ensamble_stock()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_stock_resultado INTEGER; v_costo NUMERIC := 0;
  v_prod_result TEXT; v_sede_nombre TEXT;
BEGIN
  IF NEW.completado = true AND (OLD.completado = false OR OLD.completado IS NULL) THEN
    PERFORM pg_advisory_xact_lock(hashtext('ensamble:' || NEW.id::text));

    SELECT cantidad INTO v_stock_resultado FROM inventario
     WHERE producto_id = NEW.producto_resultado_id AND sede_id = NEW.sede_id FOR UPDATE;
    IF v_stock_resultado IS NULL THEN
      INSERT INTO inventario (producto_id, sede_id, cantidad)
      VALUES (NEW.producto_resultado_id, NEW.sede_id, NEW.cantidad_producida);
      v_stock_resultado := 0;
    ELSE
      UPDATE inventario SET cantidad = cantidad + NEW.cantidad_producida,
        ultimo_movimiento = now(), updated_at = now()
       WHERE producto_id = NEW.producto_resultado_id AND sede_id = NEW.sede_id;
    END IF;
    INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id)
    VALUES ('ensamble_produccion', NEW.producto_resultado_id, NEW.sede_id,
      NEW.cantidad_producida, v_stock_resultado, v_stock_resultado + NEW.cantidad_producida,
      NEW.id, 'ensamble', NEW.realizado_por);

    SELECT COALESCE(SUM(costo_unitario * cantidad), 0) INTO v_costo
      FROM detalle_ensamble WHERE ensamble_id = NEW.id;
    UPDATE ensambles SET costo_total = v_costo WHERE id = NEW.id;
    PERFORM fn_actualizar_estado_stock(NEW.producto_resultado_id, NEW.sede_id);

    SELECT nombre INTO v_prod_result FROM productos WHERE id = NEW.producto_resultado_id;
    SELECT nombre INTO v_sede_nombre FROM sedes WHERE id = NEW.sede_id;
    INSERT INTO notificaciones (tipo, titulo, mensaje, data, para_rol, created_by)
    VALUES (
      'ensamble_creado', 'Ensamble completado',
      format('Se ensamblaron %s ud(s) de "%s" en %s (costo de materiales: %s). Revisa el precio/costo del producto.',
        NEW.cantidad_producida, COALESCE(v_prod_result, NEW.producto_resultado_id::text),
        COALESCE(v_sede_nombre, NEW.sede_id), round(v_costo)),
      jsonb_build_object('producto_id', NEW.producto_resultado_id, 'producto', v_prod_result,
        'sede_id', NEW.sede_id, 'cantidad', NEW.cantidad_producida,
        'costo_materiales', v_costo, 'ensamble_id', NEW.id),
      'Admin', NEW.realizado_por
    );
  END IF;
  RETURN NEW;
END $function$;

-- ── fn_eliminar_ensamble: quita producido (si completado) y borra detalle ───
-- (el trigger de DELETE de detalle_ensamble devuelve los insumos).
CREATE OR REPLACE FUNCTION public.fn_eliminar_ensamble(p_ensamble_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_rol text;
  v_ens RECORD; v_result_stock int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::text INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol <> 'Admin' THEN RAISE EXCEPTION 'Solo el Admin puede eliminar ensambles'; END IF;

  SELECT * INTO v_ens FROM ensambles WHERE id = p_ensamble_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ensamble no encontrado'; END IF;

  IF v_ens.completado THEN
    SELECT cantidad INTO v_result_stock FROM inventario
     WHERE producto_id = v_ens.producto_resultado_id AND sede_id = v_ens.sede_id FOR UPDATE;
    IF COALESCE(v_result_stock, 0) < v_ens.cantidad_producida THEN
      RAISE EXCEPTION 'No se puede deshacer: el producto resultante ya no tiene stock suficiente (hay %, se produjeron %). Quizá ya se vendió o trasladó.',
        COALESCE(v_result_stock, 0), v_ens.cantidad_producida;
    END IF;
    UPDATE inventario SET cantidad = cantidad - v_ens.cantidad_producida,
      ultimo_movimiento = now(), updated_at = now()
     WHERE producto_id = v_ens.producto_resultado_id AND sede_id = v_ens.sede_id;
    INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, observaciones)
    VALUES ('ajuste', v_ens.producto_resultado_id, v_ens.sede_id, -v_ens.cantidad_producida,
      v_result_stock, v_result_stock - v_ens.cantidad_producida, p_ensamble_id, 'ensamble', v_uid,
      'Reversa por eliminación de ensamble');
    PERFORM fn_actualizar_estado_stock(v_ens.producto_resultado_id, v_ens.sede_id);
  END IF;

  -- Borrar el detalle (el trigger AFTER DELETE devuelve los insumos al pool).
  DELETE FROM detalle_ensamble WHERE ensamble_id = p_ensamble_id;
  DELETE FROM ensambles WHERE id = p_ensamble_id;

  RETURN jsonb_build_object('eliminado', p_ensamble_id, 'completado_era', v_ens.completado);
END $function$;
