-- S6-SNAP · Poder revertir el costo_promedio al cancelar una compra recibida.
--
-- EL BUG (verificado como codigo VIVO, reproducido en produccion en BEGIN/ROLLBACK):
-- fn_cancelar_compra recalculaba el costo con el ponderado de TODA la historia:
--     costo_promedio = coalesce((select sum(dc.cantidad*dc.costo_unitario)/sum(dc.cantidad)
--                                from detalle_compra dc join compras c ... where c.recibida
--                                and c.estado <> 'cancelada'), p.costo_promedio)
-- Dos defectos:
--   1. Criterio distinto al promedio movil de trg_compra_sumar_stock, que es el
--      oficial del sistema (reafirmado en ensambles). Cancelar cambiaba de metrica.
--   2. El coalesce dejaba el costo CONTAMINADO por la compra que se acababa de
--      cancelar cuando no habia otras compras recibidas: el subselect da NULL y el
--      coalesce se queda con p.costo_promedio, que es justo el valor que esa compra
--      metio. Ese es el caso C2X10: cancelar la compra #92 no bajo el costo de
--      $443,19 y quedo asi meses.
--   Control reproducido: producto sin stock, compra de 10 x $500 recibida y luego
--   cancelada -> el costo se quedaba en $500 en vez de volver a $0.
--
-- EL ARREGLO: snapshot.
--   1. detalle_compra.costo_promedio_anterior (nullable) guarda el costo_promedio
--      que el producto tenia justo ANTES de que esta compra lo moviera.
--   2. trg_compra_sumar_stock lo escribe antes de su UPDATE productos. Se escribe
--      una sola vez por (compra, producto): si el mismo producto viene en varias
--      lineas, todas guardan el costo pre-compra real, no el intermedio.
--   3. fn_cancelar_compra restaura ese snapshot en vez de recalcular.
--
-- LIMITACIONES REALES (no se esconden):
--   * Solo funciona HACIA ADELANTE. Las compras recibidas antes de esta migracion
--     tienen la columna en NULL: esas lineas se omiten y el costo queda como esta.
--     fn_cancelar_compra deja un `raise notice` cuando eso pasa, en vez de fallar
--     en silencio o inventarse un valor.
--   * Restaurar el snapshot DESCARTA los movimientos de costo posteriores a la
--     recepcion (p.ej. si despues hubo otra compra, o un ensamble). NO existe una
--     reversion matematicamente correcta del promedio movil: el promedio movil no
--     es invertible sin reconstruir toda la cadena. Esto es una aproximacion
--     deliberada y es la mejor disponible; no es exacta y no se vende como tal.
--     Es correcta y exacta en el caso comun: cancelar la ultima compra recibida
--     de un producto (que es el escenario real de un error de digitacion).
--
-- NO se toca la reversion de stock de fn_cancelar_compra (cajon cantidad /
-- cantidad_insumo, validacion de disponibilidad, movimiento): ya estaba verificada
-- como correcta y se conserva literal.
--
-- Ambas funciones se reemplazan con CREATE OR REPLACE y firma IDENTICA: no se crea
-- overload y el ACL (EXECUTE de authenticated) se conserva.
-- detalle_compra tiene grants a nivel de TABLA, asi que la columna nueva los hereda.

-- 1. -------------------------------------------------------------------------
ALTER TABLE detalle_compra ADD COLUMN IF NOT EXISTS costo_promedio_anterior numeric;

COMMENT ON COLUMN detalle_compra.costo_promedio_anterior IS
  'Snapshot del productos.costo_promedio justo ANTES de recibir esta compra. Lo escribe trg_compra_sumar_stock y lo restaura fn_cancelar_compra. NULL = compra recibida antes de la migracion del snapshot (20260717): al cancelar, su costo no se revierte.';

-- 2. -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_compra_sumar_stock()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_compra RECORD; v_det RECORD;
  v_stock_ant INTEGER; v_stock_insumo_ant INTEGER; v_stock_global_prev INTEGER;
  v_costo_prev NUMERIC;
