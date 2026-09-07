-- Base gravable de las retenciones. NO es una formula nueva: es la misma que
-- ya usan los triggers que calculan el total, extraida a una funcion para que
-- las columnas generadas puedan invocarla y para que exista un solo sitio donde
-- diga que se grava.
--
-- Sobre la base (subtotal - descuento) van retefuente y reteICA. Sobre el IVA
-- va reteIVA. El domicilio queda FUERA a proposito: es transporte facturado
-- aparte, no valor de la mercancia.
--
-- OJO: estas funciones son IMMUTABLE y las usan columnas GENERATED STORED. Si
-- algun dia se cambia el cuerpo, Postgres NO recalcula las filas existentes.
-- Cambiarlas exige forzar un rewrite de la tabla en la misma migracion.

-- Espejo de trg_recalcular_total_venta:
--   v_desc := coalesce(descuento_valor, subtotal * descuento_pct/100)
--   v_desc := greatest(0, least(v_desc, subtotal))
--   base   := subtotal - v_desc
CREATE OR REPLACE FUNCTION public._fn_base_retencion_venta(
  p_subtotal numeric, p_descuento_valor numeric, p_descuento_pct numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT coalesce(p_subtotal, 0) - greatest(0::numeric, least(
           coalesce(p_descuento_valor, coalesce(p_subtotal,0) * coalesce(p_descuento_pct,0) / 100),
           coalesce(p_subtotal, 0)))
$$;

-- El IVA facturado. La tabla `ventas` no lo guarda: el trigger calcula
-- total = round(base * (1+iva/100) + domicilio) sin materializarlo. Aqui se
-- redondea a pesos enteros, que es como sale en la factura impresa.
CREATE OR REPLACE FUNCTION public._fn_iva_venta(
  p_subtotal numeric, p_descuento_valor numeric, p_descuento_pct numeric, p_iva_pct numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT round(public._fn_base_retencion_venta(p_subtotal, p_descuento_valor, p_descuento_pct)
               * coalesce(p_iva_pct, 0) / 100)
$$;

-- Espejo de trg_orden_recalcular_total_mo. La OT no autorizada solo cobra la
-- revision: ni mano de obra, ni repuestos, ni descuento.
CREATE OR REPLACE FUNCTION public._fn_base_retencion_ot(
  p_estado_autorizacion text, p_mano_obra numeric, p_repuestos numeric,
  p_revision numeric, p_descuento numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE WHEN p_estado_autorizacion = 'no_autorizado'
    THEN greatest(0::numeric, coalesce(p_revision, 0))
    ELSE greatest(0::numeric,
           (coalesce(p_mano_obra,0) + coalesce(p_repuestos,0) + coalesce(p_revision,0))
           - least(greatest(coalesce(p_descuento,0), 0::numeric),
                   coalesce(p_mano_obra,0) + coalesce(p_repuestos,0) + coalesce(p_revision,0)))
  END
$$;

-- Son funciones internas de calculo, no API. Supabase concede EXECUTE a `anon`
-- por defecto en cada funcion nueva del esquema public, y REVOKE FROM PUBLIC
-- no lo quita: hay que nombrar el rol.
--
-- OJO: estos tres REVOKE NO SIRVIERON. El permiso de `anon` no venia de un
-- grant directo sino del grant por defecto a PUBLIC, asi que revocar el rol
-- dejo el de PUBLIC intacto. Lo arregla 20260906013349_retenciones_helpers_permisos.
REVOKE EXECUTE ON FUNCTION public._fn_base_retencion_venta(numeric, numeric, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public._fn_iva_venta(numeric, numeric, numeric, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public._fn_base_retencion_ot(text, numeric, numeric, numeric, numeric) FROM anon;
