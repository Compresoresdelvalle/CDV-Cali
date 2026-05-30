# HANDOFF — Retomar el proyecto de correcciones post-deploy

> Documento de contexto para iniciar la próxima sesión sin re-investigar.
> Acompaña a: `PLAN_CORRECCIONES_POST_DEPLOY.md` (los 9 bloques) y `BLOQUE1_PLAN.md` (plan técnico del Bloque 1).
> Fecha de corte: 2026-05-29 (fin de sesión Bloque 0).

---

## 1. Dónde estamos

- Rama: **`fix/correcciones-post-deploy`** (NO se ha mergeado a `main`).
- **Bloque 0 = COMPLETO, probado y commiteado.** Commits: `647d80d` (reset contadores + clientes + fix login) y `b14cd0c` (botón "Eliminar").
- **Bloque 1 = IMPLEMENTADO (2026-05-30).** Backend (RLS + funciones) **aplicado a PRODUCCIÓN**; frontend en el branch (sin desplegar). Ver sección **"Bloque 1 — Resultado"** abajo. Falta: que el usuario pruebe con login (E2E) y luego merge a `main` + deploy.
- Siguiente acción: el usuario prueba Bloque 1 con login real; corregir lo que salga; luego Bloque 2 (insumos).

## Bloque 1 — Resultado (2026-05-30)

**Migraciones aplicadas a producción (vía MCP), respaldo en `supabase/backups/20260530_bloque1_permisos_RESTORE.sql`:**

- `20260530000001_bloque1_permisos_rls.sql` — RLS + funciones #3/#4/#6.
- `20260530000002_bloque1_traspaso_estado_cancelado.sql` — valor enum `cancelado` (aislado, obligatorio).
- `20260530000003_bloque1_fn_cancelar_traspaso.sql` — validador de transición + `fn_cancelar_traspaso`.

Verificado: policies correctas, enum con `cancelado`, gates de rol OK, `get_advisors security` sin ERROR nuevos (solo los WARN preexistentes de SECURITY DEFINER que comparten todas las RPC).

**Qué hace cada punto:**

- **#3** `inv_select` = `USING(true)` (todos VEN todo el inventario — se mantiene). **CORRECCIÓN clienta 2026-05-30:** el Vendedor **vende SOLO desde su sede** (Admin = cualquiera). Revertido en `20260530000004_bloque1_revert_venta_solo_su_sede.sql`: `fn_registrar_venta` recupera el bloqueo de sede (mantiene gate de rol Admin/Vendedor); `ventas_insert`/`ventas_select`/`dv_select`/`dv_write` vuelven a sede-scoped (consistente con `ventas_update`). Ver / actuar: bloque "Plan futuro" más abajo.
- **#4** Crear producto = solo Admin (`prod_modify` + `fn_crear_producto`). Front: botón "Nuevo producto" solo Admin (Productos.jsx, Inventario.jsx) y ruta `inventario/nuevo` solo Admin.
- **#5** `fn_cancelar_traspaso(p_traspaso_id, p_motivo)` — solo Admin, solo NO recibido; si está `en_transito` devuelve el stock al origen (movimiento `ajuste`). Botón "Cancelar traspaso" en TraspasoDetalle (solo Admin + estado no recibido).
- **#6** Vendedor crea+opera traslados (`fn_crear_traspaso`/`fn_procesar_traspaso` + rutas) y crea+gestiona OT como técnico (`os_insert`/`os_update` + `OrdenDetalle.puedeEditar`). Borrar OT/traslado sigue vetado al vendedor. ROLE_MODULES.Vendedor ganó "Traspasos" y "Órdenes".

**Decisiones registradas:**

- Bodeguero **ya no** puede registrar ventas (gate de rol en `fn_registrar_venta`). Correcto por el modelo de roles (Ventas = Vendedor); antes la función no tenía gate de rol (solo de sede). El Bodeguero no tiene UI de Ventas, así que no se nota.
- Cancelar traslado: permitido en `borrador/picking/verificado/en_transito`; bloqueado en `recibido/con_diferencia`. El movimiento de reversión usa `usuario_id` = Admin que cancela.

