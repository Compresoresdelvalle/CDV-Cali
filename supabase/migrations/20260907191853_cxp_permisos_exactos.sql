-- Al recrear la vista, el default ACL del esquema public le regala permisos a
-- `anon`, que antes NO tenia ninguno. La vista no lleva security_invoker, asi
-- que corre con los derechos del dueno y se salta la RLS de compras: un select
-- con la anon key habria expuesto toda la deuda con proveedores.
--
-- Se reponen los permisos EXACTOS que tenia antes del drop, ni uno mas.
revoke all on public.v_cuentas_por_pagar from anon;
revoke truncate on public.v_cuentas_por_pagar from authenticated;
