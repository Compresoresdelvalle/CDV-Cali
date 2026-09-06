-- ============================================================================
-- Corrección: devolución #38 / cambio de la venta #1853 (sede CV, 31/08/2026)
-- Fecha de la corrección: 2026-09-05
--
-- ✔ YA APLICADO EN PRODUCCIÓN el 2026-09-05. Queda como registro de lo que se
--   hizo. Resultado verificado: FM3/4 en CV = 13, FM1RF = 2, venta #1880 y
--   devolución #38 anuladas, venta #2036 (total $0) y devolución #43 (2 u.) en
--   su lugar, y caja menor #832 por $5.490. El efectivo de CV del 31/08 bajó de
--   $5.231.990 a $5.151.990, o sea exactamente los $80.000 que sobraban.
--
-- ⚠ REQUIERE haber aplicado primero la migración
--    supabase/migrations/20260905235500_anular_cambio_de_producto.sql
--   Sin ella no existe fn_anular_cambio, y además fn_registrar_devolucion
--   seguiría contando la devolución #38 anulada contra el tope de "ya
--   devuelto", así que el paso 2 fallaría con "Cantidad excede lo vendido".
--
-- QUÉ PASÓ
--   Venta #1853 (31/08): 2 u. FM3/4 "FILTRO 3/4 METÁLICO" a $80.000 = $160.000
--   efectivo. La clienta volvió y cambió el producto: entregó las 2 unidades y
--   se llevó 2 u. de FM1RF 'FILTRO 1" ROSCA FINA METÁLICO'.
--
--   El cambio se registró mal: quedó como "devuelve 1 u." en vez de 2. Por eso
--   la app le acreditó solo $80.000 y generó la venta #1880 cobrando $80.000
--   de diferencia, plata que nadie entregó (el cambio era parejo, $0).
--
-- CONSECUENCIAS
--   - Inventario: FM3/4 en CV quedó en 12; debería ser 13 (falta 1 u.).
--     FM1RF en CV = 2, correcto.
--   - Caja del 31/08: el sistema quedó con $80.000 de ingreso en efectivo que
--     no existió. Es parte del sobrante de $85.490 que dio el arqueo de ese día.
--
-- NOTA: el cierre del 31/08 todavía NO está hecho (el último es el #42, del
--   01/09), así que estas correcciones entran solas cuando lo cierren.
--
-- ALTERNATIVA SIN SQL: con la migración aplicada, los pasos 1 y 2 se pueden
--   hacer desde la app — abrir la venta #1880, botón "Anular cambio", y luego
--   en la venta #1853 "Registrar cambio" con 2 devueltas, 2 entregadas y precio
--   acordado $80.000. La única diferencia es que los registros nuevos quedan
--   fechados hoy en vez del 31/08 (no mueve plata: el cambio corregido vale $0).
--   Este script además los fecha como corresponde.
-- ============================================================================

DO $$
DECLARE
  -- Identificadores reales (verificados en producción el 2026-09-05)
  k_venta_orig   uuid := '95ad3bd6-97c5-4ee1-8858-20b3315f217b'; -- venta #1853
  k_venta_cambio uuid := '40931cdd-ed31-4ea0-881e-b0a3dc9ae4ee'; -- venta #1880
  k_fm34         uuid := '6154498b-61af-498c-a2bc-be1b82d3cb4e'; -- FM3/4
  k_fm1rf        uuid := '230f29c2-6f30-4bbd-acc6-32e47608c05b'; -- FM1RF
  k_deyanira     uuid := '07765b25-ab57-4ebf-b1af-33996ab149f4'; -- vendedora CV
  k_fecha_orig   timestamptz := '2026-08-31 21:43:51.253779+00';

  v_res     jsonb;
  v_venta_n uuid;
  v_dev_n   uuid;
  v_caja    jsonb;
