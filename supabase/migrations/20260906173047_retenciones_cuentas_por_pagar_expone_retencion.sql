-- v_cuentas_por_pagar expone retenciones_total para que las dos vistas de
-- cuentas tengan la misma forma. Hoy siempre vale 0 (las retenciones de compras
-- son fase 2), asi que ningun saldo cambia.
--
-- Sirve para que el frontend pueda leer la columna sin preguntar en cual de las
-- dos vistas esta parado: sin esto, Cuentas.jsx tendria que pedir columnas
-- distintas segun la pestana, y ese tipo de bifurcacion es justo donde se cuelan
-- los errores cuando llegue la fase 2.
--
-- El saldo NO se toca aqui: fn_registrar_pago_cuenta ya resta
-- compras.retenciones_total, y cuando la fase 2 empiece a llenarla habra que
-- restarla tambien en esta vista, en la misma migracion.
--
-- Verificado: 37 cuentas por 66.887.210 antes y despues, identico.
CREATE OR REPLACE VIEW public.v_cuentas_por_pagar
WITH (security_invoker = true) AS
 SELECT c.id AS compra_id,
    c.numero,
    c.fecha,
    c.proveedor,
    c.sede_destino_id,
    c.estado,
    COALESCE(c.total, 0::numeric) AS total,
    COALESCE(pc.pagos, 0::numeric) AS pagos,
    COALESCE(c.total, 0::numeric) - COALESCE(pc.pagos, 0::numeric) AS saldo,
    COALESCE(c.retenciones_total, 0::numeric) AS retenciones_total
   FROM compras c
     LEFT JOIN LATERAL ( SELECT sum(p.monto) AS pagos
           FROM pagos_cuenta p
          WHERE p.compra_id = c.id AND p.tipo = 'pago'::text AND COALESCE(p.anulado, false) = false) pc ON true
  WHERE c.metodo_pago = 'Crédito'::text AND c.estado <> 'cancelada'::estado_compra;
