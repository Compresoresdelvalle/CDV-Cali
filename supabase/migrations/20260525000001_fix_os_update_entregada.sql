-- Fix: la policy `os_update` impedía marcar CUALQUIER OT como 'entregada'
-- (incluso al Admin). El predicado `estado <> 'entregada'` estaba también en
-- el WITH CHECK, que valida la fila NUEVA → al pasar a 'entregada' la fila
-- nueva tiene estado='entregada' y el WITH CHECK fallaba con error RLS.
--
-- Regresión introducida en el hardening de Fase 7. El `estado <> 'entregada'`
-- debe vivir SOLO en el USING (inmutabilidad: no se puede modificar una OT ya
-- entregada), nunca en el WITH CHECK (que bloquearía la transición hacia
-- 'entregada'). Se mantiene el control de rol/sede.

DROP POLICY IF EXISTS "os_update" ON public.ordenes_servicio;

CREATE POLICY "os_update" ON public.ordenes_servicio
  FOR UPDATE TO authenticated
  USING (
    estado <> 'entregada'
    AND ((SELECT get_my_rol()) = 'Admin'
         OR tecnico_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    (SELECT get_my_rol()) = 'Admin'
    OR (tecnico_id = (SELECT auth.uid())
        AND sede_id = (SELECT get_my_sede_id()))
  );
