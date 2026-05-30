-- ============================================================================
-- Bloque 1 — CORRECCIÓN (#3): el Vendedor vende SOLO desde su propia sede.
-- La clienta corrigió el requisito: vender de cualquier sede NO va.
-- Se REVIERTE la parte de "vender desde cualquier sede" de fn_registrar_venta
-- y de las policies de ventas/detalle_venta a su comportamiento original
-- (Admin = cualquier sede, Vendedor = su sede).
--
-- SE MANTIENE `inv_select USING(true)`: el vendedor SÍ puede VER el inventario
-- de todas las sedes (base para el futuro desplegable "Sede"). Solo se restringe
-- la VENTA, no la lectura.
-- ============================================================================

-- ventas_insert: volver a exigir que la venta sea de la sede del usuario (salvo Admin).
ALTER POLICY ventas_insert ON public.ventas
  WITH CHECK (
    ((SELECT get_my_rol()) = ANY (ARRAY['Admin', 'Vendedor']))
    AND ((SELECT get_my_rol()) = 'Admin' OR sede_id = (SELECT get_my_sede_id()))
  );

-- ventas_select: Admin ve todo; el resto ve las ventas de su sede.
ALTER POLICY ventas_select ON public.ventas
  USING (((SELECT get_my_rol()) = 'Admin') OR (sede_id = (SELECT get_my_sede_id())));

-- detalle_venta (lectura): de nuevo acotado por sede.
ALTER POLICY dv_select ON public.detalle_venta
  USING (EXISTS (
    SELECT 1 FROM ventas v
    WHERE v.id = detalle_venta.venta_id
      AND (((SELECT get_my_rol()) = 'Admin') OR (v.sede_id = (SELECT get_my_sede_id())))
  ));

-- detalle_venta (escritura): el vendedor escribe el detalle de sus ventas de su sede.
ALTER POLICY dv_write ON public.detalle_venta
  USING (EXISTS (
    SELECT 1 FROM ventas v
    WHERE v.id = detalle_venta.venta_id
      AND (((SELECT get_my_rol()) = 'Admin')
        OR ((v.vendedor_id = (SELECT auth.uid())) AND (v.sede_id = (SELECT get_my_sede_id()))))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM ventas v
    WHERE v.id = detalle_venta.venta_id
      AND (((SELECT get_my_rol()) = 'Admin')
        OR ((v.vendedor_id = (SELECT auth.uid())) AND (v.sede_id = (SELECT get_my_sede_id()))))
  ));

-- fn_registrar_venta: restaurar el bloqueo por sede (se mantiene el gate de rol
-- Admin/Vendedor, que evita que un Bodeguero/Técnico registre ventas).
CREATE OR REPLACE FUNCTION public.fn_registrar_venta(
  p_sede_id text,
  p_cliente_nombre text DEFAULT NULL::text,
  p_cliente_nit text DEFAULT NULL::text,
  p_metodo_pago text DEFAULT 'Efectivo'::text,
  p_descuento_pct numeric DEFAULT 0,
  p_observaciones text DEFAULT NULL::text,
  p_items jsonb DEFAULT '[]'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vendedor_id UUID;
  v_mi_sede     TEXT;
  v_mi_rol      TEXT;
  v_venta_id    UUID;
  v_numero      INT;
  item          JSONB;
  v_prod_id     UUID;
  v_cantidad    NUMERIC;
  v_precio      NUMERIC;
  v_costo       NUMERIC;
BEGIN
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta debe tener al menos un ítem';
  END IF;

  v_vendedor_id := auth.uid();
  IF v_vendedor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT sede_id, rol::TEXT INTO v_mi_sede, v_mi_rol
    FROM usuarios WHERE id = v_vendedor_id;

  -- Gate de rol: solo Admin/Vendedor registran ventas.
  IF v_mi_rol IS NULL OR v_mi_rol NOT IN ('Admin', 'Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar ventas (rol %)', COALESCE(v_mi_rol, 'desconocido');
  END IF;

  -- Corrección #3: el Vendedor vende SOLO desde su propia sede (Admin, cualquiera).
  IF v_mi_rol <> 'Admin' AND v_mi_sede IS DISTINCT FROM p_sede_id THEN
    RAISE EXCEPTION 'No puedes vender desde otra sede. Tu sede es %, la sede solicitada es %', v_mi_sede, p_sede_id;
  END IF;

  INSERT INTO ventas (
    vendedor_id, sede_id, cliente_nombre, cliente_nit,
    metodo_pago, descuento_pct, iva_pct, observaciones, subtotal, total
  ) VALUES (
    v_vendedor_id, p_sede_id, p_cliente_nombre, p_cliente_nit,
    p_metodo_pago, p_descuento_pct, 19, p_observaciones, 0, 0
  )
  RETURNING id, numero INTO v_venta_id, v_numero;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id  := (item->>'producto_id')::UUID;
    v_cantidad := (item->>'cantidad')::NUMERIC;

    IF v_cantidad IS NULL OR v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida para el producto %', v_prod_id;
    END IF;

    SELECT precio_venta, COALESCE(costo_promedio, 0)
      INTO v_precio, v_costo
      FROM productos WHERE id = v_prod_id AND activo = true;

    IF v_precio IS NULL THEN
      RAISE EXCEPTION 'Producto % no encontrado o inactivo', v_prod_id;
    END IF;

    INSERT INTO detalle_venta (
      venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal
    ) VALUES (
      v_venta_id, v_prod_id, v_cantidad, v_precio, v_costo, v_cantidad * v_precio
    );
  END LOOP;

  RETURN (
    SELECT jsonb_build_object(
      'venta_id', v.id, 'numero', v.numero, 'total', v.total, 'fecha', v.fecha
    ) FROM ventas v WHERE v.id = v_venta_id
  );
END;
$function$;