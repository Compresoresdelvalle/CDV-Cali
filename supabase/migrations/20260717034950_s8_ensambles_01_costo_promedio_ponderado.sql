-- S8 Ensambles P0: al completar un ensamble, propagar el costo al costo_promedio
-- del producto resultado con PROMEDIO PONDERADO (patrón de compras/trg_compra_sumar_stock),
-- redondeado a pesos enteros (política 20260630000001).
-- Además: el guard de costos (productos_costo_guard) revertía en silencio la
-- actualización cuando el actor no era Admin (auth.uid() de Bodeguero/Vendedor).
-- Se agrega un flag transaccional 'app.costo_sistema' que solo los triggers del
-- sistema encienden alrededor de su UPDATE a productos.

CREATE OR REPLACE FUNCTION public.trg_productos_costo_solo_admin()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
begin
  -- Actualización de costo hecha por el sistema (triggers SECURITY DEFINER):
  -- el flag solo se enciende dentro de trg_ensamble_stock (y futuros triggers de sistema).
  if current_setting('app.costo_sistema', true) = 'on' then
    return new;
  end if;
  if auth.uid() is not null and coalesce(get_my_rol(),'') <> 'Admin' then
    if tg_op = 'INSERT' then
      new.costo_promedio := 0;
    elsif tg_op = 'UPDATE' then
      new.costo_promedio := old.costo_promedio;
      new.precio_venta   := old.precio_venta;
    end if;
  end if;
  return new;
end $fn$;

CREATE OR REPLACE FUNCTION public.trg_ensamble_stock()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_stock_resultado INTEGER; v_costo NUMERIC := 0;
  v_prod_result TEXT; v_sede_nombre TEXT;
  v_stock_global_prev INTEGER; v_costo_unit NUMERIC;
BEGIN
  IF NEW.completado = true AND (OLD.completado = false OR OLD.completado IS NULL) THEN
    PERFORM pg_advisory_xact_lock(hashtext('ensamble:' || NEW.id::text));
    -- Serializar ensambles/compras concurrentes del mismo producto antes de leer
    -- el stock global y recalcular costo_promedio (mismo patrón S4-19 de compras)
    PERFORM 1 FROM productos WHERE id = NEW.producto_resultado_id FOR UPDATE;
    SELECT COALESCE(SUM(cantidad + COALESCE(cantidad_insumo,0)),0) INTO v_stock_global_prev
      FROM inventario WHERE producto_id = NEW.producto_resultado_id;

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

    -- P0: costo_promedio del producto resultado por promedio ponderado, pesos enteros
    IF NEW.cantidad_producida > 0 THEN
      v_costo_unit := v_costo / NEW.cantidad_producida;
      PERFORM set_config('app.costo_sistema','on', true);
      UPDATE productos SET
        costo_promedio = round(
          CASE WHEN COALESCE(v_stock_global_prev,0) <= 0 THEN v_costo_unit
               ELSE (COALESCE(costo_promedio,0) * v_stock_global_prev + v_costo)
                    / NULLIF(v_stock_global_prev + NEW.cantidad_producida, 0)
          END),
        updated_at = now()
      WHERE id = NEW.producto_resultado_id;
      PERFORM set_config('app.costo_sistema','', true);
    END IF;

    PERFORM fn_actualizar_estado_stock(NEW.producto_resultado_id, NEW.sede_id);

    SELECT nombre INTO v_prod_result FROM productos WHERE id = NEW.producto_resultado_id;
    SELECT nombre INTO v_sede_nombre FROM sedes WHERE id = NEW.sede_id;
    INSERT INTO notificaciones (tipo, titulo, mensaje, data, para_rol, created_by)
    VALUES ('ensamble_creado', 'Ensamble completado',
      format('Se ensamblaron %s ud(s) de "%s" en %s (costo de materiales: %s). Revisa el precio/costo del producto.',
        NEW.cantidad_producida, COALESCE(v_prod_result, NEW.producto_resultado_id::text),
        COALESCE(v_sede_nombre, NEW.sede_id), round(v_costo)),
      jsonb_build_object('producto_id', NEW.producto_resultado_id, 'producto', v_prod_result,
        'sede_id', NEW.sede_id, 'cantidad', NEW.cantidad_producida,
        'costo_materiales', v_costo, 'ensamble_id', NEW.id),
      'Admin', NEW.realizado_por);
  END IF;
  RETURN NEW;
END $fn$;
