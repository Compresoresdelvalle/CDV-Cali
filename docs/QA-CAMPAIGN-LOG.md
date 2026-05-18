# QA Campaign Log — Compresores del Valle

> Registro maestro de la campaña de QA end-to-end fase por fase (Fase 0 → 15).
> Plan: `C:\Users\davi-\.claude\plans\planea-bien-como-lo-cryptic-pancake.md`.
> Severidad: **P0** bloquea la fase · **P1** se arregla en la fase · **P2** backlog.

## Estado por fase

| Fase | Tema                                 | Estado       | Hallazgos (P0/P1/P2)   | Commit                |
| ---- | ------------------------------------ | ------------ | ---------------------- | --------------------- |
| 0    | Setup                                | ✅ Cerrada   | 0 / 3 / 4              | (ver commit qa fase0) |
| 1    | Base de datos                        | ✅ Cerrada   | 0 / 3 / 8              | (ver commit qa fase1) |
| 2    | Login + Layout + Roles               | ✅ Cerrada   | 0 / 3 / 6              | (ver commit qa fase2) |
| 3    | Inventario + QR + Realtime           | ✅ Cerrada   | 0 / 5 / 3              | (ver commit qa fase3) |
| 4    | Ventas + Cotizaciones                | ⚠️ Parcial   | 4 / 3 / 2 (P0 abierto) | (ver commit qa fase4) |
| 5    | Compras + Devoluciones               | ⏳ Pendiente | —                      | —                     |
| 6    | Traspasos + Picking                  | ⏳ Pendiente | —                      | —                     |
| 7    | Órdenes + Ensambles + Herramientas   | ⏳ Pendiente | —                      | —                     |
| 8    | Dashboard Admin                      | ⏳ Pendiente | —                      | —                     |
| 9    | Configuración General                | ⏳ Pendiente | —                      | —                     |
| 10   | Ajustes OT                           | ⏳ Pendiente | —                      | —                     |
| 11   | Ajustes Cotizaciones                 | ⏳ Pendiente | —                      | —                     |
| 12   | Ajustes Inventario/Compras/Traspasos | ⏳ Pendiente | —                      | —                     |
| 13   | Garantías                            | ⏳ Pendiente | —                      | —                     |
| 14   | Recibos manuales                     | ⏳ Pendiente | —                      | —                     |
| 15   | Dashboard + Cierres                  | ⏳ Pendiente | —                      | —                     |

## Hallazgos

| ID    | Fase | Sev | Área                       | Repro / Descripción                                                                                                                   | Causa raíz                                        | Fix (commit)                                                                                                                         | Estado      |
| ----- | ---- | --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| F0-01 | 0    | P1  | Seguridad / `netlify.toml` | El sitio no enviaba ningún header de seguridad (clickjacking, MIME sniffing, sin HSTS).                                               | `netlify.toml` solo tenía el redirect SPA.        | Agregados `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `HSTS`, `Permissions-Policy` (cámara permitida para self). | ✅ Resuelto |
| F0-02 | 0    | P1  | Seguridad / `.gitignore`   | `.env.production` / `.env.staging` (sin sufijo `.local`) no estaban ignorados → riesgo de commitear credenciales.                     | Patrón `.gitignore` incompleto.                   | Patrón cambiado a `.env.*`.                                                                                                          | ✅ Resuelto |
| F0-03 | 0    | P1  | Config / dev server        | `playwright.config.js` espera puerto 5174 pero `npm run dev` (Vite) usaba el default 5173 → el webServer de Playwright hacía timeout. | `vite.config.js` no fijaba `server.port`.         | Fijado `server.port: 5174, strictPort: true` + `.claude/launch.json` a 5174.                                                         | ✅ Resuelto |
| F0-04 | 0    | P2  | UI / PWA                   | `theme_color`/`background_color` del manifest y `<meta theme-color>` usaban colores de una marca anterior (verde/beige).              | Config de Fase 0 sin actualizar tras el rediseño. | Actualizados a la marca actual (`#245A8C` / `#F6F8FA`).                                                                              | ✅ Resuelto |
| F0-05 | 0    | P2  | Perf / fuentes             | `index.html` cargaba Barlow Condensed + DM Sans (sin uso) y `index.css` importaba IBM Plex Sans con `@import` (render-blocking).      | Fuentes de marca anterior + import bloqueante.    | `index.html` carga IBM Plex Sans vía `<link>`; eliminado el `@import` de `index.css`.                                                | ✅ Resuelto |

### Fase 1 — Base de datos

