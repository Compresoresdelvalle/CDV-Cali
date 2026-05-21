-- Feature: edición de precio de venta de un producto (solo Admin).
-- Flujo: Inventario → click producto → ProductoDetalle → botón ✏️ Editar
--        precio → modal con input → confirm → RPC.
-- Server-authoritative: la única forma de cambiar `precio_venta` desde la
-- app. Valida sesión, rol Admin y precio >= 0. `FOR UPDATE` para serializar
-- ediciones concurrentes del mismo producto.

CREATE OR REPLACE FUNCTION public.fn_editar_precio_producto(
  p_producto_id UUID,
  p_precio_venta NUMERIC)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid  UUID := auth.uid();
  v_rol  TEXT;
  v_precio_anterior NUMERIC;
  v_nombre TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol <> 'Admin' THEN
    RAISE EXCEPTION 'Solo el Admin puede editar el precio de productos';
  END IF;
  IF p_precio_venta IS NULL OR p_precio_venta < 0 THEN
    RAISE EXCEPTION 'El precio debe ser un número mayor o igual a 0';
  END IF;

  SELECT precio_venta, nombre INTO v_precio_anterior, v_nombre
    FROM productos WHERE id = p_producto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  UPDATE productos SET
    precio_venta = p_precio_venta,
    updated_at = now()
  WHERE id = p_producto_id;

  RETURN jsonb_build_object(
    'producto_id',   p_producto_id,
    'nombre',        v_nombre,
    'precio_anterior', v_precio_anterior,
    'precio_nuevo',  p_precio_venta,
    'cambiado_por',  v_uid,
    'cambiado_en',   now()
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_editar_precio_producto(uuid, numeric) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_editar_precio_producto(uuid, numeric) TO authenticated;
