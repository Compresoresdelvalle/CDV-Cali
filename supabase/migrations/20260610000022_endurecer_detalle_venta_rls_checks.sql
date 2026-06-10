-- ALTO (auditoría 2026-06-09): la política dv_write (ALL) permitía a un Vendedor
-- hacer UPDATE/DELETE directo por REST sobre las líneas de SU venta. Como NO hay
-- trigger de stock en UPDATE/DELETE de detalle_venta (solo AFTER INSERT descuenta;
-- el DELETE recalcula el total pero NO restaura stock; el UPDATE ni recalcula el
-- total), un vendedor podía borrar líneas (perdiendo stock y bajando el total) o
-- editar precio_unitario/subtotal/cantidad para manipular registros. Además
-- dv_insert solo verificaba el ROL (no el dueño de la venta), permitiendo inyectar
-- líneas en ventas ajenas.
--
-- TODAS las escrituras legítimas de detalle_venta ocurren dentro de funciones
-- SECURITY DEFINER (fn_registrar_venta, fn_convertir_cotizacion) propiedad de
-- `postgres` (BYPASSRLS, RLS no forzado en la tabla), que NO dependen de estas
-- políticas. El frontend solo LEE detalle_venta (joins de VentaDetalle/Historial/
-- Top10). Por tanto:
--   * Quitar dv_write y dv_insert (escritura directa por `authenticated`).
--   * Conservar dv_select (lectura). => toda escritura directa queda denegada;
--     las correcciones van por anulación (fn_anular_venta) o devolución.
--   * Añadir CHECKs de no-negatividad como defensa en profundidad.

drop policy if exists dv_write  on public.detalle_venta;
drop policy if exists dv_insert on public.detalle_venta;

alter table public.detalle_venta
  add constraint detalle_venta_precio_unitario_nonneg check (precio_unitario >= 0),
  add constraint detalle_venta_subtotal_nonneg        check (subtotal >= 0),
  add constraint detalle_venta_costo_unitario_nonneg  check (costo_unitario >= 0),
  add constraint detalle_venta_precio_catalogo_nonneg check (precio_catalogo is null or precio_catalogo >= 0);