**⚠️ Pendiente de frontend de #3 (backend listo, UI no):**

1. **Ver todo el inventario con filtro (Inventario.jsx):** el filtro de Sede sigue oculto al vendedor (`esVendedor`). Con `inv_select=true`, el vendedor ya ve las 4 sedes en la lista, pero sin poder filtrar por sede. Falta solo mostrarle el filtro (1 línea). El `SEDE_LABELS` ya quedó corregido (ver abajo).

**🔮 PLAN FUTURO — venta por sede (definido por la clienta 2026-05-30, NO implementar aún):**

> Regla de negocio confirmada: el Vendedor **vende SOLO desde su propia sede**. Lo de "vender de cualquier sede" queda descartado. El backend ya lo refleja (migración `...000004`). Lo siguiente es UX para los próximos bloques:

1. **Desplegable "Sede" en Venta/ProductPicker:** el vendedor podrá elegir una sede en el selector y ver el inventario de esa sede **sin** ir al módulo Inventario. Es solo para CONSULTAR stock de otras sedes (apoyado en `inv_select=true`, que ya ve todo).
2. **Popup al intentar vender de otra sede:** si el vendedor intenta agregar/vender un producto que está en otra sede (no la suya), mostrar un **popup con la misma estética del sistema de diseño** (tokens CSS, sin hardcodear): _"No puedes vender este producto porque no está en tu sede. Búscalo en tu sede; si no hay stock, pide un traspaso."_ El RPC ya bloquea por seguridad (`fn_registrar_venta`), pero la UI debe avisar amablemente antes, no dejar que falle el RPC.
3. **Inventario negativo (bloque futuro):** se permitirá stock negativo. Cuando un producto no exista/no haya en ese almacén, en vez de bloquear, el stock baja a negativo y el sistema **pide hacer un traspaso o una compra** para regularizar. Esto sustituye al bloqueo duro.
4. **Aplica a TODO lo que disminuye inventario, no solo Ventas:** **Órdenes de Servicio (OT)** que consumen repuestos y cualquier otra operación que reste stock deben seguir la misma lógica (consumir solo de tu sede; popup si está en otra; negativo + sugerir traspaso/compra en el bloque futuro). Pensar el patrón una sola vez (idealmente en el ProductPicker consolidado, ver bloques 3/9) y reusarlo en Venta y OT.

**Fix de sedes (2026-05-30, commit aparte):** todos los mapas de sede del frontend usaban los IDs **inactivos** del seed (`BOD-PRINCIPAL`, `ALM-01/02/03`) en vez de las sedes **activas reales** (`BODEGA`, `CV`, `L3`, `CHV`). Esto rompía el filtro de sede en Inventario y, peor, el **selector de sede al crear un traslado** (TraspasoNuevo arma el dropdown desde `SEDE_LABELS`), lo que habría bloqueado el #6 del vendedor. Corregido en: `constants.js` (`SEDES`), `traspasos-ui.js` (`SEDE_LABELS`/`SEDE_CORTO`/`SEDE_TONO`), `herramientas-ui.js`, `Inventario.jsx`, `Login.jsx` y el fallback de `Herramientas.jsx`. Nombres: BODEGA="Bodega Principal", CV="Almacén CV", L3="Almacén L3", CHV="Almacén CHV". 3. **Ventana en vivo:** `inv_select=true` ya está en prod; el frontend viejo (Netlify) muestra a los vendedores las 4 sedes mezcladas en Inventario hasta que se despliegue el branch. (Usuario aceptó este interino el 2026-05-30.)

**Nota menor:** en el tablero Kanban de traspasos los cancelados se agrupan en la columna "Recibido" (distinguidos por pill roja "Cancelado"). Mejora futura: columna dedicada "Cancelado".

**Testing:** las funciones SECURITY DEFINER necesitan `auth.uid()`, así que **se prueban con login (E2E lo corre el usuario)**, no por MCP. Probar SOLO con productos `INVENTARIO DE PRUEBA` (999). Hay 1 traspaso real `en_transito` en prod — **NO cancelarlo** al probar.

## 2. Qué está DESPLEGADO vs solo en la rama (¡importante!)

