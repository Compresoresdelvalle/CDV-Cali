-- La política de lectura de pagos_cuenta solo tenía rama para venta_id, así que
-- un Bodeguero podía REGISTRAR un pago a proveedor (la RPC es SECURITY DEFINER)
-- y después no verlo: la lista del modal salía vacía y el saldo seguía mostrando
-- la deuda completa. Riesgo real de pagar dos veces la misma factura.
--
-- Se añade la rama de compra_id, con el mismo criterio que compras_select:
-- la compra debe llegar a su sede.
--
-- NOTA: este cambio se aplicó a producción el 2026-08-26 pero el archivo se
-- quedó sin escribir; lo detectó la revisión posterior comparando
-- schema_migrations con el repo. Sin este archivo, reconstruir la base desde
-- las migraciones habría reintroducido el fallo en silencio.

DROP POLICY IF EXISTS pagos_cuenta_read ON public.pagos_cuenta;
CREATE POLICY pagos_cuenta_read ON public.pagos_cuenta
  FOR SELECT TO authenticated
  USING (
    (SELECT get_my_rol()) = 'Admin'
    OR (
      venta_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM ventas v
         WHERE v.id = pagos_cuenta.venta_id
           AND v.sede_id = (SELECT get_my_sede_id())
      )
    )
    OR (
      compra_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM compras c
         WHERE c.id = pagos_cuenta.compra_id
           AND c.sede_destino_id = (SELECT get_my_sede_id())
      )
    )
  );