| ID    | Fase | Sev | Área                  | Repro / Descripción                                                                                                                                    | Causa raíz                               | Fix (commit)                                                           | Estado      |
| ----- | ---- | --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------- | ----------- |
| F1-01 | 1    | P1  | Seguridad / vistas    | Vistas `v_conteo_ciclico` y `v_producto_ultimo_proveedor` con `SECURITY DEFINER` → saltaban la RLS del usuario que consulta (Supabase advisor: ERROR). | Vistas creadas sin `security_invoker`.   | `ALTER VIEW ... SET (security_invoker = true)` en ambas.               | ✅ Resuelto |
| F1-02 | 1    | P1  | Seguridad / funciones | 9 funciones `SECURITY DEFINER` con `search_path` mutable (advisor: WARN) → riesgo de secuestro de resolución de objetos.                               | Funciones creadas sin `SET search_path`. | `ALTER FUNCTION ... SET search_path = public, pg_temp` en las 9.       | ✅ Resuelto |
| F1-03 | 1    | P1  | Seguridad / anon      | `fn_alertas_rotacion` y `fn_marcar_cotizaciones_vencidas` ejecutables por el rol `anon` (sin sesión) y NO validan `auth.uid()`.                        | Grant `EXECUTE` heredado de `PUBLIC`.    | `REVOKE EXECUTE ... FROM anon, public` + `GRANT ... TO authenticated`. | ✅ Resuelto |

**Verificado OK:** RLS habilitado en las 37 tablas; la RLS aísla a un vendedor a su sede (stress: 36/150 filas de inventario, 0 de otras sedes); `movimientos` es append-only (UPDATE y DELETE bloqueados por trigger); las RPCs de escritura (`fn_registrar_venta`, `fn_anular_venta`, `fn_procesar_traspaso`, `fn_registrar_devolucion`) validan `auth.uid()`.

### Fase 2 — Login + Layout + Roles

| ID    | Fase | Sev | Área              | Repro / Descripción                                                                                                               | Causa raíz                                                               | Fix (commit)                                                   | Estado      |
| ----- | ---- | --- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- | ----------- |
| F2-01 | 2    | P1  | Seguridad / Login | La pantalla de login mostraba "PIN de prueba: 1234" a cualquier visitante en producción.                                          | Texto de ayuda de desarrollo sin condicionar.                            | Condicionado a `import.meta.env.DEV`.                          | ✅ Resuelto |
| F2-02 | 2    | P1  | Robustez / Login  | La carga de usuarios (`supabase.from('usuarios')`) no manejaba error → en fallo de red, spinner infinito sin mensaje.             | `.then(({data}))` ignoraba `error` y no había `.catch`.                  | Se maneja `error` y se agrega `.catch` con mensaje al usuario. | ✅ Resuelto |
| F2-03 | 2    | P1  | UI / navegación   | `Garantías` y `Recibos` no estaban en `MODULE_GROUP` de `AppShell` → caían a un grupo sin renderizar en el sidebar de escritorio. | F13/F14 agregaron los módulos a `ROLE_MODULES` pero no a `MODULE_GROUP`. | Agregados a `MODULE_GROUP` (grupo "Operaciones").              | ✅ Resuelto |

**Verificado OK:** E2E `fase02-login.spec.js` 5/5 (login por rol, menú por rol, PIN incorrecto no entra, RBAC del RoleGuard, persistencia de sesión al recargar); el cleanup de `init()` del authStore sí lo invoca `App.jsx` (el "leak" reportado por un agente era falso positivo); las races sutiles del authStore son benignas (refetch del mismo perfil).

### Fase 3 — Inventario + QR + Realtime

Todos los hallazgos se corrigieron en el momento (P1 y P2).

| ID    | Fase | Sev | Área           | Repro / Descripción                                                                                                                                       | Fix                                                                                                                             | Estado      |
| ----- | ---- | --- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| F3-01 | 3    | P1  | Race condition | `fetchInventario` no descartaba resultados obsoletos → al cambiar filtro/búsqueda rápido, una query lenta pisaba los datos correctos.                     | Token de versión `fetchSeq`; los resultados de fetches viejos se descartan.                                                     | ✅ Resuelto |
| F3-02 | 3    | P1  | Paginación     | El filtro de productos inactivos se hacía en cliente tras `.range(50)` → páginas con <50 ítems → `hasMore` falso prematuro, productos que nunca cargaban. | `producto:productos!inner(...)` + `.eq('producto.activo', true)` → PostgREST filtra server-side; `hasMore` con el conteo crudo. | ✅ Resuelto |
| F3-03 | 3    | P1  | Rendimiento    | La pre-query de búsqueda no tenía límite → un término común con 3.000 productos generaría una URL gigante (`.in()`) y error 414.                          | `.limit(500)` en la pre-query.                                                                                                  | ✅ Resuelto |
| F3-04 | 3    | P1  | Robustez       | El error de la pre-query de productos se ignoraba → en fallo de red mostraba "Sin resultados" falso.                                                      | Se desestructura y propaga `error` de la pre-query.                                                                             | ✅ Resuelto |
| F3-05 | 3    | P1  | Realtime       | Crear un producto inserta filas en 4 sedes → 4 eventos INSERT → 4 re-fetch completos seguidos.                                                            | Re-fetch con debounce de 400 ms (agrupa los eventos).                                                                           | ✅ Resuelto |
| F3-06 | 3    | P2  | Crash          | `mov.tipo.toLowerCase()` en `ProductoDetalle` lanzaba excepción si `tipo` era null.                                                                       | Guarda `(mov.tipo ?? "")`.                                                                                                      | ✅ Resuelto |
| F3-07 | 3    | P2  | UX             | `QRPrintLabel`: si el navegador bloqueaba la ventana emergente, no pasaba nada (el operario creía que falló la impresora).                                | Alerta clara cuando `window.open` devuelve null.                                                                                | ✅ Resuelto |
| F3-08 | 3    | P2  | Bug menor      | `inventarioStore.reset()` no limpiaba `filtroTipo` → filtro fantasma tras logout.                                                                         | Agregado `filtroTipo: null` al `reset()`.                                                                                       | ✅ Resuelto |

