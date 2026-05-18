-- QA Campaña — Fase 5 (Compras + Devoluciones)
--
-- Hallazgo F5-04: la política `dev_all` (cmd=ALL) permitía a cualquier
-- Admin/Bodeguero hacer INSERT/UPDATE/DELETE crudos sobre `devoluciones`,
-- saltándose TODAS las validaciones de `fn_registrar_devolucion` (venta
-- existente y no anulada, cantidad <= vendido-devuelto, stock suficiente).
-- Combinado con el trigger `trg_devolucion_stock` (aprobada->procesada suma
-- stock), un insider con devtools podía inflar stock con devoluciones falsas.
-- Además `dev_all` no restringía por sede en el SELECT: un bodeguero veía
-- devoluciones de todas las sedes.
--
-- Solución: `devoluciones` solo se escribe vía `fn_registrar_devolucion`
-- (SECURITY DEFINER, owner postgres -> ignora RLS). Se deja únicamente una
-- política de SELECT restringida por sede. Verificado: ningún path del
-- frontend escribe `devoluciones` directamente (solo el RPC y el historial).

DROP POLICY IF EXISTS dev_all ON public.devoluciones;

CREATE POLICY dev_select ON public.devoluciones
  FOR SELECT TO authenticated
  USING (
    get_my_rol() = 'Admin'
    OR sede_id = get_my_sede_id()
  );
