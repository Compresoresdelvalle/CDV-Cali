-- A3 [P2] Revocar EXECUTE de PUBLIC/anon en 4 RPC de dinero/stock.
-- Tienen guard interno de auth.uid() (sin explotacion conocida), pero no deben ser
-- ejecutables por anon/PUBLIC. Se conserva authenticated y service_role.
REVOKE EXECUTE ON FUNCTION public.fn_aplicar_nota_credito(p_nota_id uuid, p_compra_id uuid, p_monto numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_crear_herramienta_desde_insumo(p_producto_id uuid, p_sede_id text, p_cantidad integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_recibir_compra(p_compra_id uuid, p_recepciones jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_registrar_caja_menor(p_sede_id text, p_concepto text, p_monto numeric, p_proveedor text, p_observaciones text, p_metodo_pago text, p_cuenta_bancaria text) FROM PUBLIC, anon;
