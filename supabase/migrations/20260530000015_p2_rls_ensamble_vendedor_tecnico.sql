-- ============================================================================
-- Parte 2 — A10: RLS del nuevo flujo de ensamble.
--   - La VENDEDORA crea ensambles → ens_insert incluye 'Vendedor'.
--   - El TÉCNICO ASIGNADO puede VER y marcar 'terminado' su ensamble (aunque sea
--     de otra sede) → ens_select / ens_update / de_select incluyen tecnico_id.
-- ============================================================================

ALTER POLICY ens_insert ON public.ensambles
  WITH CHECK (
    ((SELECT get_my_rol()) = ANY (ARRAY['Admin','Bodeguero','Tecnico','Vendedor']))
    AND ((SELECT get_my_rol()) = 'Admin' OR sede_id = (SELECT get_my_sede_id()))
  );

ALTER POLICY ens_select ON public.ensambles
  USING (
    ((SELECT get_my_rol()) = 'Admin')
    OR (sede_id = (SELECT get_my_sede_id()))
    OR (tecnico_id = (SELECT auth.uid()))
  );

ALTER POLICY ens_update ON public.ensambles
  USING (
    (completado = false)
    AND ((SELECT get_my_rol()) = 'Admin'
      OR realizado_por = (SELECT auth.uid())
      OR tecnico_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    (SELECT get_my_rol()) = 'Admin'
    OR realizado_por = (SELECT auth.uid())
    OR tecnico_id = (SELECT auth.uid())
  );

ALTER POLICY de_select ON public.detalle_ensamble
  USING (EXISTS (
    SELECT 1 FROM ensambles e
    WHERE e.id = detalle_ensamble.ensamble_id
      AND ((SELECT get_my_rol()) = 'Admin'
        OR e.sede_id = (SELECT get_my_sede_id())
        OR e.tecnico_id = (SELECT auth.uid()))
  ));
