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

- **#3** `inv_select` = `USING(true)` (todos ven todo el inventario); `fn_registrar_venta` sin bloqueo de sede (gate de rol Admin/Vendedor); `ventas_select`/`detalle_venta` muestran al vendedor SUS ventas de cualquier sede + las de su sede.
- **#4** Crear producto = solo Admin (`prod_modify` + `fn_crear_producto`). Front: botón "Nuevo producto" solo Admin (Productos.jsx, Inventario.jsx) y ruta `inventario/nuevo` solo Admin.
- **#5** `fn_cancelar_traspaso(p_traspaso_id, p_motivo)` — solo Admin, solo NO recibido; si está `en_transito` devuelve el stock al origen (movimiento `ajuste`). Botón "Cancelar traspaso" en TraspasoDetalle (solo Admin + estado no recibido).
- **#6** Vendedor crea+opera traslados (`fn_crear_traspaso`/`fn_procesar_traspaso` + rutas) y crea+gestiona OT como técnico (`os_insert`/`os_update` + `OrdenDetalle.puedeEditar`). Borrar OT/traslado sigue vetado al vendedor. ROLE_MODULES.Vendedor ganó "Traspasos" y "Órdenes".

**Decisiones registradas:**

- Bodeguero **ya no** puede registrar ventas (gate de rol en `fn_registrar_venta`). Correcto por el modelo de roles (Ventas = Vendedor); antes la función no tenía gate de rol (solo de sede). El Bodeguero no tiene UI de Ventas, así que no se nota.
- Cancelar traslado: permitido en `borrador/picking/verificado/en_transito`; bloqueado en `recibido/con_diferencia`. El movimiento de reversión usa `usuario_id` = Admin que cancela.

**⚠️ Pendientes de frontend para completar #3 (backend YA listo, UI no):**

1. **Vender desde cualquier sede (VentaNueva.jsx):** la UI sigue forzando `perfil.sede_id` (`.eq("sede_id", perfil.sede_id)` y `p_sede_id`). Falta un selector de sede (idealmente con la consolidación del ProductPicker, bloques 3/9). Hoy el vendedor PUEDE vender de otra sede por RPC, pero la UI no lo ofrece.
2. **Ver todo el inventario con filtro (Inventario.jsx):** el filtro de Sede sigue oculto al vendedor (`esVendedor`). Con `inv_select=true`, el vendedor ya ve las 4 sedes en la lista, pero sin poder filtrar por sede. Falta mostrarle el filtro **y verificar que `SEDE_LABELS` (lib/traspasos-ui.js) use las sedes activas reales (BODEGA/CV/L3/CHV)**, no los IDs viejos del seed.
3. **Ventana en vivo:** `inv_select=true` ya está en prod; el frontend viejo (Netlify) muestra a los vendedores las 4 sedes mezcladas en Inventario hasta que se despliegue el branch. (Usuario aceptó este interino el 2026-05-30.)

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

- **#3** Vendedor ve TODO el inventario y **vende de cualquier sede**; ve SUS ventas (cualquier sede) + las de su sede.
- **#4** Crear/editar/eliminar productos = **solo Admin** (todo).
- **#5** Cancelar traspaso = **solo Admin**, **solo si está pendiente**, revirtiendo stock al origen. (Función NUEVA, hay que crearla.)
- **#6** Vendedor **crea y gestiona** OT y traslados.

## 5. Hechos técnicos del backend (descubiertos, no obvios)

- **Migraciones se aplican vía MCP Supabase `apply_migration`** (no hay Supabase CLI ni `config.toml`). Un solo proyecto = PRODUCCIÓN. Respaldo antes de cada cambio.
- `inventario`: la columna de stock es **`cantidad`** (no `stock`). Sedes activas: **BODEGA, CV, L3, CHV** (las del seed BOD-PRINCIPAL/ALM-01.. están inactivas).
- **Triggers clave:** `trg_no_delete_inventario` (no borrar inventario; sí UPDATE), `trg_no_delete_movimientos` + `trg_prevent_update_movimientos` (movimientos append-only), `trg_no_modify_cierre` (cierres inmutables), `productos_costo_guard` (cambiar costo solo Admin), `trg_after_insert_detalle_venta` (descuenta stock al vender), `trg_recalcular_venta`.
- `fn_registrar_venta` es **SECURITY DEFINER** y trae un check que BLOQUEA vender fuera de tu sede (`v_mi_rol <> 'Admin' AND v_mi_sede <> p_sede_id`). Para #3 hay que quitar ese check. `p_items` = `[{producto_id, cantidad}]`.
- FKs: `detalle_venta.venta_id → ventas` es **ON DELETE CASCADE**; **`movimientos` NO tiene FK a `ventas`** (solo a producto/sede/usuario).
- RLS actuales relevantes (resumen): `inv_select` = Admin o su sede; `prod_modify` = Admin+Bodeguero (cambiar a solo Admin); `os_insert` = Admin+Tecnico (añadir Vendedor); `traspasos` solo tiene policy de SELECT (create/recibir van por funciones SECURITY DEFINER).
- Falta leer al implementar Bloque 1: `fn_crear_traspaso`, `fn_procesar_traspaso`, `fn_crear_producto`, enum de estados de traspaso/OT.

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
