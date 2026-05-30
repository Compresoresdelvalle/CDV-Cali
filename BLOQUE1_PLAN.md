# Bloque 1 — Permisos y roles (plan de ejecución)

Rama: `fix/correcciones-post-deploy`. Migraciones vía MCP con respaldo. Probar con productos `INVENTARIO DE PRUEBA` antes de cerrar.

## Decisiones (confirmadas con el usuario)

- **#4** Crear/editar/eliminar productos = **solo Admin**.
- **#6** Vendedor **crea y gestiona** OT y traslados.
- **#5** Cancelar traspaso = **solo Admin**, **solo si está pendiente** (no recibido), **revirtiendo el stock** que salió de la sede origen.
- **#3** Vendedor ve **sus** ventas (de cualquier sede) **+** las de su sede; ve **todo** el inventario; **vende de cualquier sede**.

## Cambios backend (RLS + funciones) — una migración aditiva/reversible

### #3 Inventario global + vender de cualquier sede

- `inv_select` → `USING (true)` para authenticated (ver todas las sedes). `inv_modify_block` (solo Admin) se mantiene.
- `fn_registrar_venta` (SECURITY DEFINER): **quitar** el bloque `IF v_mi_rol <> 'Admin' AND v_mi_sede <> p_sede_id THEN RAISE`. (Recrear con CREATE OR REPLACE; cuerpo ya conocido.)
- `ventas_insert` with_check → `get_my_rol() IN ('Admin','Vendedor')` (quitar match de sede).
- `ventas_select` → `Admin OR vendedor_id = auth.uid() OR sede_id = get_my_sede_id()`.
- `detalle_venta` `dv_select`/`dv_write` → añadir `v.vendedor_id = auth.uid()` a la condición (para que vea/escriba su venta aunque sea de otra sede).

### #4 Productos solo Admin

- `prod_modify` (hoy Admin+Bodeguero) → **solo Admin** (cubre INSERT/UPDATE/DELETE).
- Revisar `fn_crear_producto` (gate de rol) → restringir a Admin. (Leer cuerpo.)
- Frontend: ocultar botones crear/editar/eliminar producto a no-Admin; RoleGuard en rutas `productos/nuevo`, `productos/:id` (edición).

### #6 Vendedor en OT y Traslados

- `os_insert` with_check → añadir `'Vendedor'` al ARRAY de roles permitidos.
- `fn_crear_traspaso` (gate de rol) → añadir Vendedor. (Leer cuerpo para ver el gate actual.)
- Frontend `ROLE_MODULES.Vendedor` → añadir `"Traspasos"` y `"Órdenes"`. RoleGuard de esas rutas → incluir Vendedor.
- Revisar `os_update` / gestión de OT por vendedor (hoy Admin/tecnico_id). Definir si el vendedor creador puede editar.

### #5 Cancelar traspaso (NUEVO) — solo Admin, solo pendiente

- **Leer primero**: `fn_crear_traspaso`, `fn_procesar_traspaso`, enum `estado` de traspasos, triggers `trg_traspaso_salida`/`trg_traspaso_entrada` (para saber cuándo sale el stock del origen).
- Crear `fn_cancelar_traspaso(p_traspaso_id)` SECURITY DEFINER:
  - Validar `get_my_rol() = 'Admin'`.
  - Validar estado = pendiente/en-transito-no-recibido.
  - Revertir stock al origen (si ya salió) y marcar estado `cancelado`.
- Frontend: botón "Cancelar traspaso" en `TraspasoDetalle.jsx`, visible solo a Admin, solo si pendiente.

## Orden sugerido

1. Migración RLS para #3, #4, #6 (sin la función de cancelar) → aplicar → probar.
2. Función + UI de cancelar traspaso (#5) → aplicar → probar.
3. Frontend permisos (menú, RoleGuard, ocultar botones).
4. Commit del bloque.

## Pendiente de leer al implementar

`fn_crear_traspaso`, `fn_procesar_traspaso`, `fn_crear_producto`, esquema/flujo de traspasos y OT.
