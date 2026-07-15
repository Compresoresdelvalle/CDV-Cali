-- ============================================================================
-- Limpieza: eliminar la versión VIEJA de fn_crear_herramienta_desde_insumo.
--
-- En 20260715000002 se recreó la función agregando el parámetro p_cantidad.
-- Como cambia la firma, Postgres NO reemplazó la anterior: quedó una
-- sobrecarga (overload) con dos versiones vivas:
--   · fn_crear_herramienta_desde_insumo(uuid, text)            ← vieja (crea 1)
--   · fn_crear_herramienta_desde_insumo(uuid, text, integer)   ← nueva (crea N)
--
-- El frontend hoy siempre llama con los 3 parámetros (p_cantidad), así que la
-- de 2 quedó muerta. Se elimina para evitar ambigüedad de PostgREST y que
-- ningún llamado accidental de 2 args termine creando 1 sola unidad.
-- ============================================================================

DROP FUNCTION IF EXISTS public.fn_crear_herramienta_desde_insumo(uuid, text);