**Verificado OK:** E2E `fase03-inventario.spec.js` 3/3 (carga del listado, búsqueda server-side, apertura de detalle); `sanitizeSearch` se aplica correctamente (sin inyección PostgREST en la búsqueda); el inventario carga 39 productos tras el cambio a `productos!inner`.

**Routeado a Fase 16 (Frontend Redesign):** detalles de UI no funcionales — botones de filtro de 36px (CLAUDE.md pide 48px), filas de tabla clickeables sin `role`/`tabIndex`, `focus-visible` ring en inputs. Son polish de accesibilidad/táctil, parte natural del rediseño de F16.

### Fase 4 — Ventas + Cotizaciones ⚠️ PARCIAL

3 agentes revisaron frontend + RPCs/triggers + seguridad. Los crashes de
frontend se corrigieron; **quedan hallazgos P0/P1 de BD que requieren tu
decisión** antes de tocar las RPCs financieras del core.

**Resueltos:**

| ID    | Sev | Área      | Repro / Descripción                                                                                                                 | Fix                                                                                              | Estado      |
| ----- | --- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------- |
| F4-01 | P0  | Crash     | `VentaNueva` accedía a `perfil.sede_id` (sin `?.`) en un array de deps → `TypeError` en render si el perfil aún no cargaba.         | `perfil?.sede_id`.                                                                               | ✅ Resuelto |
| F4-02 | P0  | Datos     | `VentaDetalle` calculaba `descuento_pct/100` e `iva_pct/100` sin fallback → "$ NaN" si la columna era null.                         | `(venta.descuento_pct ?? 0)` / `(venta.iva_pct ?? 19)`.                                          | ✅ Resuelto |
| F4-03 | P0  | Seguridad | `descuento_pct` se aceptaba sin tope → `fn_registrar_venta`/`fn_registrar_cotizacion` con `descuento_pct=200` daban una venta a $0. | CHECK `descuento_pct BETWEEN 0 AND 100` en `ventas` y `cotizaciones` (bloquea a nivel de motor). | ✅ Resuelto |
| F4-04 | P1  | Robustez  | `.single()` en el escaneo QR de `VentaNueva`/`CotizacionNueva` lanzaba error si no había fila.                                      | `.maybeSingle()`.                                                                                | ✅ Resuelto |

**Abiertos — requieren decisión / trabajo cuidadoso en RPCs del core:**

| ID    | Sev    | Área                 | Descripción                                                                                                                                                                                                                      | Acción requerida                                                                                                                                                                                 |
| ----- | ------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F4-05 | **P0** | Seguridad financiera | `fn_registrar_venta` y `fn_registrar_cotizacion` aceptan `precio_unitario` del payload del cliente sin validarlo contra `productos.precio_venta`. Un vendedor (con devtools) puede registrar una venta con `precio_unitario: 1`. | **Decisión de producto:** ¿se permite precio negociado/manual, o el precio SIEMPRE debe venir del catálogo? Según la respuesta, modificar el RPC para ignorar el precio del cliente o validarlo. |
| F4-06 | P1     | Seguridad            | `fn_convertir_cotizacion` no valida rol ni ownership → cualquier usuario autenticado puede convertir la cotización de otro vendedor.                                                                                             | Agregar chequeo `auth.uid()` + rol/ownership al RPC.                                                                                                                                             |
| F4-07 | P1     | Datos                | `fn_convertir_cotizacion` (versión final) no inserta `costo_unitario` en `detalle_venta` → la venta convertida queda con margen mal calculado.                                                                                   | Leer `costo_promedio` del producto e insertarlo.                                                                                                                                                 |
| F4-08 | P1     | Pérdida de datos     | `CotizacionEditar` guarda con `DELETE` + `INSERT` no transaccional de `detalle_cotizacion` → si el INSERT falla, la cotización queda sin ítems.                                                                                  | Mover el guardado a un RPC transaccional.                                                                                                                                                        |
| F4-09 | P2     | Deuda técnica        | Las Edge Functions `registrar-venta` / `convertir-cotizacion` parecen código muerto duplicado de las RPCs; CORS `*`.                                                                                                             | Confirmar qué usa el frontend; eliminar la ruta sin uso.                                                                                                                                         |

