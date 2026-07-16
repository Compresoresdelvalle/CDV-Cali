-- S6-B + S6-07: blindaje de escritura directa
-- anon: sin escritura en ninguna tabla de compras
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.compras, public.detalle_compra,
  public.garantias_compra, public.detalle_garantia_compra,
  public.notas_credito_proveedor, public.productos_proveedores FROM anon;

-- authenticated: garantías y notas crédito solo por RPC SECURITY DEFINER
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.garantias_compra,
  public.detalle_garantia_compra, public.notas_credito_proveedor FROM authenticated;

-- authenticated en compras/detalle_compra: solo TRUNCATE por ahora
-- (el UPDATE directo de compras.recibida sigue vivo hasta que el frontend migre a fn_recibir_compra)
REVOKE TRUNCATE ON public.compras, public.detalle_compra FROM authenticated;