BEGIN
  IF NEW.recibida = true AND (OLD.recibida = false OR OLD.recibida IS NULL) THEN
    PERFORM pg_advisory_xact_lock(hashtext('compra:' || NEW.id::text));
    SELECT sede_destino_id, registrado_por, recibida INTO v_compra
      FROM compras WHERE id = NEW.id FOR UPDATE;
    IF v_compra.recibida IS DISTINCT FROM NEW.recibida THEN RETURN NEW; END IF;
    FOR v_det IN SELECT * FROM detalle_compra WHERE compra_id = NEW.id LOOP
      INSERT INTO inventario (producto_id, sede_id, cantidad)
      VALUES (v_det.producto_id, v_compra.sede_destino_id, 0)
      ON CONFLICT (producto_id, sede_id) DO NOTHING;
      SELECT COALESCE(cantidad, 0), COALESCE(cantidad_insumo, 0)
        INTO v_stock_ant, v_stock_insumo_ant
        FROM inventario
       WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id
       FOR UPDATE;
      -- S4-19: serializar compras concurrentes del mismo producto antes de leer el stock global.
      -- S6-SNAP: el mismo FOR UPDATE captura el costo_promedio previo a esta recepcion.
      SELECT costo_promedio INTO v_costo_prev
        FROM productos WHERE id = v_det.producto_id FOR UPDATE;

      -- S6-SNAP: guardar el costo ANTERIOR a esta recepcion para poder revertirlo
      -- al cancelar. Se escribe una sola vez por producto y compra: si el mismo
      -- producto aparece en varias lineas, todas conservan el costo pre-compra real
      -- (no el intermedio que deja la primera linea).
      IF NOT EXISTS (
        SELECT 1 FROM detalle_compra
         WHERE compra_id = NEW.id AND producto_id = v_det.producto_id
           AND costo_promedio_anterior IS NOT NULL
      ) THEN
        UPDATE detalle_compra SET costo_promedio_anterior = v_costo_prev
         WHERE compra_id = NEW.id AND producto_id = v_det.producto_id;
      END IF;

      SELECT COALESCE(SUM(cantidad + COALESCE(cantidad_insumo, 0)), 0)
        INTO v_stock_global_prev
        FROM inventario WHERE producto_id = v_det.producto_id;
      IF v_det.destino = 'insumo' THEN
        UPDATE inventario SET
          cantidad_insumo = COALESCE(inventario.cantidad_insumo, 0) + v_det.cantidad,
          ultimo_movimiento = now(), updated_at = now()
        WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id;
        INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
                                referencia_id, referencia_tipo, usuario_id)
        VALUES ('compra', v_det.producto_id, v_compra.sede_destino_id, v_det.cantidad,
                COALESCE(v_stock_insumo_ant, 0), COALESCE(v_stock_insumo_ant, 0) + v_det.cantidad,
                NEW.id, 'compra', v_compra.registrado_por);
      ELSE
        UPDATE inventario SET
          cantidad = inventario.cantidad + v_det.cantidad,
          ultimo_movimiento = now(), updated_at = now()
        WHERE producto_id = v_det.producto_id AND sede_id = v_compra.sede_destino_id;
        INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
                                referencia_id, referencia_tipo, usuario_id)
        VALUES ('compra', v_det.producto_id, v_compra.sede_destino_id, v_det.cantidad,
                COALESCE(v_stock_ant, 0), COALESCE(v_stock_ant, 0) + v_det.cantidad,
                NEW.id, 'compra', v_compra.registrado_por);
        PERFORM fn_actualizar_estado_stock(v_det.producto_id, v_compra.sede_destino_id);
      END IF;
      -- S8: flag de sistema para que el guard no revierta el ponderado cuando
      -- quien recibe no es Admin
      PERFORM set_config('app.costo_sistema','on', true);
      UPDATE productos SET
        costo_promedio = CASE
          WHEN v_stock_global_prev = 0 THEN v_det.costo_unitario
          ELSE (costo_promedio * v_stock_global_prev + v_det.costo_unitario * v_det.cantidad)
               / NULLIF(v_stock_global_prev + v_det.cantidad, 0)
        END,
        updated_at = now()
      WHERE id = v_det.producto_id;
      PERFORM set_config('app.costo_sistema','', true);
    END LOOP;
    UPDATE compras SET fecha_recepcion = COALESCE(fecha_recepcion, now()) WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$fn$;