**Verificado OK:** stock con `FOR UPDATE` y validación antes de descontar (trigger); atomicidad de la venta; anulación idempotente; `fn_anular_venta` valida rol Admin en el servidor (el gate de UI es solo cosmético, correcto).

## Backlog (P2 sin resolver)

- **F2-04 (P2, seguridad):** el login con PIN de 4 dígitos no tiene rate-limiting ni bloqueo por intentos fallidos del lado del cliente. Brute-force teórico (10.000 combos). App interna de 6 usuarios; Supabase Auth tiene rate-limiting de plataforma.
- **F2-05 (P2, seguridad):** la pantalla de login lista nombres + roles + sede de los empleados sin sesión (rol `anon`). Es por diseño (UX de selección de usuario); no expone PIN/hash.
- **F2-06 (P2, diseño):** `Login.jsx` y partes de `AdminShell.jsx` usan colores hardcodeados en vez de tokens `hsl(var(--*))` (viola Regla #1 de CLAUDE.md; el Login es excepción de marca).
- **F2-07 (P2, a11y/robustez):** teclado de PIN sin `aria-label` por dígito; `setTimeout` de autofocus sin cleanup; `getInitials` falla con nombres de espacios dobles.
- **F2-08 (P2, seguridad):** las sub-rutas de `/admin` no tienen `RoleGuard` propio (solo el del layout). La seguridad real es la RLS; conviene defense-in-depth en rutas sensibles.

## Backlog Fase 0/1 (P2 sin resolver)

- **F1-04 (P2, seguridad):** ~16 funciones más (RPCs de escritura que SÍ validan `auth.uid()`, funciones-trigger, `get_my_rol`/`get_my_sede_id`) siguen ejecutables por `anon`. Defense-in-depth, no es un hueco activo. Revocar requiere análisis de blast-radius (la RLS depende de los helpers).
- **F1-05 (P2, seguridad):** políticas RLS always-true `herr_all` (`herramientas_prestamo`) y `dt_all` (`detalle_traspaso`) coexisten con políticas granulares que las hacen redundantes; conviene eliminarlas.
- **F1-06 (P2, perf):** `multiple_permissive_policies` en 28 tablas (políticas de F1 + políticas granulares de fases posteriores se solapan). Requiere una limpieza/consolidación de RLS dedicada.
- **F1-07 (P2, perf):** 43 FK sin índice de cobertura + 32 índices sin uso (advisor). Bajo impacto a la escala actual.
- **F1-08 (P2, datos): ✅ RESUELTO** — 1 fila de `inventario` tenía `estado_stock` stale (FA-2236 en ALM-01: `'Agotado'` con `cantidad=1`). Corregido a `'Bajo'` con `UPDATE` autorizado por el usuario (la cantidad no se tocó). El trigger de `estado_stock` solo recalcula cuando cambia `cantidad`, por eso la fila quedó stale desde el seed inicial.
- **F1-09 (P2, lógica):** `trg_compra_sumar_stock` lee el stock sin `FOR UPDATE` → bajo compras concurrentes del mismo producto, el `stock_anterior` del registro de auditoría puede quedar mal (el `cantidad` final es correcto por el `ON CONFLICT`).
- **F1-10 (P2, lógica):** otros hallazgos del agente de BD: `costo_promedio` usa stock por-sede como denominador (debería ser global); `trg_ensamble_stock` hardcodea `stock_anterior=0` en el movimiento de producción; `estado_stock` no maneja `stock_minimo=0`.
- **F1-11 (P2, seguridad):** Supabase Auth — protección contra contraseñas filtradas (HaveIBeenPwned) deshabilitada. Es un ajuste del dashboard de Supabase.

- **F0-06 (P2, seguridad):** `netlify.toml` aún sin `Content-Security-Policy`. Se implementará en la **Fase 17 (deploy)**, probándola contra el sitio desplegado para no romper Supabase / cámara / PDF.
- **F0-07 (P2, config):** `eslint.config.js` con `ecmaVersion: 2020` redundante; `tests/` sin globals de lint (Node/Vitest).
- **F0-08 (P2, PWA):** faltan íconos `maskable` y `apple-touch-icon` para instalación adaptativa en iOS/Android.
- **F0-09 (P2, doc):** `CLAUDE.md` dice "React 18" pero el proyecto usa React 19. Inconsistencia de documentación (la app compila y corre bien).
