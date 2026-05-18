-- QA Campaña — Fase 6 (Traspasos + Picking)
--
-- Hallazgo F6-02: la política `trasp_all` (cmd=ALL) permitía a cualquier
-- Admin/Bodeguero hacer UPDATE/DELETE directos de cualquier traspaso,
-- saltándose la máquina de estados de `fn_procesar_traspaso` y la regla
-- picker<>verificador (ej. UPDATE directo borrador->verificado->en_transito
-- dispara `trg_traspaso_salida` sin picking ni verificación reales).
--
-- Solución: `traspasos` y `detalle_traspaso` solo se escriben vía los RPCs
-- `fn_crear_traspaso` y `fn_procesar_traspaso` (SECURITY DEFINER, owner
-- postgres -> ignoran RLS). Se deja solo SELECT, restringido por sede
-- (origen o destino). Verificado: el frontend solo lee estas tablas o usa
-- los RPCs; ningún path escribe directo salvo la creación (ahora vía RPC).

DROP POLICY IF EXISTS trasp_all  ON public.traspasos;
DROP POLICY IF EXISTS trasp_read ON public.traspasos;

CREATE POLICY trasp_select ON public.traspasos
  FOR SELECT TO authenticated
  USING (
    get_my_rol() = 'Admin'
    OR sede_origen_id  = get_my_sede_id()
    OR sede_destino_id = get_my_sede_id()
  );

-- detalle_traspaso: se elimina la política de escritura directa; `dt_select`
-- (SELECT por sede origen/destino) ya existe y se conserva.
DROP POLICY IF EXISTS dt_write ON public.detalle_traspaso;

-- Defensa en profundidad: cantidades enviadas/recibidas no negativas
-- (verificado: 0 filas en violación).
ALTER TABLE public.detalle_traspaso
  ADD CONSTRAINT chk_dt_enviada_no_neg
    CHECK (cantidad_enviada IS NULL OR cantidad_enviada >= 0),
  ADD CONSTRAINT chk_dt_recibida_no_neg
    CHECK (cantidad_recibida IS NULL OR cantidad_recibida >= 0);