BEGIN
  -- Las RPC corren SECURITY DEFINER pero validan rol con auth.uid(); se simula
  -- la sesión del Admin, que es el único que puede anular.
  PERFORM set_config('request.jwt.claims',
                     '{"sub":"8742975c-d3ef-44b7-94ce-372eafbc943b","role":"authenticated"}',
                     true);

  -- ---------------------------------------------------------------- PASO 1 --
  -- Anular el cambio completo: la venta #1880 y la devolución #38 a la vez.
  -- Efecto en stock CV: FM1RF 2 -> 4 (vuelve lo entregado), FM3/4 12 -> 11.
  v_res := fn_anular_cambio(
    k_venta_cambio,
    'Cambio mal registrado: la clienta devolvió 2 u. de FM3/4, no 1, y el cambio era parejo (sin diferencia a cobrar). Se rehace.'
  );
  RAISE NOTICE 'fn_anular_cambio -> %', v_res;

  -- ---------------------------------------------------------------- PASO 2 --
  -- Rehacer el cambio como fue de verdad: devuelve 2, se lleva 2, al mismo
  -- precio de $80.000 -> diferencia $0, no entra ni sale plata.
  -- Efecto en stock CV: FM3/4 11 -> 13, FM1RF 4 -> 2. (Estado final correcto.)
  v_res := fn_registrar_cambio(
    k_venta_orig,
    k_fm34,  2,
    k_fm1rf, 2,
    'CV', 'Efectivo', NULL, 'Cambio de producto',
    80000                       -- precio acordado, el mismo de la venta original
  );
  RAISE NOTICE 'fn_registrar_cambio -> %', v_res;

  IF (v_res->>'diferencia_con_iva')::numeric <> 0 THEN
    RAISE EXCEPTION 'El cambio rehecho quedó con diferencia % (debía ser 0). Se aborta.',
      v_res->>'diferencia_con_iva';
  END IF;

  v_venta_n := (v_res->>'venta_nueva_id')::uuid;
  v_dev_n   := (v_res->'devolucion'->>'devolucion_id')::uuid;

  -- La operación ocurrió el 31/08 y la hizo Deyanira; se deja el registro fiel
  -- (el Admin solo ejecutó la corrección, que queda en las observaciones).
  UPDATE ventas
     SET fecha         = k_fecha_orig,
         vendedor_id   = k_deyanira,
         observaciones = observaciones
           || ' · Corrige la venta #1880 y la devolución #38, anuladas el 2026-09-05.'
   WHERE id = v_venta_n;

  UPDATE devoluciones
     SET fecha          = k_fecha_orig,
         registrado_por = k_deyanira,
         observaciones  = 'Reemplaza la devolución #38, anulada el 2026-09-05 '
                       || '(se había registrado 1 u. en vez de 2).'
   WHERE id = v_dev_n;

  -- ---------------------------------------------------------------- PASO 3 --
  -- Arqueo del 31/08: el sistema tenía $85.490 de más. Los $80.000 los acaba de
  -- soltar el paso 1 (la venta #1880 ya no suma). Queda un resto de $5.490 que
  -- se saca como egreso de caja menor para que el día cuadre.
  v_caja := fn_registrar_caja_menor(
    'CV',
    'Ajuste de arqueo 31/08',
    5490,
    'Ajuste de caja',
    'Sobrante del sistema en el arqueo del 31/08 por $85.490. $80.000 se '
      || 'corrigieron al rehacer el cambio de la venta #1853 (devolución #38 '
      || 'y venta #1880, anuladas); este es el resto.',
    'Efectivo', NULL
  );
  RAISE NOTICE 'caja menor -> %', v_caja;

  -- La compra nace con fecha de hoy; se fecha en el día del arqueo.
  PERFORM set_config('cdv.compra_admin', 'on', true);
  UPDATE compras SET fecha = '2026-08-31 18:00:00-05'
   WHERE id = (v_caja->>'compra_id')::uuid;
  PERFORM set_config('cdv.compra_admin', 'off', true);
END $$;

-- ============================================================================
-- VERIFICACIÓN (correr después; esperado: FM3/4 CV = 13, FM1RF CV = 2)
-- ============================================================================
SELECT p.referencia, i.cantidad
  FROM inventario i JOIN productos p ON p.id = i.producto_id
 WHERE i.sede_id = 'CV' AND p.referencia IN ('FM3/4','FM1RF');

SELECT numero, fecha, total, anulada, observaciones
  FROM ventas
 WHERE id = '40931cdd-ed31-4ea0-881e-b0a3dc9ae4ee'
    OR cambio_de_venta_id = '95ad3bd6-97c5-4ee1-8858-20b3315f217b'
 ORDER BY numero;

SELECT numero, fecha, cantidad, estado, motivo, observaciones
  FROM devoluciones
 WHERE venta_id = '95ad3bd6-97c5-4ee1-8858-20b3315f217b'
 ORDER BY numero;
