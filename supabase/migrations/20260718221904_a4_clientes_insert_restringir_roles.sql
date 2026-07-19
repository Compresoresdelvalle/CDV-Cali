-- A4 [P2] Restringir INSERT en clientes a Admin/Vendedor/Bodeguero.
-- Antes: WITH CHECK (true) permitia que cualquier autenticado (incl. Tecnico) creara clientes.
-- Se envuelve get_my_rol() en subconsulta (patron initplan).
ALTER POLICY clientes_insert ON public.clientes
  WITH CHECK ((SELECT get_my_rol()) IN ('Admin','Vendedor','Bodeguero'));
