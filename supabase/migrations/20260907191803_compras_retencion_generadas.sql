-- Fase 2 de retenciones: blindar los sumandos, no solo la suma.
--
-- En `ventas` las tres columnas de valor son generadas desde el porcentaje y la
-- base, asi que nadie puede escribir un valor que no corresponda. En `compras`
-- eran columnas normales y solo `retenciones_total` era generada: la suma
-- protegida y los sumandos no. Un UPDATE del subtotal dejaba el valor de la
-- retencion pegado al subtotal viejo, y ese desfase es invisible hasta el
-- cierre.
--
-- Sale mas simple que en ventas: compras no tiene domicilio ni descuento
-- porcentual (solo `descuento_valor`) y el IVA es columna guardada, no algo que
-- haya que recalcular.
--
-- Las cuatro columnas valen 0 en las 742 filas, verificado antes de correr
-- esto, asi que recrearlas no toca ningun dato.
--
-- Una columna generada no puede referirse a otra generada, por eso
-- `retenciones_total` repite las tres expresiones en vez de sumar las columnas.
-- Cada una se redondea por separado y despues se suman, igual que en `ventas` y
-- que en `src/lib/retenciones.js`; redondear la suma daria un peso de
-- diferencia entre lo que la pantalla promete y lo que la base guarda.
--
-- v_cuentas_por_pagar depende de retenciones_total, asi que hay que bajarla y
-- reponerla. Se aprovecha para arreglar de una vez el hueco que fase 1 dejo
-- partido (ver abajo), en lugar de recrear la misma vista dos veces.

drop view if exists v_cuentas_por_pagar;

alter table compras drop column if exists retenciones_total;
alter table compras drop column if exists retefuente_valor;
alter table compras drop column if exists reteica_valor;
alter table compras drop column if exists reteiva_valor;

alter table compras
  add column retefuente_valor numeric
    generated always as (
      round(greatest(0, coalesce(subtotal, 0) - coalesce(descuento_valor, 0))
            * coalesce(retefuente_pct, 0) / 100)
    ) stored,
  add column reteica_valor numeric
    generated always as (
      round(greatest(0, coalesce(subtotal, 0) - coalesce(descuento_valor, 0))
            * coalesce(reteica_pct, 0) / 100)
    ) stored,
  add column reteiva_valor numeric
    generated always as (
      round(coalesce(iva, 0) * coalesce(reteiva_pct, 0) / 100)
    ) stored;

alter table compras
  add column retenciones_total numeric
    generated always as (
      round(greatest(0, coalesce(subtotal, 0) - coalesce(descuento_valor, 0))
            * coalesce(retefuente_pct, 0) / 100)
    + round(greatest(0, coalesce(subtotal, 0) - coalesce(descuento_valor, 0))
            * coalesce(reteica_pct, 0) / 100)
    + round(coalesce(iva, 0) * coalesce(reteiva_pct, 0) / 100)
    ) stored;

comment on column compras.retenciones_total is
  'Lo que la empresa le retiene al proveedor y consigna a la DIAN. Se resta de lo que sale del cajon (cierre) y del saldo por pagar, NUNCA del gasto: una retencion no abarata la mercancia.';

-- El saldo por pagar nace neto de la retencion, igual que el saldo por cobrar.
--
-- Fase 1 dejo esto partido: v_cuentas_por_cobrar.saldo restaba retenciones_total
-- pero v_cuentas_por_pagar.saldo no, mientras que fn_registrar_pago_cuenta SI la
-- resta en su rama de pago. Con una retencion real la pantalla mostraria un
-- saldo de un millon y el servidor rechazaria cualquier pago mayor a
-- novecientos cincuenta mil, con un mensaje que contradice lo que la misma
-- pantalla acaba de mostrar. La compra jamas llegaria a "pagada".
--
-- Se resta aqui y NO en el camino de pagos_cuenta. Restarla en los dos seria
-- restarla dos veces: el saldo ya nace neto, asi que el pago que se registra
-- contra el ya es plata real.

-- OJO: recrear una vista NO conserva sus reloptions. security_invoker viene
-- desde 20260613000001 y sin el la vista corre con los derechos del dueno y se
-- salta la RLS de compras: cualquier usuario autenticado veria la deuda con
-- proveedores de TODAS las sedes. Hay que repetirlo aqui.
create view v_cuentas_por_pagar
with (security_invoker = true) as
 select c.id as compra_id,
    c.numero,
    c.fecha,
    c.proveedor,
    c.sede_destino_id,
    c.estado,
    coalesce(c.total, 0::numeric) as total,
    coalesce(pc.pagos, 0::numeric) as pagos,
    ((coalesce(c.total, 0::numeric) - coalesce(c.retenciones_total, 0::numeric))
      - coalesce(pc.pagos, 0::numeric)) as saldo,
    coalesce(c.retenciones_total, 0::numeric) as retenciones_total
   from compras c
     left join lateral ( select sum(p.monto) as pagos
           from pagos_cuenta p
          where p.compra_id = c.id and p.tipo = 'pago'::text
            and coalesce(p.anulado, false) = false) pc on true
  where c.metodo_pago = 'Crédito'::text and c.estado <> 'cancelada'::estado_compra;

-- Reponer los permisos exactos que tenia antes del drop.
grant all on public.v_cuentas_por_pagar to postgres, authenticated, service_role;
