-- El tope de un reembolso es lo que el cliente ENTREGO, no lo facturado.
--
-- fn_registrar_devolucion_cliente y fn_abrir_garantia_venta comparan el monto a
-- devolver contra `ventas.total`. Antes de las retenciones eso era correcto,
-- porque el total era exactamente lo que el cliente habia pagado. Con retencion
-- ya no: el cliente entrega el neto y el resto lo consigna a la DIAN.
--
-- Comprobado antes de aplicar: sobre una venta de 1.190.000 con 60.400 de
-- retencion, el sistema aceptaba reembolsar los 1.190.000 completos. La empresa
-- devolvia en efectivo 60.400 que nunca recibio, y el cierre lo contaba como
-- egreso por su valor de cara. Un hueco de caja silencioso.
--
-- Se cambia solo el TECHO. El monto lo sigue tecleando quien atiende: esto no
-- calcula nada, solo impide pasarse de lo que de verdad entro.
--
-- Se hace por reemplazo con assert, igual que en el cierre: son funciones
-- largas y reescribirlas a mano es la forma facil de tocar algo que no toca.
DO $mig$
DECLARE
  v_src text;
  v_n   int;
  v_pares text[][] := ARRAY[
    -- fn_registrar_devolucion_cliente: el tope acumulado del grupo
    ARRAY[
      'IF v_ya_reemb + v_monto > coalesce(v_venta.total,0) + 0.01 THEN',
      'IF v_ya_reemb + v_monto > coalesce(v_venta.total,0) - coalesce(v_venta.retenciones_total,0) + 0.01 THEN'
    ]
  ];
  v_i int;
BEGIN
  -- ── fn_registrar_devolucion_cliente ──────────────────────────────────
  v_src := pg_get_functiondef('public.fn_registrar_devolucion_cliente(jsonb)'::regprocedure);
  IF position('retenciones_total' in v_src) > 0 THEN
    RAISE EXCEPTION 'fn_registrar_devolucion_cliente ya conoce la retencion: no se aplica dos veces';
  END IF;

  -- La funcion lee la venta con una lista de columnas explicita: hay que pedir
  -- tambien la retencion o v_venta.retenciones_total seria NULL.
  v_n := (length(v_src) - length(replace(v_src, 'SELECT id, numero, sede_id, total, anulada, orden_id INTO v_venta', '')))
         / length('SELECT id, numero, sede_id, total, anulada, orden_id INTO v_venta');
  IF v_n <> 1 THEN RAISE EXCEPTION 'el SELECT de la venta aparece % veces (esperado 1)', v_n; END IF;
  v_src := replace(v_src,
    'SELECT id, numero, sede_id, total, anulada, orden_id INTO v_venta',
    'SELECT id, numero, sede_id, total, anulada, orden_id, retenciones_total INTO v_venta');

  FOR v_i IN 1 .. array_length(v_pares, 1) LOOP
    v_n := (length(v_src) - length(replace(v_src, v_pares[v_i][1], '')))
           / length(v_pares[v_i][1]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'el tope % aparece % veces (esperado 1)', v_i, v_n;
    END IF;
    v_src := replace(v_src, v_pares[v_i][1], v_pares[v_i][2]);
  END LOOP;

  -- El mensaje de error tiene que decir la verdad: el maximo ya no es el total.
  v_src := replace(v_src,
    'y el total fue $%, asi que como maximo quedan $%.',
    'y el cliente entrego $% (el total fue $% menos $% de retenciones), asi que como maximo quedan $%.');
  v_src := replace(v_src,
    E'        to_char(coalesce(v_venta.total,0), ''FM999G999G999G990''),\n        to_char(greatest(coalesce(v_venta.total,0) - v_ya_reemb, 0), ''FM999G999G999G990'')',
    E'        to_char(coalesce(v_venta.total,0) - coalesce(v_venta.retenciones_total,0), ''FM999G999G999G990''),\n'
    '        to_char(coalesce(v_venta.total,0), ''FM999G999G999G990''),\n'
    '        to_char(coalesce(v_venta.retenciones_total,0), ''FM999G999G999G990''),\n'
    '        to_char(greatest(coalesce(v_venta.total,0) - coalesce(v_venta.retenciones_total,0) - v_ya_reemb, 0), ''FM999G999G999G990'')');

  EXECUTE v_src;

  -- ── fn_abrir_garantia_venta ──────────────────────────────────────────
  v_src := pg_get_functiondef('public.fn_abrir_garantia_venta(jsonb)'::regprocedure);
  IF position('retenciones_total' in v_src) > 0 THEN
    RAISE EXCEPTION 'fn_abrir_garantia_venta ya conoce la retencion: no se aplica dos veces';
  END IF;

  -- v_total_ref es el techo. Para una VENTA pasa a ser el neto; para una OT ya
  -- venia de ordenes_servicio.total, que tambien lleva su retencion.
  v_n := (length(v_src) - length(replace(v_src, 'v_total_ref := v_venta.total;', '')))
         / length('v_total_ref := v_venta.total;');
  IF v_n <> 1 THEN RAISE EXCEPTION 'v_total_ref de venta aparece % veces (esperado 1)', v_n; END IF;
  v_src := replace(v_src, 'v_total_ref := v_venta.total;',
    'v_total_ref := v_venta.total - coalesce(v_venta.retenciones_total, 0);');

  v_n := (length(v_src) - length(replace(v_src, 'v_total_ref := v_orden.total;', '')))
         / length('v_total_ref := v_orden.total;');
  IF v_n <> 1 THEN RAISE EXCEPTION 'v_total_ref de OT aparece % veces (esperado 1)', v_n; END IF;
  v_src := replace(v_src, 'v_total_ref := v_orden.total;',
    'v_total_ref := v_orden.total - coalesce(v_orden.retenciones_total, 0);');

  EXECUTE v_src;
END
$mig$;
