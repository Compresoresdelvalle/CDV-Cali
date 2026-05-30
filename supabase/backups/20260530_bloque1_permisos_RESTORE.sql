-- ============================================================================
-- RESTORE Bloque 1 — revertir permisos/roles a su estado PRE-Bloque1.
-- Capturado de PRODUCCIÓN el 2026-05-30 antes de aplicar:
--   20260530000001_bloque1_permisos_rls.sql
--   20260530000002_bloque1_traspaso_estado_cancelado.sql
--   20260530000003_bloque1_fn_cancelar_traspaso.sql
-- NOTA: el valor de enum 'cancelado' en estado_traspaso NO se puede eliminar
-- (PostgreSQL no soporta DROP de valores de enum). Es inofensivo dejarlo.
-- ============================================================================

-- ── Políticas RLS (estado original) ────────────────────────────────────────
ALTER POLICY inv_select ON public.inventario
  USING (((SELECT get_my_rol()) = 'Admin') OR (sede_id = (SELECT get_my_sede_id())));

ALTER POLICY ventas_insert ON public.ventas
  WITH CHECK ((((SELECT get_my_rol()) = ANY (ARRAY['Admin','Vendedor']))
    AND (((SELECT get_my_rol()) = 'Admin') OR (sede_id = (SELECT get_my_sede_id())))));

ALTER POLICY ventas_select ON public.ventas
  USING ((((SELECT get_my_rol()) = 'Admin') OR (sede_id = (SELECT get_my_sede_id()))));

ALTER POLICY dv_select ON public.detalle_venta
  USING (EXISTS (SELECT 1 FROM ventas v
    WHERE ((v.id = detalle_venta.venta_id)
      AND (((SELECT get_my_rol()) = 'Admin') OR (v.sede_id = (SELECT get_my_sede_id()))))));

ALTER POLICY dv_write ON public.detalle_venta
  USING (EXISTS (SELECT 1 FROM ventas v
    WHERE ((v.id = detalle_venta.venta_id)
      AND (((SELECT get_my_rol()) = 'Admin')
        OR ((v.vendedor_id = (SELECT auth.uid())) AND (v.sede_id = (SELECT get_my_sede_id())))))))
  WITH CHECK (EXISTS (SELECT 1 FROM ventas v
    WHERE ((v.id = detalle_venta.venta_id)
      AND (((SELECT get_my_rol()) = 'Admin')
        OR ((v.vendedor_id = (SELECT auth.uid())) AND (v.sede_id = (SELECT get_my_sede_id())))))));

ALTER POLICY prod_modify ON public.productos
  USING (((SELECT get_my_rol()) = ANY (ARRAY['Admin','Bodeguero'])))
  WITH CHECK (((SELECT get_my_rol()) = ANY (ARRAY['Admin','Bodeguero'])));

ALTER POLICY os_insert ON public.ordenes_servicio
  WITH CHECK ((((SELECT get_my_rol()) = ANY (ARRAY['Admin','Tecnico']))
    AND (((SELECT get_my_rol()) = 'Admin') OR (sede_id = (SELECT get_my_sede_id())))));

ALTER POLICY os_update ON public.ordenes_servicio
  USING (((estado <> 'entregada'::estado_orden)
    AND (((SELECT get_my_rol()) = 'Admin') OR (tecnico_id = (SELECT auth.uid())))))
  WITH CHECK ((((SELECT get_my_rol()) = 'Admin')
    OR ((tecnico_id = (SELECT auth.uid())) AND (sede_id = (SELECT get_my_sede_id())))));

-- ── Gates de rol originales en funciones (solo la línea del gate cambió) ─────
-- fn_registrar_venta: reponer el bloqueo por sede en lugar del gate de rol.
--   IF v_mi_rol <> 'Admin' AND v_mi_sede <> p_sede_id THEN RAISE ... END IF;
-- fn_crear_producto:  IF v_rol NOT IN ('Admin','Bodeguero') THEN RAISE ... END IF;
-- fn_crear_traspaso:  IF v_mi_rol NOT IN ('Admin','Bodeguero') THEN RAISE ... END IF;
-- fn_procesar_traspaso: IF v_mi_rol NOT IN ('Admin','Bodeguero') THEN RAISE ... END IF;
-- (Los cuerpos completos originales están en el historial git de
--  supabase/migrations; este archivo documenta el gate exacto a reponer.)

-- ── Validador de transición original (sin 'cancelado') ──────────────────────
CREATE OR REPLACE FUNCTION public.trg_traspaso_validar_transicion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.estado = NEW.estado THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.estado = 'borrador' AND NEW.estado = 'picking') OR
    (OLD.estado = 'picking' AND NEW.estado = 'verificado') OR
    (OLD.estado = 'verificado' AND NEW.estado = 'en_transito') OR
    (OLD.estado = 'en_transito' AND NEW.estado IN ('recibido', 'con_diferencia'))
  ) THEN
    RAISE EXCEPTION 'Transición de estado de traspaso inválida: % -> %', OLD.estado, NEW.estado;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Eliminar la función nueva ───────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_cancelar_traspaso(uuid, text);
