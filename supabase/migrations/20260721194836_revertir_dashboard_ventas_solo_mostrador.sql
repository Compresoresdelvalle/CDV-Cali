-- REVERSIÓN de un cambio propio que resultó equivocado.
--
-- En la Sección 12 incluí las ventas de OT en los KPIs de ventas del Dashboard
-- (origen in ('directa','ot')) para mostrar el "ingreso real". En producción
-- resultó engañoso, y así se detectó:
--
--   "VENTAS HOY" de la sede CV mostraba $1.422.530 =
--       $882.030 de mostrador + $540.500 de la venta #949 (OT 89)
--   ...pero los abonos de esa OT se cobraron el 8 de julio, 13 días antes.
--
-- Es decir: el KPI diario se infla con plata que entró semanas atrás, porque la
-- venta de OT se emite el día de la FACTURACIÓN, no el del cobro. El dinero de
-- una OT se recibe en abonos, y ese es el momento en que entra a caja.
--
-- El motor del cierre (documento autoritativo de caja) siempre lo tuvo bien:
-- cuenta las ventas de mostrador en "productos" y los abonos de OT en
-- "servicios", cada peso una sola vez y en la fecha real del cobro. Al incluir
-- las OT en el Dashboard rompí esa correspondencia entre las dos pantallas.
--
-- Se revierte a origen = 'directa' en los 10 puntos afectados (hoy, ayer,
-- semana, semana_prev, mes, mes_prev, ticket promedio, tendencia_7d,
-- ventas_por_sede y top5_productos). La plata de OT vuelve a verse por
-- `ingresos_servicios_mes`, que es el recaudo real y coincide con el cierre.
--
-- Se conservan las mejoras de la Sección 12: deltas por periodo
-- (ventas_semana_prev / ventas_mes_prev), devoluciones_mes,
-- devoluciones_mes_sin_venta, anticipos_ot_sin_facturar y el ticket promedio
-- sin las ventas en $0.
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO d FROM pg_proc WHERE proname = 'fn_dashboard_kpis';
  d := replace(d, 'origen in (''directa'',''ot'')', 'origen = ''directa''');
  EXECUTE d;
END $$;