- **EN PRODUCCIÓN (BD):** los cambios de base de datos del Bloque 0 ya están aplicados (renumeración, tabla `clientes`, `fn_upsert_cliente`, columnas `cliente_id`). El cliente ya los ve.
- **SOLO EN LA RAMA (frontend, NO desplegado):** ClientePicker, página `/ops/clientes`, fix de login (`EMAIL_MAP`), botón "Eliminar". **El sitio en vivo (Netlify) sigue con el frontend viejo** hasta que se haga merge a `main` + deploy. → El admin **aún no puede entrar en el sitio en línea** hasta desplegar el fix de login.

## 3. Estado REAL de producción (BD) en este punto

- ventas: **6** (números 1–6), `ventas_numero_seq`=6 → próxima venta real **#7**.
- cotizaciones 1, compras 22, traspasos 18, OT 2, devoluciones 2 (todas renumeradas desde 1). `cierres`=8 (intacto, es inmutable).
- clientes: **0**.
- **Productos de prueba CONSERVADOS** (a propósito, para testear los próximos bloques): `TEST-PRUEBA-001/002/003` ("INVENTARIO DE PRUEBA 1/2/3"), `categoria='PRUEBA'`, stock **999** en las 4 sedes. **Regla: testear SOLO con estos.**
- **Residuo conocido:** queda **1 fila en `movimientos`** (log de la venta de prueba #7 ya borrada). No se pudo borrar (candado append-only). Inofensiva; se purga al cerrar el proyecto.

## 4. Bloque 1 — decisiones ya confirmadas (detalle en BLOQUE1_PLAN.md)

- **#3** Vendedor ve TODO el inventario (`inv_select`=true) pero **vende SOLO desde su sede** (corrección clienta 2026-05-30; ve sus ventas de su sede). Plan futuro: desplegable "Sede" para consultar otras sedes + popup al intentar vender fuera de la suya. Ver §3 "Plan futuro".
- **#4** Crear/editar/eliminar productos = **solo Admin** (todo).
- **#5** Cancelar traspaso = **solo Admin**, **solo si está pendiente**, revirtiendo stock al origen. (Función NUEVA, hay que crearla.)
- **#6** Vendedor **crea y gestiona** OT y traslados.

## 5. Hechos técnicos del backend (descubiertos, no obvios)

- **Migraciones se aplican vía MCP Supabase `apply_migration`** (no hay Supabase CLI ni `config.toml`). Un solo proyecto = PRODUCCIÓN. Respaldo antes de cada cambio.
- `inventario`: la columna de stock es **`cantidad`** (no `stock`). Sedes activas: **BODEGA, CV, L3, CHV** (las del seed BOD-PRINCIPAL/ALM-01.. están inactivas).
- **Triggers clave:** `trg_no_delete_inventario` (no borrar inventario; sí UPDATE), `trg_no_delete_movimientos` + `trg_prevent_update_movimientos` (movimientos append-only), `trg_no_modify_cierre` (cierres inmutables), `productos_costo_guard` (cambiar costo solo Admin), `trg_after_insert_detalle_venta` (descuenta stock al vender), `trg_recalcular_venta`.
- `fn_registrar_venta` es **SECURITY DEFINER** y trae un check que BLOQUEA vender fuera de tu sede (`v_mi_rol <> 'Admin' AND v_mi_sede IS DISTINCT FROM p_sede_id`). **Este check se mantiene** (corrección clienta: vendedor vende solo su sede). El descuento de stock NO lo hace la función: lo dispara el trigger `trg_after_insert_detalle_venta` al insertar en `detalle_venta`. `p_items` = `[{producto_id, cantidad}]`.
- FKs: `detalle_venta.venta_id → ventas` es **ON DELETE CASCADE**; **`movimientos` NO tiene FK a `ventas`** (solo a producto/sede/usuario).
- RLS actuales relevantes (resumen): `inv_select` = Admin o su sede; `prod_modify` = Admin+Bodeguero (cambiar a solo Admin); `os_insert` = Admin+Tecnico (añadir Vendedor); `traspasos` solo tiene policy de SELECT (create/recibir van por funciones SECURITY DEFINER).
- Falta leer al implementar Bloque 1: `fn_crear_traspaso`, `fn_procesar_traspaso`, `fn_crear_producto`, enum de estados de traspaso/OT.
- **⚠️ DRIFT BD↔repo:** `fn_editar_costo_producto(uuid,numeric)` (Admin-only, hace `UPDATE productos SET costo_promedio`) **existe en producción pero NO está en ninguna migración commiteada** (`git log -S` no la encuentra). Se creó directo en la BD en algún momento. 2026-05-30 se cableó por fin un botón "Editar costo" en ProductoDetalle que la usa (commit `f4ce285`). Lección: la BD de prod puede tener objetos que no están en `supabase/migrations/`; al planear migraciones, verificar el estado real con `pg_proc`/`pg_policies`, no asumir que el repo = la BD.

## 6. Restricciones de seguridad que el clasificador BLOQUEA (no reintentar a la fuerza)

- **Manejar el PIN real de producción** en comandos/archivos → el **E2E con login lo corre el USUARIO** (no yo). Los PINs NO van al repo.
- **Leer o escribir el esquema `auth`** (crear usuarios de prueba bloqueado).
- **Desactivar el candado append-only de `movimientos`** (por eso quedó la fila huérfana).
- **`DELETE` sin `WHERE`** → siempre acotar.

## 7. Testing (cómo se probó y cómo seguir)

- Spec E2E local (sin commitear): `tests/e2e/_bloque0_smoke.spec.js`. Corre con: `$env:TEST_ADMIN_PIN="<pin>"; npx playwright test tests/e2e/_bloque0_smoke.spec.js --project=chromium`. Usa el chromium del proyecto, reusa el server en `http://localhost:5174`.
- Resultados en `tests/results/e2e-results.json` + capturas `tests/results/bloque0-*.png` (las leo yo).
- **Resultado Bloque 0:** login Admin ✅, página Clientes ✅, búsqueda de productos de prueba ✅, crear cliente → aparece ✅.
- Nota de entorno: si falta `tw-animate-css` en node_modules, correr `npm install --legacy-peer-deps`.

## 8. Mejoras estructurales pendientes (anotadas, no hechas)

- **Login no debería depender del diccionario fijo `EMAIL_MAP`** (nombre→email): si renombran/agregan usuarios en la BD, vuelve a romperse. Corrección de fondo pendiente.
- **Consolidar el ProductPicker:** los ajustes #11 (botón Sede), #12 (mostrar sin stock), #32 (buscador completo), #33, #34 (filtros multi) tocan el MISMO componente pero están repartidos entre Bloque 3 y 9 → conviene rehacerlo UNA vez.
- "Clientes" e "insumos" eran features, no arreglos rápidos (clientes ya hecho; insumos = Bloque 2, definir modelo: atributo del producto vs. convertir cantidades a pool de insumos).
- Glitches de numeración en `PLAN_CORRECCIONES_POST_DEPLOY.md` (el #30 aparece 2 veces; faltan #15/#20).

## 9. Datos de empresa para bloques futuros (de los MD)

- Teléfonos por almacén: **CV: 3127536787 · L3: 3114940799 · CHV: 3174675905**. Dirección OT: **Calle 34 #4b-30**. Nombre en recibos: **"Compresores CV"**.

## 10. Limpieza FINAL del proyecto (al terminar todos los bloques)

Purgar: 3 productos de prueba + todo lo ligado (ventas/movimientos de prueba) + reset de secuencias. Requiere desactivar un instante el candado de `movimientos` → **pedir autorización explícita** del usuario en ese momento.

## 11. TODO inmediato próxima sesión

1. (Opcional) Commitear `BLOQUE1_PLAN.md` y `HANDOFF_SESION.md`.
2. Implementar Bloque 1 según `BLOQUE1_PLAN.md`: primero migración RLS (#3,#4,#6) → probar → luego función+UI de cancelar traspaso (#5) → frontend permisos → commit.
3. Recordatorio del flujo: un bloque por sesión, commitear al terminar, el usuario prueba antes de avanzar, merge a `main` solo cuando esté seguro.
