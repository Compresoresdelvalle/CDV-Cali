-- s7 Traspasos: habilita traspaso de INSUMOS (bolsillo cantidad_insumo) + notificación de recepción.
-- detalle_traspaso.es_insumo por línea; triggers de salida/entrada y cancelación mueven el bolsillo correcto.
ALTER TABLE detalle_traspaso ADD COLUMN IF NOT EXISTS es_insumo boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.fn_crear_traspaso(p_sede_origen text, p_sede_destino text, p_tipo text DEFAULT 'normal'::text, p_observaciones text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid UUID; v_mi_sede TEXT; v_mi_rol TEXT; v_traspaso_id UUID; v_numero INT;
  item JSONB; v_prod_id UUID; v_cant INTEGER;
BEGIN
  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'El traspaso debe tener al menos un ítem'; END IF;
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT sede_id, rol::TEXT INTO v_mi_sede, v_mi_rol FROM usuarios WHERE id = v_uid;
  IF v_mi_rol NOT IN ('Admin','Bodeguero','Vendedor') THEN RAISE EXCEPTION 'No tienes permiso para crear traspasos'; END IF;
  IF v_mi_rol <> 'Admin' AND v_mi_sede IS DISTINCT FROM p_sede_origen THEN RAISE EXCEPTION 'Solo puedes crear traspasos desde tu propia sede'; END IF;
  IF p_sede_origen = p_sede_destino THEN RAISE EXCEPTION 'La sede origen y destino no pueden ser la misma'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_prod_id := (item->>'producto_id')::UUID;
    v_cant := (item->>'cantidad_solicitada')::INTEGER;
    IF v_cant IS NULL OR v_cant <= 0 THEN RAISE EXCEPTION 'Cantidad inválida para el producto %', v_prod_id; END IF;
    IF NOT EXISTS (SELECT 1 FROM productos WHERE id = v_prod_id AND activo = true) THEN RAISE EXCEPTION 'Producto % no encontrado o inactivo', v_prod_id; END IF;
  END LOOP;
  INSERT INTO traspasos (sede_origen_id, sede_destino_id, solicitado_por, observaciones, estado, tipo)
  VALUES (p_sede_origen, p_sede_destino, v_uid, NULLIF(TRIM(COALESCE(p_observaciones,'')),''), 'borrador', p_tipo::tipo_traspaso)
  RETURNING id, numero INTO v_traspaso_id, v_numero;
  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO detalle_traspaso (traspaso_id, producto_id, cantidad_solicitada, cantidad_enviada, cantidad_recibida, picking_completado, es_insumo)
    VALUES (v_traspaso_id, (item->>'producto_id')::UUID, (item->>'cantidad_solicitada')::INTEGER, 0, 0, false,
            COALESCE((item->>'es_insumo')::boolean, false));
  END LOOP;
  RETURN jsonb_build_object('traspaso_id', v_traspaso_id, 'numero', v_numero);
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_traspaso_salida()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
declare
  v_det record; v_cant integer; v_enviar integer;
  v_para_rol text; v_sede_origen_nombre text;
begin
  if new.estado = 'en_transito' and old.estado in ('verificado','picking') then
    perform pg_advisory_xact_lock(hashtext('traspaso:' || new.id::text));
    for v_det in select * from detalle_traspaso where traspaso_id = new.id loop
      v_enviar := coalesce(v_det.cantidad_enviada, v_det.cantidad_solicitada);
      if v_det.es_insumo then
        select cantidad_insumo into v_cant from inventario where producto_id = v_det.producto_id and sede_id = new.sede_origen_id for update;
        if v_cant is null or v_cant < v_enviar then raise exception 'Stock de insumo insuficiente en sede origen'; end if;
        update inventario set cantidad_insumo = cantidad_insumo - v_enviar, ultimo_movimiento = now(), updated_at = now()
         where producto_id = v_det.producto_id and sede_id = new.sede_origen_id;
        insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
        values ('traspaso_salida', v_det.producto_id, new.sede_origen_id, -v_enviar, v_cant, v_cant - v_enviar, new.id, 'traspaso', new.solicitado_por, 'Insumo');
      else
        select cantidad into v_cant from inventario where producto_id = v_det.producto_id and sede_id = new.sede_origen_id for update;
        if v_cant is null or v_cant < v_enviar then raise exception 'Stock insuficiente en sede origen'; end if;
        update inventario set cantidad = cantidad - v_enviar, ultimo_movimiento = now(), updated_at = now()
         where producto_id = v_det.producto_id and sede_id = new.sede_origen_id;
        insert into movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id)
        values ('traspaso_salida', v_det.producto_id, new.sede_origen_id, -v_enviar, v_cant, v_cant - v_enviar, new.id, 'traspaso', new.solicitado_por);
        perform fn_actualizar_estado_stock(v_det.producto_id, new.sede_origen_id);
      end if;
    end loop;

    -- Notificación de recepción a la sede destino (idempotente por traspaso_id)
    if not exists (select 1 from notificaciones where tipo = 'traspaso_en_camino' and (data->>'traspaso_id') = new.id::text) then
      select nombre into v_sede_origen_nombre from sedes where id = new.sede_origen_id;
      v_para_rol := case when new.sede_destino_id = 'BODEGA' then 'Bodeguero' else 'Vendedor' end;
      insert into notificaciones (tipo, titulo, mensaje, data, para_rol, created_by)
      values (
        'traspaso_en_camino', 'Traspaso en camino',
        format('Traspaso #%s en camino desde %s', new.numero, coalesce(v_sede_origen_nombre, new.sede_origen_id)),
        jsonb_build_object('traspaso_id', new.id, 'numero', new.numero,
                           'sede_origen_id', new.sede_origen_id, 'sede_destino_id', new.sede_destino_id),
        v_para_rol, new.solicitado_por
      );
    end if;
  end if;
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.trg_traspaso_entrada()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_det record; v_stock_ant integer; v_enviada integer; v_recibida integer; v_faltante integer; v_stock_post integer;
BEGIN
  IF NEW.estado IN ('recibido','con_diferencia') AND OLD.estado = 'en_transito' THEN
    PERFORM pg_advisory_xact_lock(hashtext('traspaso:' || NEW.id::text));
    FOR v_det IN SELECT * FROM detalle_traspaso WHERE traspaso_id = NEW.id LOOP
      v_enviada := COALESCE(v_det.cantidad_enviada, v_det.cantidad_solicitada);
      v_recibida := COALESCE(v_det.cantidad_recibida, v_enviada);
      v_faltante := v_enviada - v_recibida;

      IF v_det.es_insumo THEN
        SELECT cantidad_insumo INTO v_stock_ant FROM inventario WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_destino_id FOR UPDATE;
        v_stock_ant := COALESCE(v_stock_ant, 0);
        INSERT INTO inventario (producto_id, sede_id, cantidad_insumo) VALUES (v_det.producto_id, NEW.sede_destino_id, v_enviada)
        ON CONFLICT (producto_id, sede_id) DO UPDATE SET cantidad_insumo = inventario.cantidad_insumo + v_enviada, ultimo_movimiento = now(), updated_at = now();
        INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
        VALUES ('traspaso_entrada', v_det.producto_id, NEW.sede_destino_id, v_enviada, v_stock_ant, v_stock_ant + v_enviada, NEW.id, 'traspaso', NEW.solicitado_por, 'Insumo');
        IF v_faltante > 0 THEN
          v_stock_post := v_stock_ant + v_enviada;
          UPDATE inventario SET cantidad_insumo = cantidad_insumo - v_faltante, ultimo_movimiento = now(), updated_at = now()
           WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_destino_id;
          INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
          VALUES ('ajuste', v_det.producto_id, NEW.sede_destino_id, -v_faltante, v_stock_post, v_stock_post - v_faltante, NEW.id, 'traspaso',
                  COALESCE(NEW.recibido_por, NEW.solicitado_por),
                  'Insumo - Merma: faltante en traspaso #' || NEW.numero || ' (enviado ' || v_enviada || ', recibido ' || v_recibida || ')');
        END IF;
      ELSE
        SELECT cantidad INTO v_stock_ant FROM inventario WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_destino_id FOR UPDATE;
        v_stock_ant := COALESCE(v_stock_ant, 0);
        INSERT INTO inventario (producto_id, sede_id, cantidad) VALUES (v_det.producto_id, NEW.sede_destino_id, v_enviada)
        ON CONFLICT (producto_id, sede_id) DO UPDATE SET cantidad = inventario.cantidad + v_enviada, ultimo_movimiento = now(), updated_at = now();
        INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id)
        VALUES ('traspaso_entrada', v_det.producto_id, NEW.sede_destino_id, v_enviada, v_stock_ant, v_stock_ant + v_enviada, NEW.id, 'traspaso', NEW.solicitado_por);
        IF v_faltante > 0 THEN
          v_stock_post := v_stock_ant + v_enviada;
          UPDATE inventario SET cantidad = cantidad - v_faltante, ultimo_movimiento = now(), updated_at = now()
           WHERE producto_id = v_det.producto_id AND sede_id = NEW.sede_destino_id;
          INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
          VALUES ('ajuste', v_det.producto_id, NEW.sede_destino_id, -v_faltante, v_stock_post, v_stock_post - v_faltante, NEW.id, 'traspaso',
                  COALESCE(NEW.recibido_por, NEW.solicitado_por),
                  'Merma: faltante en traspaso #' || NEW.numero || ' (enviado ' || v_enviada || ', recibido ' || v_recibida || ')');
        END IF;
        PERFORM fn_actualizar_estado_stock(v_det.producto_id, NEW.sede_destino_id);
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.fn_cancelar_traspaso(p_traspaso_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid UUID; v_rol TEXT; v_estado TEXT; v_origen TEXT; v_det RECORD;
  v_stock INTEGER; v_devolver INTEGER; v_revertido BOOLEAN := false;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol IS DISTINCT FROM 'Admin' THEN RAISE EXCEPTION 'Solo un Admin puede cancelar traspasos'; END IF;
  SELECT estado::TEXT, sede_origen_id INTO v_estado, v_origen FROM traspasos WHERE id = p_traspaso_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traspaso no encontrado'; END IF;
  IF v_estado = 'cancelado' THEN RAISE EXCEPTION 'El traspaso ya está cancelado'; END IF;
  IF v_estado IN ('recibido','con_diferencia') THEN RAISE EXCEPTION 'No se puede cancelar un traspaso ya recibido (estado %)', v_estado; END IF;

  IF v_estado = 'en_transito' THEN
    PERFORM pg_advisory_xact_lock(hashtext('traspaso:' || p_traspaso_id::text));
    FOR v_det IN SELECT * FROM detalle_traspaso WHERE traspaso_id = p_traspaso_id LOOP
      v_devolver := COALESCE(v_det.cantidad_enviada, v_det.cantidad_solicitada);
      IF v_devolver IS NULL OR v_devolver <= 0 THEN CONTINUE; END IF;
      IF NOT EXISTS (
        SELECT 1 FROM movimientos WHERE referencia_id = p_traspaso_id AND referencia_tipo = 'traspaso'
          AND tipo = 'traspaso_salida' AND producto_id = v_det.producto_id AND sede_id = v_origen
      ) THEN CONTINUE; END IF;

      IF v_det.es_insumo THEN
        SELECT cantidad_insumo INTO v_stock FROM inventario WHERE producto_id = v_det.producto_id AND sede_id = v_origen FOR UPDATE;
        v_stock := COALESCE(v_stock, 0);
        INSERT INTO inventario (producto_id, sede_id, cantidad_insumo) VALUES (v_det.producto_id, v_origen, v_devolver)
        ON CONFLICT (producto_id, sede_id) DO UPDATE SET cantidad_insumo = inventario.cantidad_insumo + v_devolver, ultimo_movimiento = now(), updated_at = now();
        INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
        VALUES ('ajuste', v_det.producto_id, v_origen, v_devolver, v_stock, v_stock + v_devolver, p_traspaso_id, 'traspaso', v_uid,
                'Insumo - Reversa por cancelación de traspaso en tránsito');
      ELSE
        SELECT cantidad INTO v_stock FROM inventario WHERE producto_id = v_det.producto_id AND sede_id = v_origen FOR UPDATE;
        v_stock := COALESCE(v_stock, 0);
        INSERT INTO inventario (producto_id, sede_id, cantidad) VALUES (v_det.producto_id, v_origen, v_devolver)
        ON CONFLICT (producto_id, sede_id) DO UPDATE SET cantidad = inventario.cantidad + v_devolver, ultimo_movimiento = now(), updated_at = now();
        INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
        VALUES ('ajuste', v_det.producto_id, v_origen, v_devolver, v_stock, v_stock + v_devolver, p_traspaso_id, 'traspaso', v_uid,
                'Reversa por cancelación de traspaso en tránsito');
        PERFORM fn_actualizar_estado_stock(v_det.producto_id, v_origen);
      END IF;
      v_revertido := true;
    END LOOP;
  END IF;

  UPDATE traspasos SET estado = 'cancelado',
    observaciones = NULLIF(TRIM(BOTH FROM COALESCE(observaciones,'') ||
        CASE WHEN COALESCE(TRIM(p_motivo),'') <> '' THEN ' | Cancelado por Admin: ' || TRIM(p_motivo) ELSE ' | Cancelado por Admin' END), ''),
    updated_at = now() WHERE id = p_traspaso_id;
  RETURN jsonb_build_object('ok', true, 'estado', 'cancelado', 'stock_revertido', v_revertido);
END;
$function$;
