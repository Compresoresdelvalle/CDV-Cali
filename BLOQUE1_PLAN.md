# Bloque 1 — Permisos y roles (plan de ejecución)

Rama: `fix/correcciones-post-deploy`. Migraciones vía MCP con respaldo. Probar con productos `INVENTARIO DE PRUEBA` antes de cerrar.

## Decisiones (confirmadas con el usuario)

- **#4** Crear/editar/eliminar productos = **solo Admin**.
- **#6** Vendedor **crea y gestiona** OT y traslados.
- **#5** Cancelar traspaso = **solo Admin**, **solo si está pendiente** (no recibido), **revirtiendo el stock** que salió de la sede origen.
- **#3** Vendedor ve **todo** el inventario (las 4 sedes), pero **vende SOLO desde su sede**. ⚠️ **CORREGIDO 2026-05-30** (la clienta llamó a corregir): se descartó "vender de cualquier sede". Ver detalle y plan futuro en el bloque #3 de abajo.

## Cambios backend (RLS + funciones) — una migración aditiva/reversible

### #3 Inventario global (VER todo) + vender SOLO desde su sede

**Estado final (tras la corrección de la clienta 2026-05-30):**

- `inv_select` → `USING (true)` para authenticated (ver todas las sedes). `inv_modify_block` (solo Admin) se mantiene. ✅ **Esto SÍ se mantiene** — es la base para el futuro desplegable "Sede".
- `fn_registrar_venta` (SECURITY DEFINER): **conserva** el bloque `IF v_mi_rol <> 'Admin' AND v_mi_sede IS DISTINCT FROM p_sede_id THEN RAISE` (vende solo su sede) + gate de rol Admin/Vendedor.
- `ventas_insert` with_check → `get_my_rol() IN ('Admin','Vendedor') AND (Admin OR sede_id = get_my_sede_id())`.
- `ventas_select` → `Admin OR sede_id = get_my_sede_id()` (sede-scoped).
- `detalle_venta` `dv_select` → `Admin OR v.sede_id = get_my_sede_id()`; `dv_write` → `Admin OR (v.vendedor_id = auth.uid() AND v.sede_id = get_my_sede_id())`.
- **Historia:** la migración `...000001` había abierto "vender de cualquier sede"; se revirtió en `20260530000004_bloque1_revert_venta_solo_su_sede.sql`. `inv_select=true` NO se revirtió.

**🔮 Plan futuro (NO en este bloque) — confirmado por la clienta:**

1. **Desplegable "Sede"** en Venta/ProductPicker: elegir una sede y ver su inventario sin ir al módulo Inventario (solo consulta; se apoya en `inv_select=true`).
2. **Popup estético** (tokens del sistema de diseño, sin hardcode) al intentar vender un producto de otra sede: _"No puedes vender este producto porque no está en tu sede. Búscalo en tu sede; si no hay stock, pide un traspaso."_ El RPC ya bloquea; la UI debe avisar antes.
3. **Inventario negativo** (bloque futuro): permitir stock negativo; si no hay producto en el almacén, baja a negativo y se **sugiere traspaso o compra** en vez de bloquear.
4. **Aplica a TODO lo que disminuye inventario** (no solo Ventas): **OT** que consumen repuestos y demás operaciones que restan stock siguen la misma lógica. Implementar el patrón una vez (ProductPicker consolidado) y reusar en Venta y OT.

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
