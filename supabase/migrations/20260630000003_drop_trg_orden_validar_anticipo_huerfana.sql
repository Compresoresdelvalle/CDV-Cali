-- Eliminar función huérfana trg_orden_validar_anticipo — 2026-06-30
--
-- Esta función NO está conectada a ningún trigger (verificado en pg_trigger) ni
-- es invocada por ninguna otra función. Quedó como código muerto y además
-- confunde: su texto exigía "al menos un anticipo registrado", lo que contradice
-- el nuevo comportamiento (anticipo opcional, ver 20260630000002). El único gate
-- de transición activo es trg_orden_validar_transicion. Se elimina para limpiar.

drop function if exists public.trg_orden_validar_anticipo();
