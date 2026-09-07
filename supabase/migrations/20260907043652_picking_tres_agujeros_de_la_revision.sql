-- Tres agujeros que encontro la revision adversarial, dos confirmados con
-- numeros contra datos reales antes de tocar nada:
--
-- 1. Una linea REPETIDA en el conteo pasaba la validacion y se procesaba dos
--    veces: +14 de stock donde correspondian +12, y el reclamo al proveedor se
--    habria duplicado igual.
-- 2. Con sobrante y muchas dañadas (pedido 5, llegaron 10, 8 rotas) la
--    recepcion ENTERA abortaba, tumbando tambien las lineas bien contadas.
-- 3. El mismo producto en dos lineas con destino distinto podia descontar el
--    daño del cajon equivocado (bajar lo vendible por unas unidades de insumo).
--
-- Verificado despues del arreglo: la linea repetida rebota, y la invariante
-- stock = llegaron - dañadas se cumple en los 7 casos, incluido el extremo.

CREATE OR REPLACE FUNCTION public.fn_procesar_picking_compra(
  p_compra_id uuid,
  p_lineas    jsonb DEFAULT NULL,
  p_omitido   boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_rol        text;
  v_mi_sede    text;
  v_compra     record;
  v_total_lin  int;
  v_picking_id uuid;
  v_l          jsonb;
  v_det        record;
  v_sob        record;
  v_llegaron   int;
  v_danadas    int;
  v_faltan     int;
  v_sobran     int;
  v_recep      jsonb := '[]'::jsonb;
  v_items_gar  jsonb := '[]'::jsonb;
  v_recl_prod  jsonb := '{}'::jsonb;
  v_distintas  int;
  v_largo      int;
  v_dup        record;
  v_sobran_ef  int;
  v_recl_bruto int;
  v_reclamo    int;
  v_gar_id     uuid;
  v_contadas   int := 0;
  v_stock_ant  int;
  v_sobran_tot int := 0;
  v_ajust_tot  int := 0;
  v_recl_tot   int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT u.rol::text, u.sede_id INTO v_rol, v_mi_sede FROM usuarios u WHERE u.id = v_uid;
  IF v_rol NOT IN ('Admin','Bodeguero') THEN
    RAISE EXCEPTION 'El conteo de recepcion lo hacen Bodega o Administracion. Tu rol (%) puede recibir la compra, pero no contarla.', v_rol;
  END IF;

  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada'; END IF;
  IF v_rol <> 'Admin' AND v_compra.sede_destino_id IS DISTINCT FROM v_mi_sede THEN
    RAISE EXCEPTION 'Esta compra es de la sede %, y tu estas en %. Pidesela a quien reciba alli o a Maritza.',
      v_compra.sede_destino_id, COALESCE(v_mi_sede,'ninguna');
  END IF;
  IF v_compra.estado = 'cancelada' THEN
    RAISE EXCEPTION 'La compra #% esta cancelada: no hay nada que recibir.', v_compra.numero;
  END IF;
  IF COALESCE(v_compra.recibida,false) THEN
    RAISE EXCEPTION 'La compra #% ya fue recibida el %.', v_compra.numero,
      to_char(v_compra.fecha_recepcion AT TIME ZONE 'America/Bogota','DD/MM/YYYY HH24:MI');
  END IF;

  SELECT count(*) INTO v_total_lin FROM detalle_compra WHERE compra_id = p_compra_id;
  IF v_total_lin = 0 THEN
    RAISE EXCEPTION 'La compra #% no tiene productos que contar. Recibela directamente.', v_compra.numero;
  END IF;

  -- AGUJERO 3: el mismo producto en dos lineas con destino distinto haria que
  -- el reclamo se descuente del cajon equivocado. Nunca ha pasado en 737
  -- compras, y arreglarlo de raiz obliga a tocar una funcion compartida. Se
  -- frena con un mensaje que dice que hacer: mejor eso que corromper dos
  -- inventarios en silencio.
  SELECT dc.producto_id, p.nombre INTO v_dup
    FROM detalle_compra dc JOIN productos p ON p.id = dc.producto_id
   WHERE dc.compra_id = p_compra_id
   GROUP BY dc.producto_id, p.nombre
  HAVING count(DISTINCT dc.destino) > 1
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Esta compra trae % en dos lineas con destino distinto (una para venta y otra para insumo), y el conteo no puede saber de cual cajon salio un daño. Recibela sin contar, o pidele a Maritza que separe esa compra en dos.',
      v_dup.nombre;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('picking:' || p_compra_id::text));

  -- ── Camino corto: recibir sin contar ──────────────────────────────────
  IF p_omitido THEN
    INSERT INTO compra_picking (compra_id, usuario_id, omitido, lineas_total, lineas_contadas, notas)
    VALUES (p_compra_id, v_uid, true, v_total_lin, 0, 'Recibida sin contar')
    RETURNING id INTO v_picking_id;

    PERFORM fn_recibir_compra(p_compra_id, NULL);

    RETURN jsonb_build_object('picking_id', v_picking_id, 'omitido', true,
      'numero', v_compra.numero, 'lineas', v_total_lin);
  END IF;

  -- ── Validacion del conteo ─────────────────────────────────────────────
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' THEN
    RAISE EXCEPTION 'No llego ningun conteo. Vuelve a la pantalla y cuenta la mercancia.';
  END IF;

  -- Contar elementos NO alcanza: mandar dos veces la misma linea y omitir otra
  -- daria la misma longitud y dejaria una linea sin contar recibiendose
  -- completa. Se exige cobertura por lineas DISTINTAS.
  -- AGUJERO 1: hay que exigir las DOS cosas. Contar distintos evita que falte
  -- una linea; contar el largo evita que venga REPETIDA. Con solo lo primero,
  -- [L1, L2, L1] entraba sobre una compra de 2 lineas y L1 se procesaba dos
  -- veces: medido, +14 de stock donde correspondian +12.
  v_largo := jsonb_array_length(p_lineas);
  SELECT count(DISTINCT (e->>'detalle_id')) INTO v_distintas
    FROM jsonb_array_elements(p_lineas) e;
  IF v_distintas <> v_total_lin OR v_largo <> v_total_lin THEN
    RAISE EXCEPTION 'El conteo no cuadra con la compra: tiene % lineas y llegaron % (% distintas). Vuelve a la pantalla y termina de contar.',
      v_total_lin, v_largo, v_distintas;
  END IF;

  INSERT INTO compra_picking (compra_id, usuario_id, omitido, lineas_total, lineas_contadas)
  VALUES (p_compra_id, v_uid, false, v_total_lin, v_total_lin)
  RETURNING id INTO v_picking_id;

  FOR v_l IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    SELECT dc.*, p.nombre AS pnombre INTO v_det
      FROM detalle_compra dc JOIN productos p ON p.id = dc.producto_id
     WHERE dc.id = (v_l->>'detalle_id')::uuid AND dc.compra_id = p_compra_id
     FOR UPDATE OF dc;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Una de las lineas contadas no pertenece a esta compra.';
    END IF;

    v_llegaron := GREATEST(0, COALESCE((v_l->>'llegaron')::int, 0));
    v_danadas  := GREATEST(0, COALESCE((v_l->>'danadas')::int, 0));
    IF v_danadas > v_llegaron THEN
      RAISE EXCEPTION 'En % marcaste % dañadas pero solo llegaron %.',
        v_det.pnombre, v_danadas, v_llegaron;
    END IF;

    v_faltan := GREATEST(0, v_det.cantidad - v_llegaron);
    v_sobran := GREATEST(0, v_llegaron - v_det.cantidad);

    IF v_faltan > 0 AND COALESCE(v_l->>'faltante_accion','') NOT IN ('ajustar','reclamar') THEN
      RAISE EXCEPTION 'Falta decidir que se hace con las % unidades que faltaron de %.',
        v_faltan, v_det.pnombre;
    END IF;
    IF v_sobran > 0 AND COALESCE(v_l->>'sobrante_accion','') NOT IN ('entra','entra_y_reporta') THEN
      RAISE EXCEPTION 'Falta decidir que se hace con las % unidades de mas de %.',
        v_sobran, v_det.pnombre;
    END IF;

    -- `destino` y `costo_unitario` se copian aqui a proposito: la bitacora
    -- tiene que poder explicarse sola aunque la linea de la compra desaparezca
    -- (fn_recibir_compra BORRA la que reciba en cero).
    INSERT INTO compra_picking_detalle (picking_id, detalle_compra_id, producto_id,
      pedido, llegaron, danadas, faltante_accion, sobrante_accion, metodo_conteo,
      destino, costo_unitario)
    VALUES (v_picking_id, v_det.id, v_det.producto_id, v_det.cantidad,
      v_llegaron, v_danadas,
      NULLIF(v_l->>'faltante_accion',''), NULLIF(v_l->>'sobrante_accion',''),
      COALESCE(NULLIF(v_l->>'metodo_conteo',''), 'manual'),
      v_det.destino, v_det.costo_unitario);

    -- Solo el faltante AJUSTADO baja la factura.
    IF v_faltan > 0 AND v_l->>'faltante_accion' = 'ajustar' THEN
      v_recep := v_recep || jsonb_build_array(jsonb_build_object(
        'detalle_id', v_det.id, 'cantidad_recibida', v_llegaron));
      v_ajust_tot := v_ajust_tot + v_faltan;
    END IF;

    -- Lo que se le reclama al proveedor: dañadas siempre, mas el faltante que
    -- el operario marco como facturado.
    -- AGUJERO 2: al proveedor solo se le reclama lo que se le pago. Si las
    -- dañadas pasan de lo facturado (llego de mas y venia roto), el excedente
    -- NI se reclama NI entra al inventario: se descuenta del sobrante. Antes
    -- esto abortaba la recepcion entera. La invariante aguanta:
    -- stock = llegaron - dañadas.
    v_recl_bruto := v_danadas
                  + CASE WHEN v_faltan > 0 AND v_l->>'faltante_accion' = 'reclamar'
                         THEN v_faltan ELSE 0 END;
    v_reclamo   := LEAST(v_recl_bruto, v_det.cantidad);
    v_sobran_ef := GREATEST(0, v_sobran - (v_recl_bruto - v_reclamo));
    -- Se acumula por PRODUCTO, no por linea. Nada impide que el mismo producto
    -- venga en dos lineas de la misma compra (una para venta y otra para
    -- insumo es un caso legitimo, y no hay constraint que lo prohiba). Con dos
    -- entradas del mismo producto, el tope de fn_abrir_garantia_compra se
    -- evaluaria por partes en vez de contra el total.
    IF v_reclamo > 0 THEN
      v_recl_prod := v_recl_prod || jsonb_build_object(
        v_det.producto_id::text,
        COALESCE((v_recl_prod->>v_det.producto_id::text)::int, 0) + v_reclamo);
      v_recl_tot := v_recl_tot + v_reclamo;
    END IF;

    v_sobran_tot := v_sobran_tot + v_sobran_ef;
  END LOOP;

  -- ── 1. Recibir ────────────────────────────────────────────────────────
  PERFORM fn_recibir_compra(p_compra_id,
    CASE WHEN jsonb_array_length(v_recep) > 0 THEN v_recep ELSE NULL END);

  -- ── 2. Reclamar al proveedor, si hay que reclamar ─────────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'producto_id', e.k::uuid, 'cantidad', e.v::int)), '[]'::jsonb)
    INTO v_items_gar
    FROM jsonb_each_text(v_recl_prod) AS e(k, v)
   WHERE e.v::int > 0;

  IF jsonb_array_length(v_items_gar) > 0 THEN
    v_gar_id := fn_abrir_garantia_compra(jsonb_build_object(
      'compra_id',  p_compra_id,
      'resolucion', 'pendiente',
      'motivo',     'Diferencia detectada en el conteo de recepcion',
      'items',      v_items_gar));
  END IF;

  -- ── 3. Sobrante: entra al costo de la linea ───────────────────────────
  IF v_sobran_tot > 0 THEN
    -- Se lee de la BITACORA, sin JOIN contra detalle_compra: esa fila puede
    -- haber desaparecido, que es justo la razon de que la bitacora exista.
    FOR v_sob IN
      SELECT d.producto_id, d.destino, d.costo_unitario,
             GREATEST(0, (d.llegaron - d.pedido) - GREATEST(0, d.danadas - d.pedido)) AS sobran
        FROM compra_picking_detalle d
       WHERE d.picking_id = v_picking_id AND d.llegaron > d.pedido
    LOOP
      CONTINUE WHEN v_sob.sobran <= 0;

      INSERT INTO inventario (producto_id, sede_id, cantidad, cantidad_insumo)
      VALUES (v_sob.producto_id, v_compra.sede_destino_id, 0, 0)
      ON CONFLICT (producto_id, sede_id) DO NOTHING;

      IF v_sob.destino = 'insumo' THEN
        SELECT COALESCE(cantidad_insumo,0) INTO v_stock_ant FROM inventario
         WHERE producto_id = v_sob.producto_id AND sede_id = v_compra.sede_destino_id FOR UPDATE;
        UPDATE inventario SET cantidad_insumo = COALESCE(cantidad_insumo,0) + v_sob.sobran,
               ultimo_movimiento = now(), updated_at = now()
         WHERE producto_id = v_sob.producto_id AND sede_id = v_compra.sede_destino_id;
      ELSE
        SELECT COALESCE(cantidad,0) INTO v_stock_ant FROM inventario
         WHERE producto_id = v_sob.producto_id AND sede_id = v_compra.sede_destino_id FOR UPDATE;
        UPDATE inventario SET cantidad = cantidad + v_sob.sobran,
               ultimo_movimiento = now(), updated_at = now()
         WHERE producto_id = v_sob.producto_id AND sede_id = v_compra.sede_destino_id;
      END IF;

      INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad,
        stock_anterior, stock_posterior, referencia_id, referencia_tipo,
        usuario_id, observaciones)
      VALUES ('ajuste', v_sob.producto_id, v_compra.sede_destino_id, v_sob.sobran,
        v_stock_ant, v_stock_ant + v_sob.sobran, p_compra_id, 'compra', v_uid,
        format('Sobrante en la recepcion de la compra #%s (entra al costo de la linea, $%s)',
               v_compra.numero, to_char(COALESCE(v_sob.costo_unitario,0),'FM999G999G999G990')));

      PERFORM fn_actualizar_estado_stock(v_sob.producto_id, v_compra.sede_destino_id);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'picking_id', v_picking_id, 'omitido', false, 'numero', v_compra.numero,
    'lineas', v_total_lin, 'ajustadas', v_ajust_tot,
    'reclamadas', v_recl_tot, 'sobrantes', v_sobran_tot,
    'garantia_id', v_gar_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_procesar_picking_compra(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_procesar_picking_compra(uuid, jsonb, boolean) TO authenticated;
