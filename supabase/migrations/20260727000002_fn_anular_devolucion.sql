-- Auditoría de anulación en devoluciones.
ALTER TABLE devoluciones
  ADD COLUMN IF NOT EXISTS anulado_por uuid REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS anulado_at timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_anulacion text;

-- Anula una devolución revirtiendo su efecto en el stock.
--  * Cliente  (reingresa_stock=true): la devolución sumó stock -> anular lo resta.
--  * Proveedor(reingresa_stock=false): la devolución restó stock -> anular lo repone.
-- `movimientos` es append-only, así que se registra un movimiento 'ajuste'
-- compensatorio (no se borra el original), enlazado a la devolución.
-- Reglas: solo Admin; no re-anular; no anular las que vienen de un cambio de
-- producto (se revierten anulando la venta del cambio); no dejar stock negativo.
CREATE OR REPLACE FUNCTION public.fn_anular_devolucion(
  p_devolucion_id uuid,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_usuario_id uuid;
  v_rol text;
  v_dev devoluciones%ROWTYPE;
  v_stock_ant integer;
  v_stock_post integer;
  v_reverse integer;
BEGIN
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT rol::text INTO v_rol FROM usuarios WHERE id = v_usuario_id;
  IF v_rol IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede anular devoluciones';
  END IF;

  SELECT * INTO v_dev FROM devoluciones WHERE id = p_devolucion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolución no encontrada';
  END IF;

  IF v_dev.estado = 'anulada' THEN
    RAISE EXCEPTION 'La devolución #% ya está anulada', v_dev.numero;
  END IF;

  -- Las devoluciones nacidas de un cambio de producto crearon también una venta;
  -- anular solo la devolución dejaría el cambio descuadrado.
  IF v_dev.motivo ILIKE 'Cambio desde venta%' THEN
    RAISE EXCEPTION 'La devolución #% es parte de un cambio de producto. Para revertirla, anula la venta del cambio desde Ventas.', v_dev.numero;
  END IF;

  -- Reversa: cliente sumó (+cant) -> restar; proveedor restó (-cant) -> sumar.
  v_reverse := CASE WHEN v_dev.reingresa_stock THEN -v_dev.cantidad ELSE v_dev.cantidad END;

  SELECT cantidad INTO v_stock_ant FROM inventario
   WHERE producto_id = v_dev.producto_id AND sede_id = v_dev.sede_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay registro de inventario para revertir esta devolución';
  END IF;

  -- No dejar stock negativo: si hay que restar más de lo disponible, parte ya se
  -- movió o vendió y no se puede anular sin descuadrar el inventario.
  IF v_reverse < 0 AND v_stock_ant < v_dev.cantidad THEN
    RAISE EXCEPTION 'No se puede anular: el stock disponible (%) es menor a las % unidades que reingresó la devolución (parte ya se movió o vendió).',
      v_stock_ant, v_dev.cantidad;
  END IF;

  UPDATE inventario
     SET cantidad = cantidad + v_reverse,
         ultimo_movimiento = now(),
         updated_at = now()
   WHERE producto_id = v_dev.producto_id AND sede_id = v_dev.sede_id
   RETURNING cantidad INTO v_stock_post;

  INSERT INTO movimientos (producto_id, sede_id, tipo, cantidad,
    stock_anterior, stock_posterior, referencia_id, referencia_tipo,
    usuario_id, observaciones)
  VALUES (v_dev.producto_id, v_dev.sede_id, 'ajuste', v_reverse,
    v_stock_ant, v_stock_post, v_dev.id, 'devolucion', v_usuario_id,
    'Anulación de devolución #' || v_dev.numero ||
      COALESCE(': ' || NULLIF(btrim(p_motivo), ''), ''));

  UPDATE devoluciones
     SET estado = 'anulada',
         anulado_por = v_usuario_id,
         anulado_at = now(),
         motivo_anulacion = NULLIF(btrim(p_motivo), ''),
         updated_at = now()
   WHERE id = v_dev.id;

  PERFORM fn_actualizar_estado_stock(v_dev.producto_id, v_dev.sede_id);

  RETURN jsonb_build_object(
    'devolucion_id', v_dev.id,
    'numero', v_dev.numero,
    'estado', 'anulada',
    'delta_stock', v_reverse,
    'stock_anterior', v_stock_ant,
    'stock_posterior', v_stock_post
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_anular_devolucion(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_anular_devolucion(uuid, text) TO authenticated;
