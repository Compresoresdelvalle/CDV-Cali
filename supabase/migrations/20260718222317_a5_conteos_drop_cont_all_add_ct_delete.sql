-- A5 [P2] Eliminar policy permisiva FOR ALL 'cont_all' en conteos.
-- Al ser PERMISSIVE + FOR ALL se combinaba por OR con ct_insert/ct_update/ct_select
-- y aflojaba sus restricciones de sede/rol (un Bodeguero podia editar/borrar conteos
-- de otras sedes). Se elimina y se agrega ct_delete explicita (solo Admin) para
-- conservar el borrado de conteos pendientes que hace el Admin desde el panel.
-- El trigger trg_conteo_proteger_borrado (blinda los aplicados) NO se toca.
DROP POLICY cont_all ON public.conteos;
CREATE POLICY ct_delete ON public.conteos FOR DELETE TO authenticated
  USING ((SELECT get_my_rol()) = 'Admin');
