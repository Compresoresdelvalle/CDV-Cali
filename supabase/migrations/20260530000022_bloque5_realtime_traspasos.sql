-- ============================================================================
-- Bloque 5 · #19 — Realtime para el flujo de traspasos.
--
-- El detalle y el historial de traspasos ahora se actualizan en vivo durante el
-- relevo picker → verificador → envío → recepción (a menudo en personas y
-- dispositivos distintos). Para que las suscripciones del frontend reciban
-- eventos, las tablas deben estar en la publicación `supabase_realtime`.
-- Hoy solo `inventario` lo estaba.
--
-- Realtime respeta la RLS: cada usuario solo recibe eventos de las filas que su
-- política de SELECT le permite (los no-Admin, solo traspasos de su sede).
--
-- REPLICA IDENTITY FULL en detalle_traspaso para que el filtro por traspaso_id
-- (columna no-PK) funcione en todos los tipos de evento. traspasos se filtra
-- por id (PK), así que su identidad por defecto basta.
-- ============================================================================

ALTER TABLE public.detalle_traspaso REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.traspasos;
ALTER PUBLICATION supabase_realtime ADD TABLE public.detalle_traspaso;
