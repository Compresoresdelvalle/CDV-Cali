-- MEDIO (auditoría 2026-06-09, M4): la "inmutabilidad" de una compra recibida no
-- se cumplía para sus datos materiales. El trigger trg_compra_recibida_inmutable
-- dispara BEFORE UPDATE **OF recibida**, así que solo corre si el UPDATE toca la
-- columna `recibida`. Un `UPDATE compras SET sede_destino_id=... / total=...`
-- (sin tocar recibida) NO lo dispara, y la RLS compras_update deja a Admin/Bodeguero
-- editar cualquier columna. Cambiar sede_destino_id tras recepción es lo más
-- peligroso: el stock se sumó en la sede vieja, pero una cancelación posterior
-- revertiría en la sede nueva (sin stock).
--
-- Fix: trigger BEFORE UPDATE GENERAL (no acotado a una columna) que, cuando la
-- compra ya estaba recibida, rechace cambios en columnas materiales (sede, importes,
-- proveedor, factura, método de pago, concepto). Permite seguir cambiando estado
-- (cancelada/devolucion_garantia), fecha_recepcion y observaciones.

create or replace function public.trg_compra_proteger_materiales()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
BEGIN
  IF COALESCE(OLD.recibida, false) = true THEN
    IF NEW.sede_destino_id   IS DISTINCT FROM OLD.sede_destino_id
       OR NEW.subtotal         IS DISTINCT FROM OLD.subtotal
       OR NEW.iva              IS DISTINCT FROM OLD.iva
       OR NEW.iva_pct          IS DISTINCT FROM OLD.iva_pct
       OR NEW.total            IS DISTINCT FROM OLD.total
       OR NEW.descuento_valor  IS DISTINCT FROM OLD.descuento_valor
       OR NEW.proveedor        IS DISTINCT FROM OLD.proveedor
       OR NEW.factura_proveedor IS DISTINCT FROM OLD.factura_proveedor
       OR NEW.metodo_pago      IS DISTINCT FROM OLD.metodo_pago
       OR NEW.cuenta_bancaria  IS DISTINCT FROM OLD.cuenta_bancaria
       OR NEW.concepto         IS DISTINCT FROM OLD.concepto
       OR NEW.es_caja_menor    IS DISTINCT FROM OLD.es_caja_menor THEN
      RAISE EXCEPTION 'No se pueden modificar los datos materiales (sede, importes, proveedor, factura, método de pago) de una compra ya recibida';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

drop trigger if exists trg_before_update_compra_materiales on public.compras;
create trigger trg_before_update_compra_materiales
  before update on public.compras
  for each row
  execute function public.trg_compra_proteger_materiales();
