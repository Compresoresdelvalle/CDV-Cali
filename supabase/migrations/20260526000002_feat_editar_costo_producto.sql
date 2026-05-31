-- Feature: edición del costo (costo_promedio) de un producto — SOLO Admin.
-- Espejo de fn_editar_precio_producto. Server-authoritative: es la única forma
-- de AJUSTAR manualmente el costo desde la app. Los demás roles no pueden
-- editar el costo. Las compras (recepción de mercancía) siguen actualizando el
-- costo_promedio por promedio ponderado — eso es registrar, no editar.
--
-- Incluye además un trigger que impide que un usuario no-Admin fije el costo al
-- CREAR un producto (fn_crear_producto permite crear a Bodeguero). Si el creador
-- autenticado no es Admin, costo_promedio se fuerza a 0; lo ajusta luego el
-- Admin (botón "Editar costo") o la primera compra.

-- ── RPC: editar costo (solo Admin) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_editar_costo_producto(
  p_producto_id UUID,
  p_costo NUMERIC)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid  UUID := auth.uid();
  v_rol  TEXT;
  v_costo_anterior NUMERIC;
  v_nombre TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  SELECT rol::TEXT INTO v_rol FROM usuarios WHERE id = v_uid;
  IF v_rol <> 'Admin' THEN
    RAISE EXCEPTION 'Solo el Admin puede editar el costo de productos';
  END IF;
  IF p_costo IS NULL OR p_costo < 0 THEN
    RAISE EXCEPTION 'El costo debe ser un número mayor o igual a 0';
  END IF;

  SELECT costo_promedio, nombre INTO v_costo_anterior, v_nombre
    FROM productos WHERE id = p_producto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  UPDATE productos SET
    costo_promedio = p_costo,
    updated_at = now()
  WHERE id = p_producto_id;

  RETURN jsonb_build_object(
    'producto_id',    p_producto_id,
    'nombre',         v_nombre,
    'costo_anterior', v_costo_anterior,
    'costo_nuevo',    p_costo,
    'cambiado_por',   v_uid,
    'cambiado_en',    now()
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_editar_costo_producto(uuid, numeric) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_editar_costo_producto(uuid, numeric) TO authenticated;

-- ── Trigger: un no-Admin no puede fijar el costo al CREAR un producto ────
CREATE OR REPLACE FUNCTION public.trg_productos_costo_solo_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Solo aplica a usuarios autenticados que no sean Admin. Un contexto sin
  -- auth.uid() (service role / SQL editor / seeds) se considera de confianza.
  IF auth.uid() IS NOT NULL AND COALESCE(get_my_rol(), '') <> 'Admin' THEN
    NEW.costo_promedio := 0;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS productos_costo_guard ON productos;
CREATE TRIGGER productos_costo_guard
  BEFORE INSERT ON productos
  FOR EACH ROW EXECUTE FUNCTION public.trg_productos_costo_solo_admin();
