-- Paso 1a — RLS-01 (CRÍTICA): vistas de cartera con security_invoker + REVOKE anon
--
-- Problema: v_cuentas_por_cobrar y v_cuentas_por_pagar corrían como SECURITY DEFINER
-- (owner postgres, sin security_invoker) y tenían SELECT concedido a `anon`. Eso permitía
-- volcar la cartera de las 4 sedes (montos, saldos, clientes, proveedores) a cualquier
-- usuario autenticado —saltando el aislamiento por sede— e incluso a anónimos con la
-- publishable key del bundle. Regresión introducida en 20260610000041 (create or replace
-- view sin el flag, que existía desde 20260609000006).
--
-- Fix: forzar security_invoker=true en ambas vistas. Así heredan el RLS de `ventas`
-- (ventas_select: Admin OR sede_id = get_my_sede_id()) y `compras` (compras_select:
-- Admin OR sede_destino_id = get_my_sede_id()): el Admin sigue viendo las 4 sedes y los
-- demás roles quedan acotados a su sede. Además se revoca todo acceso a `anon`.
-- No se reescribe el cuerpo de las vistas: el aislamiento ya lo aporta el RLS subyacente.

alter view public.v_cuentas_por_cobrar set (security_invoker = true);
alter view public.v_cuentas_por_pagar  set (security_invoker = true);

revoke all on public.v_cuentas_por_cobrar from anon;
revoke all on public.v_cuentas_por_pagar  from anon;
