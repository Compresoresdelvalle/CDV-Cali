-- Una retencion no puede superar el total de la factura.
--
-- Los tres porcentajes se recortan cada uno a [0,100], pero nada impedia que la
-- SUMA se pasara. Con retefuente 100% y reteICA 100% sobre una factura de
-- 1.190.000 la retencion daba 2.000.000, y el cierre veia un egreso de
-- -810.000: la compra aparecia como un INGRESO, en silencio.
--
-- Hace falta dedos gordos para llegar ahi, pero la consecuencia es plata
-- inventada en el cierre, y esta es la unica puerta de entrada.
-- fn_recibir_compra solo baja el subtotal, y como las columnas son generadas la
-- retencion baja en la misma proporcion: por ahi no puede volverse negativa.
--
-- El mensaje dice la causa y la salida, como el resto de los bloqueos de la
-- app: no basta con negarse. Y BloqueRetenciones avisa lo mismo en pantalla
-- antes de que el operador pulse un boton que iba a fallar igual.
--
-- OJO: `ventas` tiene el mismo hueco desde la fase 1 y este archivo NO lo toca.
-- Queda reportado aparte porque esa parte ya esta desplegada y en uso.
do $mig$
declare
  v_def text;
  v_new text;
  v_a1 text := '  v_riva       numeric;' || chr(10);
  v_a2 text := '  v_total := round((v_subtotal - v_desc) + v_iva);' || chr(10);
begin
  select pg_get_functiondef(oid) into v_def
    from pg_proc where proname='fn_registrar_compra' and pronamespace='public'::regnamespace;

  if (length(v_def) - length(replace(v_def, v_a1, ''))) / length(v_a1) <> 1
     or (length(v_def) - length(replace(v_def, v_a2, ''))) / length(v_a2) <> 1 then
    raise exception 'Las anclas no aparecen exactamente una vez en fn_registrar_compra';
  end if;

  v_new := replace(v_def, v_a1, v_a1 || '  v_ret        numeric;' || chr(10));
  v_new := replace(v_new, v_a2, v_a2 || $ins$
  -- Las retenciones no pueden pasarse del total: si se pasaran, el cierre
  -- registraria la compra como un INGRESO.
  v_ret := round(greatest(0, v_subtotal - v_desc) * v_rf / 100)
         + round(greatest(0, v_subtotal - v_desc) * v_ri / 100)
         + round(v_iva * v_riva / 100);
  if v_ret > v_total then
    raise exception 'Las retenciones suman % y el total de la factura es %. Revisa los porcentajes: retefuente y reteICA van sobre la base (subtotal menos descuento) y reteIVA sobre el IVA. Si querias 2,5%% escribe 2,5, no 25.', v_ret, v_total;
  end if;
$ins$);

  execute v_new;
end
$mig$;
