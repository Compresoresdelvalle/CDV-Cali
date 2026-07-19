-- A7 [P2, decision del dueno: ELIMINAR] Trigger legacy de devoluciones.
-- trg_after_update_devolucion (AFTER UPDATE OF estado) + trg_devolucion_stock son del
-- flujo viejo aprobada->procesada, hoy inalcanzable: devoluciones no tiene policy de UPDATE
-- para authenticated y fn_registrar_devolucion (unico camino vivo, SECURITY DEFINER) hace
-- solo INSERT con estado='procesada' y maneja stock/movimientos por si misma. No borra datos.
DROP TRIGGER trg_after_update_devolucion ON public.devoluciones;
DROP FUNCTION public.trg_devolucion_stock();
