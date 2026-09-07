-- Cierre: una compra de contado saca del cajon el NETO, no el total.
--
-- Seis sitios, no dos como decia el spec de fase 1: total global, por sede, por
-- sede y metodo, por sede y cuenta, detalle de egresos y arqueo esperado. Son
-- los mismos seis que fase 1 toco para ventas. Arreglar unos y olvidar otros
-- deja el cierre contradiciendose a si mismo, con el total diciendo una cosa y
-- el arqueo otra, y la diferencia aparece al cuadrar la caja, cuando ya nadie
-- se acuerda de que compra la causo.
--
-- El camino de pagos_cuenta NO se toca en ninguno de los seis: el saldo por
-- pagar ya nace neto (ver 20260907T1), asi que el pago registrado contra el ya
-- es plata real. Restarla en los dos lados seria restarla dos veces, y ese es
-- el bug que descuadra la caja.
--
-- Tampoco se tocan fn_panel_resultado ni los dashboards. Una retencion no
-- abarata la mercancia: el gasto sigue siendo el total y lo que cambia es a
-- quien se le paga, una parte al proveedor y otra a la DIAN.
--
-- Se hace por sustitucion sobre la definicion viva y no reescribiendo a mano
-- las 150 lineas de la funcion, porque reescribirlas es la forma segura de
-- colar un error en alguna de las otras consultas (las de ventas, garantias,
-- devoluciones y abonos, que aqui no tienen nada que ver). Cada patron se exige
-- EXACTAMENTE una vez y el largo final se compara contra lo esperado: si el
-- cuerpo cambio, esto revienta en vez de aplicar media transformacion.
do $mig$
declare
  v_def text;
  v_new text;
  v_pat text;
  v_pats text[] := array[
    'sum(total) from compras',
    'sum(c.total) from compras c where c.sede_destino_id=se.id',
    'select c.sede_destino_id, lower(c.metodo_pago), 0::numeric, c.total from compras c',
    'select c.sede_destino_id, nullif(trim(c.cuenta_bancaria),''''), 0::numeric, c.total from compras c',
    '''total'', c.total, ''fecha''',
    'then c.total else 0 end)'
  ];
begin
  select pg_get_functiondef(oid) into v_def
    from pg_proc where proname='_fn_cierre_totales' and pronamespace='public'::regnamespace;

  foreach v_pat in array v_pats loop
    if (length(v_def) - length(replace(v_def, v_pat, ''))) / length(v_pat) <> 1 then
      raise exception 'El patron % no aparece exactamente una vez en _fn_cierre_totales', v_pat;
    end if;
  end loop;

  v_new := replace(replace(replace(replace(replace(replace(v_def,
    'sum(total) from compras',
    'sum(total - coalesce(retenciones_total,0)) from compras'),
    'sum(c.total) from compras c where c.sede_destino_id=se.id',
    'sum(c.total - coalesce(c.retenciones_total,0)) from compras c where c.sede_destino_id=se.id'),
    'select c.sede_destino_id, lower(c.metodo_pago), 0::numeric, c.total from compras c',
    'select c.sede_destino_id, lower(c.metodo_pago), 0::numeric, c.total - coalesce(c.retenciones_total,0) from compras c'),
    'select c.sede_destino_id, nullif(trim(c.cuenta_bancaria),''''), 0::numeric, c.total from compras c',
    'select c.sede_destino_id, nullif(trim(c.cuenta_bancaria),''''), 0::numeric, c.total - coalesce(c.retenciones_total,0) from compras c'),
    '''total'', c.total, ''fecha''',
    '''total'', c.total - coalesce(c.retenciones_total,0), ''fecha'''),
    'then c.total else 0 end)',
    'then c.total - coalesce(c.retenciones_total,0) else 0 end)');

  if length(v_new) - length(v_def) <> 202 then
    raise exception 'La sustitucion agrego % caracteres, se esperaban 202', length(v_new) - length(v_def);
  end if;

  execute v_new;
end
$mig$;
