-- ============================================================================
-- Parte 1 (insumos en OT) — A6:
--   1. Tabla `notificaciones`: bandeja in-app para el Admin (conversiones,
--      ensambles creados, etc.).
--   2. fn_convertir_a_insumo: amplía el permiso a todos los roles operativos
--      (Admin, Bodeguero, Tecnico, Vendedor) y, si quien convierte NO es Admin,
--      inserta una notificación detallada para el Admin. Devuelve notificado_admin.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notificaciones (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo        text NOT NULL,
  titulo      text NOT NULL,
  mensaje     text NOT NULL,
  data        jsonb,
  para_rol    text,                 -- rol destinatario (p.ej. 'Admin')
  leida       boolean NOT NULL DEFAULT false,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notificaciones_para_rol_leida
  ON public.notificaciones (para_rol, leida, created_at DESC);

ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;

-- El destinatario (por rol) o el creador pueden ver la notificación.
DROP POLICY IF EXISTS notif_select ON public.notificaciones;
CREATE POLICY notif_select ON public.notificaciones FOR SELECT TO authenticated
  USING (
    (para_rol = (SELECT get_my_rol())) OR (created_by = (SELECT auth.uid()))
  );

-- El destinatario/creador puede marcarla como leída.
DROP POLICY IF EXISTS notif_update ON public.notificaciones;
CREATE POLICY notif_update ON public.notificaciones FOR UPDATE TO authenticated
  USING (
    (para_rol = (SELECT get_my_rol())) OR (created_by = (SELECT auth.uid()))
  )
  WITH CHECK (
    (para_rol = (SELECT get_my_rol())) OR (created_by = (SELECT auth.uid()))
  );
-- INSERT solo vía funciones SECURITY DEFINER (no hay policy de INSERT a propósito).

-- ── fn_convertir_a_insumo: roles ampliados + notificación al Admin ──────────
CREATE OR REPLACE FUNCTION public.fn_convertir_a_insumo(
  p_producto_id uuid, p_sede_id text, p_cantidad integer
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rol text; v_usuario text;
  v_venta int; v_insumo int;
  v_prod text; v_sede text;
  v_notificar boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::text, nombre INTO v_rol, v_usuario FROM usuarios WHERE id = v_uid;
  IF v_rol IS NULL OR v_rol NOT IN ('Admin','Bodeguero','Tecnico','Vendedor') THEN
    RAISE EXCEPTION 'No tienes permiso para convertir stock a insumo (rol %)', COALESCE(v_rol,'desconocido');
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad a convertir debe ser mayor a 0';
  END IF;

  SELECT cantidad, cantidad_insumo INTO v_venta, v_insumo
    FROM inventario WHERE producto_id = p_producto_id AND sede_id = p_sede_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no tiene inventario en la sede %', p_sede_id;
  END IF;
  IF v_venta < p_cantidad THEN
    RAISE EXCEPTION 'Stock de venta insuficiente (hay %, intentas convertir %)', v_venta, p_cantidad;
  END IF;

  UPDATE inventario
     SET cantidad = cantidad - p_cantidad,
         cantidad_insumo = cantidad_insumo + p_cantidad,
         ultimo_movimiento = now(), updated_at = now()
   WHERE producto_id = p_producto_id AND sede_id = p_sede_id;

  INSERT INTO movimientos (tipo, producto_id, sede_id, cantidad, stock_anterior, stock_posterior,
    referencia_tipo, usuario_id, observaciones)
  VALUES ('conversion_a_insumo', p_producto_id, p_sede_id, -p_cantidad,
    v_venta, v_venta - p_cantidad, 'conversion', v_uid,
    format('Convertidas %s uds de venta a insumo', p_cantidad));

  PERFORM fn_actualizar_estado_stock(p_producto_id, p_sede_id);

  -- Notificar al Admin si quien convierte NO es Admin.
  v_notificar := (v_rol <> 'Admin');
  IF v_notificar THEN
    SELECT nombre INTO v_prod FROM productos WHERE id = p_producto_id;
    SELECT nombre INTO v_sede FROM sedes WHERE id = p_sede_id;
    INSERT INTO notificaciones (tipo, titulo, mensaje, data, para_rol, created_by)
    VALUES (
      'conversion_insumo',
      'Conversión a insumo',
      format('%s (%s) convirtió %s ud(s) de "%s" de venta a insumo en %s.',
             COALESCE(v_usuario,'?'), v_rol, p_cantidad,
             COALESCE(v_prod, p_producto_id::text), COALESCE(v_sede, p_sede_id)),
      jsonb_build_object(
        'producto_id', p_producto_id, 'producto', v_prod,
        'sede_id', p_sede_id, 'sede', v_sede,
        'cantidad', p_cantidad, 'usuario_id', v_uid, 'usuario', v_usuario, 'rol', v_rol),
      'Admin', v_uid
    );
  END IF;

  RETURN jsonb_build_object('producto_id', p_producto_id, 'sede_id', p_sede_id,
    'cantidad_venta', v_venta - p_cantidad, 'cantidad_insumo', v_insumo + p_cantidad,
    'notificado_admin', v_notificar);
END $function$;
