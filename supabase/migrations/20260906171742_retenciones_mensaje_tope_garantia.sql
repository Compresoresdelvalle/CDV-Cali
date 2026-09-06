-- El tope de la garantia ya mide contra lo que el cliente entrego, pero el
-- mensaje seguia diciendo "el total original" mientras mostraba el neto. A quien
-- atiende le quedaba un numero que no cuadra con la factura que tiene enfrente.
DO $mig$
DECLARE v_src text; v_n int;
BEGIN
  v_src := pg_get_functiondef('public.fn_abrir_garantia_venta(jsonb)'::regprocedure);

  v_n := (length(v_src) - length(replace(v_src, 'no puede superar el total original', '')))
         / length('no puede superar el total original');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'el mensaje aparece % veces (esperado 1)', v_n;
  END IF;

  v_src := replace(v_src,
    'no puede superar el total original',
    'no puede superar lo que el cliente entrego');

  EXECUTE v_src;
END
$mig$;
