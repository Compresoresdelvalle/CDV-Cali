-- Revisión integral (2026-10-17), hallazgo previo a ese día:
-- 1. Aplicar una nota crédito del proveedor a una compra registra un pago con
--    metodo_pago = 'Nota crédito'. No sale plata de ninguna caja, pero el
--    cierre lo contaba como egreso. Se excluye en los 6 sitios de pagos.
-- 2. fn_aplicar_nota_credito calculaba el saldo de la compra sin restar las
--    retenciones (v_cuentas_por_pagar sí las resta), así que podía aplicar más
--    de lo que se debe.
-- Hasta hoy no hay ninguna nota crédito aplicada: ningún cierre cambia.

create or replace function pg_temp._rep_n(p_fn regprocedure, p_old text, p_new text, p_n int)
returns void language plpgsql as $$
declare v_def text; v_n int;
begin
  v_def := pg_get_functiondef(p_fn);
  v_n := (length(v_def) - length(replace(v_def, p_old, ''))) / greatest(length(p_old), 1);
  if v_n <> p_n then
    raise exception '%: se esperaban % coincidencias de [%] y hay %', p_fn, p_n, left(p_old, 80), v_n;
  end if;
  execute replace(v_def, p_old, p_new);
end $$;

select pg_temp._rep_n('public._fn_cierre_totales(date,date,text)'::regprocedure,
  $q$pc.tipo='pago' and coalesce(pc.anulado,false)=false$q$,
  $q$pc.tipo='pago' and coalesce(pc.anulado,false)=false and pc.metodo_pago is distinct from 'Nota crédito'$q$,
  6);

select pg_temp._rep_n('public.fn_aplicar_nota_credito(uuid,uuid,numeric)'::regprocedure,
  $q$  v_saldo_compra := COALESCE(v_compra.total,0) - v_pagos;$q$,
  $q$  v_saldo_compra := COALESCE(v_compra.total,0) - COALESCE(v_compra.retenciones_total,0) - v_pagos;$q$,
  1);

notify pgrst, 'reload schema';