-- 3. -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cancelar_compra(p_compra_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
declare
  v_rol text; v_estado estado_compra; v_recibida boolean; v_sede text;
  v_proveedor text; v_prov_norm text; v_numero int;
  v_det record; v_c record;
  v_stock_ant integer; v_stock_insumo_ant integer; v_disp integer; v_new integer;
  v_ult_at timestamptz; v_ult_costo numeric; v_sin_snap int;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  select get_my_rol() into v_rol;
  if v_rol is distinct from 'Admin' then
    raise exception 'Solo el administrador puede cancelar compras';
  end if;
  select estado, recibida, sede_destino_id, proveedor, numero
    into v_estado, v_recibida, v_sede, v_proveedor, v_numero
    from compras where id = p_compra_id for update;
  if not found then raise exception 'Compra no encontrada'; end if;
  if v_estado = 'cancelada' then raise exception 'La compra ya está cancelada'; end if;

  -- Reversion de stock: SIN CAMBIOS respecto a la version anterior (verificada correcta).
  if v_recibida then
    for v_det in select * from detalle_compra where compra_id = p_compra_id loop
      select coalesce(cantidad,0), coalesce(cantidad_insumo,0)
        into v_stock_ant, v_stock_insumo_ant
        from inventario where producto_id = v_det.producto_id and sede_id = v_sede for update;
      if v_det.destino = 'insumo' then v_disp := coalesce(v_stock_insumo_ant,0);
      else v_disp := coalesce(v_stock_ant,0); end if;
      if v_disp < v_det.cantidad then
        raise exception 'No se puede cancelar: el inventario ya no tiene stock suficiente para revertir el producto % (disponible %, requiere %). Parte de esa compra ya se usó o vendió.',
          v_det.producto_id, v_disp, v_det.cantidad;
      end if;
      if v_det.destino = 'insumo' then
        v_new := v_stock_insumo_ant - v_det.cantidad;
        update inventario set cantidad_insumo = v_new, ultimo_movimiento = now(), updated_at = now()
         where producto_id = v_det.producto_id and sede_id = v_sede;
        insert into movimientos (tipo, producto_id, sede_id, cantidad,
          stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
        values ('ajuste', v_det.producto_id, v_sede, -v_det.cantidad,
          v_stock_insumo_ant, v_new, p_compra_id, 'compra', auth.uid(),
          'Cancelación de compra (reversa de insumo)');
      else
        v_new := v_stock_ant - v_det.cantidad;
        update inventario set cantidad = v_new, ultimo_movimiento = now(), updated_at = now()
         where producto_id = v_det.producto_id and sede_id = v_sede;
        insert into movimientos (tipo, producto_id, sede_id, cantidad,
          stock_anterior, stock_posterior, referencia_id, referencia_tipo, usuario_id, observaciones)
        values ('ajuste', v_det.producto_id, v_sede, -v_det.cantidad,
          v_stock_ant, v_new, p_compra_id, 'compra', auth.uid(),
          'Cancelación de compra (reversa)');
        perform fn_actualizar_estado_stock(v_det.producto_id, v_sede);
      end if;
    end loop;
  end if;

  -- S6-G: anular pagos de CxP de esta compra (soft, espeja fn_anular_venta)
  update pagos_cuenta
     set anulado = true, anulado_por = auth.uid(), anulado_en = now(),
         motivo_anulacion = 'Compra cancelada'
   where compra_id = p_compra_id and tipo = 'pago' and coalesce(anulado, false) = false;

  -- S6: restaurar el saldo de notas crédito consumidas contra esta compra
  for v_c in
    select nota_id, sum(monto) as monto from notas_credito_consumos
     where compra_id = p_compra_id group by nota_id having sum(monto) > 0
  loop
    update notas_credito_proveedor
       set saldo_restante = least(monto, saldo_restante + v_c.monto),
           observaciones = coalesce(nullif(trim(coalesce(observaciones,'')),'') || ' | ', '') ||
                           format('Saldo restaurado (+%s) por cancelación de compra #%s', v_c.monto, v_numero)
     where id = v_c.nota_id;
  end loop;

  perform set_config('cdv.compra_admin', 'on', true);
  update compras set estado = 'cancelada' where id = p_compra_id;
  perform set_config('cdv.compra_admin', '', true);

  if v_recibida then
    -- S6-SNAP: restaurar el costo_promedio previo a la recepcion (ver cabecera de
    -- la migracion). Reemplaza el recalculo por ponderado historico.
    perform set_config('app.costo_sistema','on', true);
    for v_det in
      select distinct on (dc.producto_id) dc.producto_id, dc.costo_promedio_anterior
        from detalle_compra dc
       where dc.compra_id = p_compra_id and dc.costo_promedio_anterior is not null
       order by dc.producto_id, dc.id
    loop
      update productos
         set costo_promedio = v_det.costo_promedio_anterior, updated_at = now()
       where id = v_det.producto_id;
    end loop;
    perform set_config('app.costo_sistema','', true);

    -- Degradacion conocida y deliberada: compras recibidas antes de esta migracion
    -- no tienen snapshot. Se omiten y el costo queda como esta. Queda dicho, no en silencio.
    select count(distinct producto_id) into v_sin_snap
      from detalle_compra
     where compra_id = p_compra_id and costo_promedio_anterior is null;
    if v_sin_snap > 0 then
      raise notice 'Compra #% cancelada: % producto(s) sin snapshot de costo (compra recibida antes de la migracion del snapshot). Su costo_promedio NO se revirtio y queda como estaba; revisar a mano si hace falta.', v_numero, v_sin_snap;
    end if;

    -- S6-10/COMP-04: recalcular productos_proveedores desde la última compra recibida no cancelada
    v_prov_norm := coalesce(nullif(trim(coalesce(v_proveedor,'')), ''), 'Sin proveedor');
    for v_det in select distinct producto_id from detalle_compra where compra_id = p_compra_id loop
      select c.fecha_recepcion, dc.costo_unitario into v_ult_at, v_ult_costo
        from detalle_compra dc join compras c on c.id = dc.compra_id
       where dc.producto_id = v_det.producto_id
         and coalesce(nullif(trim(coalesce(c.proveedor,'')), ''), 'Sin proveedor') = v_prov_norm
         and c.recibida = true and c.estado <> 'cancelada' and c.id <> p_compra_id
       order by c.fecha_recepcion desc nulls last, c.created_at desc limit 1;
      if found then
        update productos_proveedores set ultima_compra_at = v_ult_at, ultimo_costo = v_ult_costo
         where producto_id = v_det.producto_id and proveedor = v_prov_norm;
      else
        delete from productos_proveedores
         where producto_id = v_det.producto_id and proveedor = v_prov_norm;
      end if;
    end loop;
  end if;
end;
$fn$;
