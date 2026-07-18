-- TAREA D (P1): Neutralizar fn_consumir_nota_credito.
-- Esta RPC bajaba el saldo_restante de la nota credito SIN insertar el pago en
-- pagos_cuenta y SIN validar proveedor/compra a credito/saldos: "quemaba" el saldo
-- sin bajar la deuda real. La correcta es fn_aplicar_nota_credito.
-- 0 callers: ni el frontend (solo usa fn_aplicar_nota_credito) ni ninguna otra
-- funcion/trigger la referencian. Se neutraliza (no DROP) para conservar firma y
-- ACL: cualquier llamada residual recibe un error claro que redirige a la correcta.
CREATE OR REPLACE FUNCTION public.fn_consumir_nota_credito(p_nota_id uuid, p_monto numeric, p_compra_id uuid DEFAULT NULL::uuid, p_observaciones text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'fn_consumir_nota_credito esta deshabilitada: quemaba el saldo de la nota sin registrar el pago ni validar proveedor/compra. Usa fn_aplicar_nota_credito(p_nota_id, p_compra_id, p_monto).';
END;
$function$;
