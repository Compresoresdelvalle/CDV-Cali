-- Un egreso nuevo nace con su categoria. Si solo se limpia lo viejo, la bandeja
-- de clasificacion se vuelve a llenar sola y el Resultado nunca cierra.
--
-- El parametro va AL FINAL y con DEFAULT NULL a proposito: la categoria es
-- obligatoria en la PANTALLA, no en el servidor. El motivo es operativo, no de
-- pereza: esta app es una PWA y ya paso que un cliente se quedara con el bundle
-- viejo en cache durante dias. Si el servidor rechazara los egresos sin
-- categoria, una vendedora con la version cacheada no podria registrar caja
-- menor y quedaria bloqueada a mitad de la operacion.
--
-- Con DEFAULT NULL el peor caso es que un egreso caiga sin clasificar, y eso ya
-- tiene su red: aparece en /admin/egresos con su monto sumado al margen de error
-- del Resultado. Es visible y recuperable; un bloqueo en caja no lo es.
--
-- Verificado: con categoria nace clasificado, sin categoria cae a la bandeja, y
-- una categoria inexistente si se rechaza.
CREATE OR REPLACE FUNCTION public.fn_registrar_caja_menor(
  p_sede_id text,
  p_concepto text,
  p_monto numeric,
  p_proveedor text DEFAULT NULL::text,
  p_observaciones text DEFAULT NULL::text,
  p_metodo_pago text DEFAULT NULL::text,
  p_cuenta_bancaria text DEFAULT NULL::text,
  p_categoria_gasto_id bigint DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario_id UUID;
  v_mi_sede    TEXT;
  v_mi_rol     TEXT;
  v_compra_id  UUID;
  v_numero     INT;
  v_monto      NUMERIC;
  v_metodo     TEXT;
  v_cuenta     TEXT;
  v_categoria  BIGINT;
BEGIN
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT sede_id, rol::TEXT INTO v_mi_sede, v_mi_rol
    FROM usuarios WHERE id = v_usuario_id;

  IF v_mi_rol NOT IN ('Admin', 'Bodeguero', 'Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar compras';
  END IF;
  IF v_mi_rol <> 'Admin' AND v_mi_sede IS DISTINCT FROM p_sede_id THEN
    RAISE EXCEPTION 'No puedes registrar en una sede distinta a la tuya';
  END IF;

  IF p_concepto IS NULL OR TRIM(p_concepto) = '' THEN
    RAISE EXCEPTION 'El concepto es obligatorio para una compra de caja menor';
  END IF;

  v_monto := ROUND(COALESCE(p_monto, 0), 2);
  IF v_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0';
  END IF;

  -- Una categoria que no existe o esta inactiva se rechaza; una AUSENTE se
  -- acepta y cae a la bandeja de clasificacion.
  IF p_categoria_gasto_id IS NOT NULL THEN
    SELECT id INTO v_categoria
      FROM categorias_gasto WHERE id = p_categoria_gasto_id AND activa = true;
    IF v_categoria IS NULL THEN
      RAISE EXCEPTION 'La categoría de gasto no existe o está inactiva';
    END IF;
  END IF;

  -- S6-E: prioridad parámetro explícito > GUC (S1-21, fn_registrar_cambio) > 'Efectivo'
  v_metodo := public._fn_metodo_pago_canonico(
                COALESCE(NULLIF(TRIM(COALESCE(p_metodo_pago,'')), ''),
                         NULLIF(current_setting('cdv.caja_menor_metodo', true), ''),
                         'Efectivo'));
  IF v_metodo NOT IN ('Efectivo','Transferencia','Tarjeta') THEN
    RAISE EXCEPTION 'Método de pago inválido para caja menor (%)', v_metodo;
  END IF;

  v_cuenta := COALESCE(NULLIF(TRIM(COALESCE(p_cuenta_bancaria,'')), ''),
                       NULLIF(current_setting('cdv.caja_menor_cuenta', true), ''));
  IF v_metodo IN ('Transferencia','Tarjeta') AND v_cuenta IS NULL THEN
    RAISE EXCEPTION 'Indica la cuenta bancaria para pagos con % (Transferencia o Tarjeta).', v_metodo;
  END IF;
  IF v_metodo = 'Efectivo' THEN
    v_cuenta := NULL;
  END IF;

  INSERT INTO compras (
    proveedor, registrado_por, sede_destino_id, subtotal, iva, total,
    factura_proveedor, observaciones, recibida, fecha_recepcion,
    es_caja_menor, concepto, metodo_pago, cuenta_bancaria,
    categoria_gasto_id
  ) VALUES (
    COALESCE(NULLIF(TRIM(COALESCE(p_proveedor, '')), ''), 'Caja menor'),
    v_usuario_id, p_sede_id, v_monto, 0, v_monto,
    NULL,
    NULLIF(TRIM(COALESCE(p_observaciones, '')), ''),
    true, now(),
    true, TRIM(p_concepto), v_metodo, v_cuenta,
    v_categoria
  ) RETURNING id, numero INTO v_compra_id, v_numero;

  RETURN jsonb_build_object(
    'compra_id', v_compra_id, 'numero', v_numero,
    'total', v_monto, 'es_caja_menor', true,
    'metodo_pago', v_metodo, 'cuenta_bancaria', v_cuenta,
    'categoria_gasto_id', v_categoria
  );
END;
$function$;

-- CREATE OR REPLACE con un parametro nuevo crea una funcion DISTINTA: con las
-- dos vivas PostgREST no sabe cual llamar y cada egreso fallaria por ambiguedad.
-- Y la nueva nace con EXECUTE para PUBLIC, asi que `anon` podria registrar
-- egresos saltandose la RLS (es SECURITY DEFINER).
DROP FUNCTION public.fn_registrar_caja_menor(text, text, numeric, text, text, text, text);

REVOKE EXECUTE ON FUNCTION public.fn_registrar_caja_menor(
  text, text, numeric, text, text, text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_registrar_caja_menor(
  text, text, numeric, text, text, text, text, bigint) TO authenticated, service_role;
