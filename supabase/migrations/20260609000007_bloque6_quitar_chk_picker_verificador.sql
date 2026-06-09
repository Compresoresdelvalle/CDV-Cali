-- B6 (continuación): eliminar la restricción de segregación de funciones del
-- picker en traspasos. El cliente pidió que en tiendas con UN SOLO vendedor esa
-- misma persona haga el picking y envíe el traspaso (verificado_por = picker).
-- fn_procesar_traspaso ya no exige un tercero; faltaba quitar el CHECK a nivel
-- de tabla que bloqueaba el envío directo (picker == verificado_por) y hacía
-- fallar "Confirmar envío".
--
-- Constraint eliminado:
--   chk_picker_distinto_verificador
--   CHECK ((verificado_por IS NULL) OR (picker_id IS NULL) OR (verificado_por <> picker_id))
alter table public.traspasos
  drop constraint if exists chk_picker_distinto_verificador;
