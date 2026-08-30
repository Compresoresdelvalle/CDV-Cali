-- Garantías de compra abiertas con resolución 'pendiente' ("por definir con el
-- proveedor") quedaban sin salida: no había forma de decidirla después, así que
-- la única acción posible era anular, con el stock ya descontado del inventario.
-- Esta función es esa salida. Reproduce, para una garantía ya abierta, lo que
-- fn_abrir_garantia_compra hace en el momento de crearla.
CREATE OR REPLACE FUNCTION public.fn_definir_resolucion_garantia_compra(
  p_garantia_id uuid,
  p_resolucion  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_rol          text;
  v_g            record;
  v_compra       record;
  v_res          resolucion_garantia_compra;
  v_estado_final estado_garantia_compra;
  v_monto        numeric := 0;
  v_nota_numero  int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::text INTO v_rol FROM usuarios WHERE id = v_uid;
  -- Mismo rol que fn_marcar_reposicion_recibida: quien recibe la reposición es
  -- quien decide la resolución.
  IF v_rol NOT IN ('Admin','Bodeguero') THEN
    RAISE EXCEPTION 'Solo Bodega o Administración pueden definir la resolución de una garantía de compra';
  END IF;

  IF p_resolucion IS NULL OR p_resolucion NOT IN ('reposicion_fisica','nota_credito') THEN
    RAISE EXCEPTION 'Resolución inválida: elige reposición física o nota crédito';
  END IF;
  v_res := p_resolucion::resolucion_garantia_compra;

  SELECT * INTO v_g FROM garantias_compra WHERE id = p_garantia_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Garantía no encontrada'; END IF;

  IF v_g.estado = 'anulada' THEN
    RAISE EXCEPTION 'La garantía #% está anulada: ya no admite resolución', v_g.numero;
  END IF;
  -- 'abierta' es exactamente el estado en que quedó una garantía con resolución
  -- 'pendiente'. Cualquier otro ya avanzó y volver atrás desharía movimientos
  -- de inventario o una nota crédito ya emitida.
  IF v_g.estado <> 'abierta' THEN
    RAISE EXCEPTION 'La garantía #% ya tiene resolución definida (%): solo se puede definir mientras sigue abierta',
      v_g.numero, v_g.resolucion;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM detalle_garantia_compra WHERE garantia_id = p_garantia_id) THEN
    RAISE EXCEPTION 'La garantía #% no tiene items reclamados', v_g.numero;
  END IF;

  SELECT * INTO v_compra FROM compras WHERE id = v_g.compra_id;

  SELECT COALESCE(SUM(cantidad * costo_unitario), 0) INTO v_monto
    FROM detalle_garantia_compra WHERE garantia_id = p_garantia_id;

  v_estado_final := CASE v_res
    WHEN 'nota_credito' THEN 'nota_credito_emitida'
    ELSE 'reposicion_pendiente'
  END;

  UPDATE garantias_compra
     SET resolucion = v_res, estado = v_estado_final
   WHERE id = p_garantia_id;

  -- Idéntico a la apertura: la nota crédito nace con la resolución. El NOT
  -- EXISTS es cinturón: una garantía 'abierta' nunca debería tener una, pero
  -- duplicarla sería plata inventada.
  IF v_res = 'nota_credito' AND v_monto > 0
     AND NOT EXISTS (
       SELECT 1 FROM notas_credito_proveedor WHERE garantia_compra_id = p_garantia_id
     ) THEN
    INSERT INTO notas_credito_proveedor (
      proveedor, garantia_compra_id, monto, saldo_restante, observaciones, registrado_por
    ) VALUES (
      v_compra.proveedor, p_garantia_id, v_monto, v_monto,
      'Nota crédito por garantía de compra', v_uid
    ) RETURNING numero INTO v_nota_numero;
  END IF;

  -- S6, misma regla que las otras dos RPC: la compra queda en
  -- 'devolucion_garantia' solo mientras le queden garantías EN CURSO. La nota
  -- crédito es terminal (la nota ES el cierre), así que no deja la compra pegada.
  IF v_compra.estado IN ('completada','devolucion_garantia') THEN
    IF EXISTS (
         SELECT 1 FROM garantias_compra
          WHERE compra_id = v_g.compra_id
            AND estado NOT IN ('anulada','cerrada','nota_credito_emitida')
       ) THEN
      IF v_compra.estado <> 'devolucion_garantia' THEN
        PERFORM set_config('cdv.compra_admin','on',true);
        UPDATE compras SET estado='devolucion_garantia' WHERE id = v_g.compra_id;
        PERFORM set_config('cdv.compra_admin','',true);
      END IF;
    ELSE
      IF v_compra.estado <> 'completada' THEN
        PERFORM set_config('cdv.compra_admin','on',true);
        UPDATE compras SET estado='completada' WHERE id = v_g.compra_id;
        PERFORM set_config('cdv.compra_admin','',true);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'garantia_id', p_garantia_id,
    'numero', v_g.numero,
    'resolucion', v_res,
    'estado', v_estado_final,
    'monto', v_monto,
    'nota_credito_numero', v_nota_numero
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_definir_resolucion_garantia_compra(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_definir_resolucion_garantia_compra(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_definir_resolucion_garantia_compra(uuid, text) TO service_role;
