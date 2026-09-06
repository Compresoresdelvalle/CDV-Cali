-- El cierre resta las retenciones donde lee el total de una venta de contado.
--
-- SEIS sitios, no dos: ingreso general (1), desglose por sede (2), por metodo
-- de pago (3), por sede y metodo (4), por cuenta bancaria (5) y arqueo de
-- efectivo esperado (6). Tienen que cambiar TODOS a la vez: si se arregla el
-- total y no el desglose, la suma de las sedes deja de dar el total del dia y
-- ese descuadre es peor que el original, porque nadie sabe cual creer.
--
-- El sexto es el mas delicado: es la plata que la vendedora debe tener en el
-- cajon. Sin el, el arqueo daria faltante todos los dias.
--
-- Lo que NO cambia, y es deliberado:
--   * cobros de pagos_cuenta, abonos de OT y abonos_cotizacion: ya son plata
--     real que entro por caja. El cliente que retiene abona el neto, asi que la
--     retencion ya esta descontada. Restarla otra vez seria contarla dos veces.
--   * ventas Mixto en los desgloses 3, 4, 5 y 6: esos sitios excluyen 'Mixto' y
--     leen pagos_venta. fn_registrar_venta garantiza que esos pagos sumen el
--     NETO, asi que ya vienen bien.
--   * por_producto: reparte el ingreso entre los items de detalle_venta. Una
--     retencion no es atribuible a un producto y ese bloque no alimenta ningun
--     total. Restarle algo seria inventar una reparticion.
--   * compras: fase 2.
--
-- Se hace por reemplazo sobre la definicion vigente y no reescribiendo la
-- funcion entera (22.000 caracteres, 12 sumas de dinero) a proposito: asi es
-- imposible alterar sin querer una linea que no toca. Cada reemplazo lleva su
-- assert de que aparece EXACTAMENTE una vez; si el origen cambia, la migracion
-- falla en vez de producir algo distinto en silencio.
--
-- Verificado: el cierre de los ultimos 90 dias queda identico byte a byte (los
-- seis md5 de los desgloses y las cinco cifras coinciden), porque ninguna venta
-- existente tiene retencion.
DO $mig$
DECLARE
  v_src text;
  v_n   int;
  v_pares text[][] := ARRAY[
    -- 1. ingreso general de productos
    ARRAY[
      'coalesce((select sum(total) from ventas',
      'coalesce((select sum(total - coalesce(retenciones_total,0)) from ventas'
    ],
    -- 2. desglose por sede
    ARRAY[
      'coalesce((select sum(v.total) from ventas v where v.sede_id=se.id and v.anulada=false and v.origen=''directa'' and v.metodo_pago<>''Crédito''',
      'coalesce((select sum(v.total - coalesce(v.retenciones_total,0)) from ventas v where v.sede_id=se.id and v.anulada=false and v.origen=''directa'' and v.metodo_pago<>''Crédito'''
    ],
    -- 3. desglose por metodo de pago
    ARRAY[
      'select v.metodo_pago as metodo, v.total as productos, 0::numeric as servicios from ventas v',
      'select v.metodo_pago as metodo, v.total - coalesce(v.retenciones_total,0) as productos, 0::numeric as servicios from ventas v'
    ],
    -- 4. desglose por sede y metodo
    ARRAY[
      'select v.sede_id as sede_id, lower(v.metodo_pago) as metodo, v.total as ingresos, 0::numeric as egresos from ventas v',
      'select v.sede_id as sede_id, lower(v.metodo_pago) as metodo, v.total - coalesce(v.retenciones_total,0) as ingresos, 0::numeric as egresos from ventas v'
    ],
    -- 5. desglose por cuenta bancaria
    ARRAY[
      'select v.sede_id, nullif(trim(v.cuenta_bancaria),'''') as cuenta, v.total as ingresos, 0::numeric as egresos from ventas v',
      'select v.sede_id, nullif(trim(v.cuenta_bancaria),'''') as cuenta, v.total - coalesce(v.retenciones_total,0) as ingresos, 0::numeric as egresos from ventas v'
    ],
    -- 6. arqueo de efectivo esperado
    ARRAY[
      'coalesce((select sum(v.total) from ventas v where v.sede_id=se.id and v.anulada=false and v.origen=''directa'' and lower(v.metodo_pago)=''efectivo''',
      'coalesce((select sum(v.total - coalesce(v.retenciones_total,0)) from ventas v where v.sede_id=se.id and v.anulada=false and v.origen=''directa'' and lower(v.metodo_pago)=''efectivo'''
    ]
  ];
  v_i int;
BEGIN
  v_src := pg_get_functiondef('public._fn_cierre_totales(date,date,text)'::regprocedure);

  IF position('retenciones_total' in v_src) > 0 THEN
    RAISE EXCEPTION 'la funcion ya menciona retenciones_total: no se aplica dos veces';
  END IF;

  FOR v_i IN 1 .. array_length(v_pares, 1) LOOP
    v_n := (length(v_src) - length(replace(v_src, v_pares[v_i][1], '')))
           / length(v_pares[v_i][1]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'el sitio % aparece % veces (esperado 1): %', v_i, v_n, left(v_pares[v_i][1], 70);
    END IF;
    v_src := replace(v_src, v_pares[v_i][1], v_pares[v_i][2]);
  END LOOP;

  v_n := (length(v_src) - length(replace(v_src, 'retenciones_total', '')))
         / length('retenciones_total');
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'quedaron % menciones de retenciones_total (esperado 6)', v_n;
  END IF;

  EXECUTE v_src;
END
$mig$;
