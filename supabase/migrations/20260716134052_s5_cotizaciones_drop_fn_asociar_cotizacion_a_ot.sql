-- Código viejo: flujo huérfano "Fase 10" (?ot_id=). Sin referencias en BD
-- (ninguna función, vista, trigger ni pg_depend la menciona). El frontend
-- retira su única llamada por separado. NO se toca la columna cotizaciones.ot_id
-- ni sus filas históricas (el frontend sigue mostrando ese enlace).
DROP FUNCTION IF EXISTS public.fn_asociar_cotizacion_a_ot(uuid, uuid);
