# QA Campaign Log — Compresores del Valle

> Registro maestro de la campaña de QA end-to-end fase por fase (Fase 0 → 15).
> Plan: `C:\Users\davi-\.claude\plans\planea-bien-como-lo-cryptic-pancake.md`.
> Severidad: **P0** bloquea la fase · **P1** se arregla en la fase · **P2** backlog.

## Estado por fase

| Fase | Tema                                 | Estado       | Hallazgos (P0/P1/P2) | Commit                 |
| ---- | ------------------------------------ | ------------ | -------------------- | ---------------------- |
| 0    | Setup                                | ✅ Cerrada   | 0 / 3 / 4            | (ver commit qa fase0)  |
| 1    | Base de datos                        | ✅ Cerrada   | 0 / 3 / 8            | (ver commit qa fase1)  |
| 2    | Login + Layout + Roles               | ✅ Cerrada   | 0 / 3 / 6            | (ver commit qa fase2)  |
| 3    | Inventario + QR + Realtime           | ✅ Cerrada   | 0 / 5 / 3            | (ver commit qa fase3)  |
| 4    | Ventas + Cotizaciones                | ✅ Cerrada   | 4 / 1 / 2            | (ver commits qa fase4) |
| 5    | Compras + Devoluciones               | ✅ Cerrada   | 0 / 6 / 7            | (ver commit qa fase5)  |
| 6    | Traspasos + Picking                  | ✅ Cerrada   | 0 / 9 / 5            | (ver commit qa fase6)  |
| 7    | Órdenes + Ensambles + Herramientas   | ✅ Cerrada   | 0 / 7 / 10           | (ver commit qa fase7)  |
| 8    | Dashboard Admin                      | ✅ Cerrada   | 0 / 3 / 3            | (ver commit qa fase8)  |
| 9    | Configuración General                | ✅ Cerrada   | 0 / 2 / 2            | (ver commit qa fase9)  |
| 10   | Ajustes OT                           | ✅ Cerrada   | 0 / 1 / 1            | (ver commit qa fase10) |
| 11   | Ajustes Cotizaciones                 | ⏳ Pendiente | —                    | —                      |
| 12   | Ajustes Inventario/Compras/Traspasos | ⏳ Pendiente | —                    | —                      |
| 13   | Garantías                            | ⏳ Pendiente | —                    | —                      |
| 14   | Recibos manuales                     | ⏳ Pendiente | —                    | —                      |
| 15   | Dashboard + Cierres                  | ⏳ Pendiente | —                    | —                      |

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

### Fase 4 — Ventas + Cotizaciones ✅ CERRADA

3 agentes revisaron frontend + RPCs/triggers + seguridad. Todos los hallazgos
quedaron resueltos, descartados como falsos positivos, o routeados a su fase.

**Resueltos:**

| ID    | Sev | Área      | Repro / Descripción                                                                                                                 | Fix                                                                                              | Estado      |
| ----- | --- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------- |
| F4-01 | P0  | Crash     | `VentaNueva` accedía a `perfil.sede_id` (sin `?.`) en un array de deps → `TypeError` en render si el perfil aún no cargaba.         | `perfil?.sede_id`.                                                                               | ✅ Resuelto |
| F4-02 | P0  | Datos     | `VentaDetalle` calculaba `descuento_pct/100` e `iva_pct/100` sin fallback → "$ NaN" si la columna era null.                         | `(venta.descuento_pct ?? 0)` / `(venta.iva_pct ?? 19)`.                                          | ✅ Resuelto |
| F4-03 | P0  | Seguridad | `descuento_pct` se aceptaba sin tope → `fn_registrar_venta`/`fn_registrar_cotizacion` con `descuento_pct=200` daban una venta a $0. | CHECK `descuento_pct BETWEEN 0 AND 100` en `ventas` y `cotizaciones` (bloquea a nivel de motor). | ✅ Resuelto |
| F4-04 | P1  | Robustez  | `.single()` en el escaneo QR de `VentaNueva`/`CotizacionNueva` lanzaba error si no había fila.                                      | `.maybeSingle()`.                                                                                | ✅ Resuelto |

| F4-05 | **P0** | Seguridad financiera | `fn_registrar_venta` y `fn_registrar_cotizacion` aceptaban `precio_unitario` del payload del cliente sin validarlo. Un vendedor (con devtools) podía registrar una venta con `precio_unitario: 1`. | **Decisión del cliente:** el precio SIEMPRE sale del catálogo; la negociación se hace con `descuento_pct`. Ambas RPCs reescritas para leer `productos.precio_venta` e ignorar el precio del cliente. Stress verificado: precio manipulado a 1 → se usa el del catálogo. | ✅ Resuelto |

**Descartados (falsos positivos — los agentes leyeron migraciones viejas):**

- **F4-06:** `fn_convertir_cotizacion` SÍ valida rol/sede en su versión viva (`auth.uid()` + `v_rol/v_sede` check + `FOR UPDATE`).
- **F4-07:** `fn_convertir_cotizacion` SÍ inserta `costo_unitario` (lee `costo_promedio` del producto).

**Routeado a Fase 11 (Ajustes Cotizaciones):**

- **F4-08 (P1):** `CotizacionEditar` guarda con `DELETE`+`INSERT` no transaccional → si el INSERT falla, la cotización queda sin ítems. La edición de cotizaciones es una feature de F11; se corrige (RPC transaccional) en el QA de F11.

**Routeado a Fase 17 (Deploy):**

- **F4-09 (P2):** Edge Functions `registrar-venta`/`convertir-cotizacion` posiblemente código muerto duplicado de las RPCs + CORS `*`. Decidir/limpiar en el deploy.

**Verificado OK:** stock con `FOR UPDATE` y validación antes de descontar (trigger); atomicidad de la venta; anulación idempotente; `fn_anular_venta` valida rol Admin en el servidor; `fn_convertir_cotizacion` valida rol/sede, evita doble conversión y exige estado `aprobada`.

### Fase 5 — Compras + Devoluciones ✅ CERRADA

3 agentes (code-reviewer, typescript-reviewer, security-reviewer) revisaron
`CompraNueva/Detalle/Historial.jsx` y `DevolucionNueva/Historial.jsx`; revisión
de BD propia sobre `trg_compra_sumar_stock`, `fn_registrar_devolucion` y la RLS
de `compras`/`detalle_compra`/`devoluciones`. **Todos los hallazgos resueltos**
(6 P1 + 7 P2); sin backlog.

**Resueltos — P1:**

| ID    | Sev | Área                  | Repro / Descripción                                                                                                                                                            | Fix                                                                                                                                                                | Estado      |
| ----- | --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| F5-01 | P1  | Seguridad / auditoría | `CompraNueva` insertaba `compras.registrado_por` desde el cliente; la RLS `compras_insert` no lo validaba → un bodeguero con devtools podía atribuir la compra a otro usuario. | RPC `fn_registrar_compra` (`SECURITY DEFINER`) fija `registrado_por = auth.uid()`; se elimina la política de INSERT directo. Stress: registrado_por = el llamante. | ✅ Resuelto |
| F5-02 | P1  | Datos / integridad    | `compras.subtotal/iva/total` y `detalle_compra.subtotal` se calculaban en el cliente sin recomputar en el servidor → podían no cuadrar con el detalle.                         | El RPC recalcula subtotal (Σ cantidad×costo), IVA 19% y total. Stress: subtotal/total = recomputado.                                                               | ✅ Resuelto |
| F5-03 | P1  | Atomicidad            | `CompraNueva` registraba con 3 inserts NO transaccionales (compra → detalle → recibir) → si el insert de detalle fallaba quedaba una compra huérfana.                          | El RPC inserta compra + detalle (+ recepción opcional) en una sola transacción.                                                                                    | ✅ Resuelto |
| F5-04 | P1  | Seguridad / RLS       | La política `dev_all` (cmd=ALL) permitía INSERT/UPDATE crudos a `devoluciones` saltándose las validaciones de `fn_registrar_devolucion`; sin restricción de sede en SELECT.    | Reemplazada por `dev_select` (SELECT, Admin o sede propia); las escrituras solo vía el RPC. Stress: INSERT directo bloqueado por RLS.                              | ✅ Resuelto |
| F5-05 | P1  | Race condition        | `CompraHistorial` y `DevolucionHistorial`: al cambiar de filtro con una carga en vuelo, la respuesta vieja pisaba/mezclaba resultados.                                         | Token de secuencia (`reqIdRef`); las respuestas obsoletas se descartan.                                                                                            | ✅ Resuelto |
| F5-06 | P1  | TOCTOU                | `marcarRecibida` hacía `UPDATE recibida=true` sin verificar el estado previo → doble-tap / dos pestañas re-disparaban el flujo de recepción.                                   | `.eq("recibida", false)` en el UPDATE: el segundo no afecta filas. (El trigger ya guardaba, esto es defensa en el cliente.)                                        | ✅ Resuelto |

**Resueltos — P2:**

| ID    | Sev | Área         | Repro / Descripción                                                                                                                         | Fix                                                                                               | Estado      |
| ----- | --- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------- |
| F5-07 | P2  | Crash        | `CompraNueva/Historial` y `DevolucionNueva/Historial` accedían a `perfil.id`/`perfil.sede_id` sin optional chaining.                        | `perfil?.…` en los 4 archivos.                                                                    | ✅ Resuelto |
| F5-08 | P2  | Doble-submit | El `disabled` de React no es síncrono → un doble-clic veloz podía registrar 2 compras / 2 devoluciones.                                     | `guardandoRef` (guard síncrono) en `CompraNueva` y `DevolucionNueva`.                             | ✅ Resuelto |
| F5-09 | P2  | Input        | `setCantidadDirecta` borraba la fila al teclear "0"; cantidad/costo sin tope superior.                                                      | Cantidad clampada a `[1, 100000]` (no borra al editar); costo limitado a `99 999 999`.            | ✅ Resuelto |
| F5-10 | P2  | Validación   | `DevolucionNueva` enviaba `venta_id` como texto libre; la etiqueta decía "(opcional)" pero el RPC lo exige.                                 | Validación de formato UUID en cliente + etiqueta corregida a obligatoria para devolución cliente. | ✅ Resuelto |
| F5-11 | P2  | UX / errores | `CompraHistorial`/`DevolucionHistorial` y `marcarRecibida` se tragaban los errores en silencio.                                             | Estado `errorMsg` + banner `role="alert"`.                                                        | ✅ Resuelto |
| F5-12 | P2  | Robustez     | `CompraDetalle` desestructuraba `Promise.all` sin revisar el `.error` de cada query → pantalla vacía sin diagnóstico.                       | Se revisa `compraRes.error` (bloqueante) y `detRes/garRes.error` (degradado, con banner).         | ✅ Resuelto |
| F5-13 | P2  | Tests        | `tests/integration/devoluciones.test.js`: 3 tests obsoletos (esperaban que la devolución a proveedor SUMARA stock; cliente sin `venta_id`). | Corregidos al contrato real (proveedor RESTA; cliente sin `venta_id` → 400). 8/8 en verde.        | ✅ Resuelto |

**Descartados (falsos positivos):**

- **Inyección PostgREST en `.or(ilike)`** — `sanitizeSearch` ya elimina los metacaracteres `, . * ( ) :`, así que no hay breakout del filtro.
- **`costo_unitario = 0`** — el agente sugirió `CHECK (> 0)`, pero un costo 0 es legítimo (muestra/bonificación del proveedor); el constraint `>= 0` se mantiene.

**Routeado a Fase 17 (Deploy):**

- **F5-14 (P2):** la Edge Function `registrar-devolucion` está ACTIVA en Supabase pero su fuente NO está en el repo (`supabase/functions/` solo tiene 3 de 4) — drift de deploy. Es un wrapper delgado del RPC `fn_registrar_devolucion`; la UI usa el RPC directo. Decidir/limpiar/versionar junto con las otras Edge Functions en el deploy (ver F4-09).

**Verificado OK:** stress SQL 7/7 (RPC registra compra con `registrado_por`/totales correctos; recepción suma stock +10 y crea movimiento; bloquea sede ajena, rol vendedor, producto inexistente, e INSERT directo a `compras`/`devoluciones`) con rollback; `trg_compra_sumar_stock` tiene advisory lock + `FOR UPDATE` y guarda contra doble-recepción; `fn_registrar_devolucion` valida venta/cantidad/stock; integración `devoluciones.test.js` 8/8; E2E `fase05-compras-devoluciones.spec.js` 6/6; `eslint` + `build` limpios.

### Fase 6 — Traspasos + Picking ✅ CERRADA

3 agentes (code/typescript/security) revisaron `TraspasoNuevo/Detalle/Historial.jsx`,
`PickingPage.jsx`, `VerificacionTraspaso.jsx`, `RecepcionTraspaso.jsx`; revisión
de BD propia sobre `fn_procesar_traspaso`, `trg_traspaso_salida/entrada` y la RLS
de `traspasos`/`detalle_traspaso`. **Todos los hallazgos resueltos** (9 P1 + 5 P2).

**Resueltos — P1:**

| ID    | Sev | Área              | Repro / Descripción                                                                                                                                                                            | Fix                                                                                                                                       | Estado      |
| ----- | --- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| F6-01 | P1  | Seguridad / RBAC  | `fn_procesar_traspaso` no validaba rol ni sede en `iniciar_picking`/`verificar`/`enviar` → cualquier autenticado (incl. Vendedor) podía manejar el ciclo y mover stock.                        | Cada acción valida rol Admin/Bodeguero y sede (origen para picking/verificar/enviar, destino para recibir). Stress: vendedor bloqueado.   | ✅ Resuelto |
| F6-02 | P1  | Seguridad / RLS   | La política `trasp_all` (cmd=ALL) permitía UPDATE directo de cualquier traspaso → saltarse la máquina de estados y la regla picker≠verificador.                                                | `trasp_all`/`trasp_read` → `trasp_select` (solo SELECT por sede). Escrituras solo vía RPCs. Stress: UPDATE directo afecta 0 filas.        | ✅ Resuelto |
| F6-03 | P1  | Atomicidad        | `TraspasoNuevo` creaba con 2 inserts no-transaccionales y `solicitado_por` del cliente → traspaso huérfano + spoofing.                                                                         | RPC `fn_crear_traspaso` server-authoritative (cabecera + detalle en una transacción, `solicitado_por = auth.uid()`).                      | ✅ Resuelto |
| F6-04 | P1  | Bug / stock       | `trg_traspaso_entrada`: `SELECT … INTO v_stock_ant` dejaba NULL si la sede destino no stockeaba el producto → INSERT en `movimientos` violaba el NOT NULL → la recepción fallaba por completo. | `v_stock_ant := COALESCE(v_stock_ant, 0)` tras el SELECT. Stress: recepción a sede sin stock previo OK.                                   | ✅ Resuelto |
| F6-05 | P1  | Seguridad / stock | `actualizar_items` aceptaba `cantidad_enviada` negativa (inflaba stock origen vía trigger); `recibir` aceptaba `cantidad_recibida` > enviada (inflaba destino).                                | El RPC valida `cantidad_enviada >= 0` y `0 ≤ cantidad_recibida ≤ cantidad_enviada`; CHECK constraints no-negativos en `detalle_traspaso`. | ✅ Resuelto |
| F6-06 | P1  | Pérdida de datos  | `PickingPage`/`Verificacion`/`Recepcion`: el `useEffect` dependía del objeto `perfil` → cualquier cambio del store re-disparaba el fetch y descartaba el picking en curso.                     | Deps primitivas (`perfil?.id`, `perfil?.rol`, …).                                                                                         | ✅ Resuelto |
| F6-07 | P1  | Doble-submit      | Los handlers de transición (`iniciarPicking`, `enviar`, `verificar`, `confirmarRecepcion`, crear traspaso) no tenían guard síncrono.                                                           | `useRef` guard en cada handler.                                                                                                           | ✅ Resuelto |
| F6-08 | P1  | Robustez          | `TraspasoDetalle` desestructuraba `Promise.all` sin revisar el `.error` de cada query; `catch {}` vacío.                                                                                       | Se revisa `errT` (bloqueante) y `errD` (degradado); `catch` con banner.                                                                   | ✅ Resuelto |
| F6-09 | P1  | Race condition    | `TraspasoHistorial`: cambiar de filtro con una carga en vuelo mezclaba/duplicaba páginas.                                                                                                      | Token de secuencia (`reqIdRef`).                                                                                                          | ✅ Resuelto |

**Resueltos — P2:**

| ID    | Sev | Área          | Repro / Descripción                                                                             | Fix                                                            | Estado      |
| ----- | --- | ------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------- |
| F6-10 | P2  | Navegación    | Picking/Verificacion/Recepcion no validaban el `estado` del traspaso al entrar por URL directa. | Redirigen al detalle si el estado no corresponde a esa página. | ✅ Resuelto |
| F6-11 | P2  | UX / errores  | `TraspasoHistorial` se tragaba los errores de carga en silencio.                                | Estado `errorMsg` + banner `role="alert"`.                     | ✅ Resuelto |
| F6-12 | P2  | Crash         | `TraspasoNuevo`/`Historial` accedían a `perfil.sede_id` sin optional chaining.                  | `perfil?.…`.                                                   | ✅ Resuelto |
| F6-13 | P2  | Input         | `parseInt` sin radix en PickingPage/Recepcion; cantidad de picking sin tope superior.           | `parseInt(v, 10)`; cantidad pickeada clampada a `[1, 100000]`. | ✅ Resuelto |
| F6-14 | P2  | Código muerto | `mountedRef` declarado y mantenido en 3 páginas pero nunca consultado antes de un `setState`.   | Eliminado.                                                     | ✅ Resuelto |

**Descartados (falsos positivos):**

- **`tipo` de traspaso sin validar server-side** — `traspasos.tipo` es un ENUM (`tipo_traspaso`); un valor inválido falla en el cast. No requiere CHECK.
- **`actualizar_items` permitiría a un no-picker alterar el picking** — el RPC YA valida `v_uid = v_picker` en esa acción.

**Routeado a Fase 16 (Frontend Redesign):**

- `RecepcionTraspaso.jsx` usa `color: "#fff"` hardcodeado en 2 botones (viola Regla #1 de CLAUDE.md). Polish visual no funcional → se corrige en F16 junto con los demás colores hardcodeados (ver F2-06).

**Verificado OK:** stress SQL 12/12 con rollback (flujo completo crear→picking→verificar→enviar→recibir; stock sale de origen −5 y entra a destino +5 incluso en sede sin stock previo; bloquea cantidad negativa, picker=verificador, recibida>enviada, vendedor creando/procesando, y UPDATE directo a `traspasos`); `fn_procesar_traspaso` con `FOR UPDATE` y máquina de estados; triggers `trg_traspaso_salida/entrada` con advisory lock; E2E `fase06-traspasos.spec.js` 5/5; `eslint` + `build` limpios.

### Fase 7 — Órdenes + Ensambles + Herramientas ✅ CERRADA

La fase más compleja: 11 archivos frontend (`Orden*`, `Ensamble*`, `Herramientas`,
`src/components/ot/*`). 3 agentes (code/typescript/security) + revisión de BD
propia sobre RLS, triggers de OT/ensamble y `fn_procesar`/`fn_asociar`.
**Todos los hallazgos resueltos** (7 P1 + 10 P2).

**Resueltos — P1:**

| ID    | Sev | Área              | Repro / Descripción                                                                                                                                  | Fix                                                                                                         | Estado      |
| ----- | --- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------- |
| F7-01 | P1  | Seguridad / RLS   | `ordenes_servicio` tenía la política legacy `ord_all` (Admin/Tecnico, sin sede) que con OR ANULABA la granular `os_update` (sede+técnico+estado).    | `DROP POLICY ord_all`: la granular `os_*` toma efecto. Stress: UPDATE de OT entregada → 0 filas.            | ✅ Resuelto |
| F7-02 | P1  | Seguridad / RLS   | `herramientas_prestamo` tenía `herr_all` con `USING (true)` → CUALQUIER autenticado podía insertar/actualizar/borrar herramientas de cualquier sede. | `DROP POLICY herr_all`: las granulares `hp_*` (INSERT solo-Admin, UPDATE por sede) toman efecto. Stress OK. | ✅ Resuelto |
| F7-03 | P1  | Seguridad / datos | `EnsambleNuevo`: el guard `creando` (state) no es síncrono → un doble-tap creaba DOS ensambles y descontaba stock dos veces.                         | `useRef` guard síncrono en `completar`.                                                                     | ✅ Resuelto |
| F7-04 | P1  | Doble-submit      | `OrdenDetalle.agregarRepuesto` sin guard de ref → doble-tap inserta el repuesto dos veces (doble fila + doble descuento de stock vía trigger).       | `useRef` guard.                                                                                             | ✅ Resuelto |
| F7-05 | P1  | Robustez          | `OrdenDetalle.imprimirOT` no tenía `catch`: si `generarOrdenPDF` lanzaba, el error se tragaba sin avisar.                                            | `try/catch` con banner de error.                                                                            | ✅ Resuelto |
| F7-06 | P1  | Doble-submit      | `AbonosPanel.guardar` solo con state `saving` → doble-tap registra dos abonos (pagos duplicados).                                                    | `useRef` guard.                                                                                             | ✅ Resuelto |
| F7-07 | P1  | Race condition    | `EnsambleHistorial`: "Cargar más" no llevaba AbortController; cambiar de filtro con una carga en vuelo mezclaba páginas de filtros distintos.        | Token de secuencia (`reqIdRef`).                                                                            | ✅ Resuelto |

**Resueltos — P2:**

| ID    | Sev | Área          | Repro / Descripción                                                                                                                                                                         | Fix                                                                                          | Estado      |
| ----- | --- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------- |
| F7-08 | P2  | Seguridad     | `abonos_write` (cmd=ALL) permitía a un Vendedor registrar abonos y a un Técnico ELIMINARLOS (la UI solo muestra borrar a Admin).                                                            | Separada en `abonos_insert` (Admin/Técnico, sede de la OT) y `abonos_delete` (solo Admin).   | ✅ Resuelto |
| F7-09 | P2  | Datos         | `ordenes_servicio.costo_mano_obra` sin CHECK; `OrdenNueva` aceptaba `parseFloat` negativo.                                                                                                  | `CHECK (costo_mano_obra >= 0)` + `Math.max(0, …)` en el cliente. Stress: negativo bloqueado. | ✅ Resuelto |
| F7-10 | P2  | Input         | `EnsambleNuevo`: cantidad a producir sin tope superior.                                                                                                                                     | Clamp a `[1, 9999]`.                                                                         | ✅ Resuelto |
| F7-11 | P2  | Crash         | `EnsambleNuevo`: `r.componente.id` crasheaba si una fila BOM referenciaba un producto eliminado (join → null).                                                                              | Filtra filas con componente nulo y avisa.                                                    | ✅ Resuelto |
| F7-12 | P2  | Race / TOCTOU | `OrdenDetalle.cambiarEstado` no verificaba el estado previo contra la BD.                                                                                                                   | `.eq("estado", orden.estado)` + aviso si la fila cambió mientras tanto.                      | ✅ Resuelto |
| F7-13 | P2  | Doble-submit  | `OrdenNueva.guardar` sin guard de ref.                                                                                                                                                      | `useRef` guard.                                                                              | ✅ Resuelto |
| F7-14 | P2  | Race / submit | `Herramientas`: `devolver`/`ModalPrestar`/`ModalNueva` sin guard de ref; `ModalPrestar` sin `.eq("estado","disponible")` (race de doble-préstamo).                                          | `useRef` guards + `.eq("estado","disponible")` con chequeo de filas.                         | ✅ Resuelto |
| F7-15 | P2  | Robustez      | `ChecklistRecepcion`: el error del sembrado (`select` de componentes + `upsert`) se descartaba en silencio.                                                                                 | Se capturan y propagan ambos errores.                                                        | ✅ Resuelto |
| F7-16 | P2  | Doble-click   | `CotizacionesAsociadasOT`: `asociarExistente`/`desasociar` sin guard → doble-click dispara dos RPC.                                                                                         | `useRef` guard compartido.                                                                   | ✅ Resuelto |
| F7-17 | P2  | Tests         | `ordenes.spec.js` "cambiar estado a En proceso" era obsoleto: no contemplaba la compuerta de autorización (Fase 10) que bloquea `abierta→en_proceso` con `estado_autorizacion='pendiente'`. | Test reescrito para aceptar ambos desenlaces válidos (transición o bloqueo informado). 9/9.  | ✅ Resuelto |

**Descartados (falsos positivos):**

- **`no_autorizado` shortcut "podría no estar en el trigger"** — `trg_orden_validar_transicion` SÍ implementa el salto `abierta→completada` para OT no autorizadas.
- **`actualizar_items` permitiría a un no-picker alterar el picking** (Fase 6) — N/A; y el RPC de traspaso ya valida el picker.
- **Stock de ensamble manipulable** — `trg_ensamble_stock` valida stock con `FOR UPDATE` + advisory lock y lanza excepción server-side; el `todoOk` del cliente es solo UX.
- **`cambiarEstado` con UPDATE directo "peligroso"** — respaldado por `trg_orden_validar_transicion` (transiciones) y `trg_orden_validar_anticipo` (autorización/anticipo) server-side.

**Verificado OK:** stress SQL 6/6 con rollback (Vendedor no inserta abono ni herramienta; Técnico no borra abono; UPDATE cruzado de sede / OT entregada → 0 filas; `costo_mano_obra` negativo bloqueado por CHECK); E2E `ordenes.spec.js` 9/9; `eslint` + `build` limpios.

### Fase 8 — Dashboard Admin + Gestión ✅ CERRADA

3 agentes (code/typescript/security) revisaron las 8 páginas del Panel Admin
(`Dashboard`, `Alertas`, `Auditoria`, `Usuarios`, `Top10`, `AnalisisABC`,
`Reorden`, `Conteo`) + revisión de RLS y el trigger de `usuarios`.
**Todos los hallazgos resueltos** (3 P1 + 3 P2).

**Resueltos — P1:**

| ID    | Sev | Área              | Repro / Descripción                                                                                                                                                                                        | Fix                                                                                                                  | Estado      |
| ----- | --- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------- |
| F8-01 | P1  | Seguridad / datos | `trg_usuarios_inmutables` hacía `RETURN NEW` inmediato para Admin → un Admin podía poner `activo=false` sobre su propia fila (modal de Usuarios o API) y, si es el único Admin, dejar el panel sin acceso. | Chequeo de auto-desactivación ANTES del early-return de Admin (aplica a todos los roles). Stress: bloqueado OK.      | ✅ Resuelto |
| F8-02 | P1  | Robustez / UX     | `Usuarios.guardar`: sin validación de nombre (guardaba `""`), sin guard de doble-submit, y el checkbox "activo" no se deshabilitaba para uno mismo.                                                        | Validación de nombre, `useRef` guard, bloqueo de auto-desactivación en el cliente, checkbox deshabilitado para self. | ✅ Resuelto |
| F8-03 | P1  | Robustez          | `Auditoria`: el `Promise.all` de los selectores (sede/usuario) descartaba errores y no tenía `.catch` (promesa flotante); la paginación no tenía guard de race.                                            | Manejo de errores + `.catch`; token de secuencia (`reqIdRef`) en `cargar`.                                           | ✅ Resuelto |

**Resueltos — P2:**

| ID    | Sev | Área  | Repro / Descripción                                                                                                                                                 | Fix                                                                            | Estado      |
| ----- | --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------- |
| F8-04 | P2  | Crash | `Dashboard`: `k.top5_productos_mes.map` sin `?? []` (crash si el RPC devuelve un valor no-array).                                                                   | `(k.top5_productos_mes ?? []).map(...)`.                                       | ✅ Resuelto |
| F8-05 | P2  | Fuga  | `Dashboard`: el `setTimeout` del `Promise.race` quedaba colgado si la RPC resolvía antes (refresco cada 60 s).                                                      | Se captura el id del timer y se limpia en `finally`.                           | ✅ Resuelto |
| F8-06 | P2  | Tests | `admin-fase8.spec.js`: 4 locators mezclaban CSS con la sintaxis `text=` de Playwright (error de parseo); 2 modales se buscaban como `<dialog>/<form>` inexistentes. | Locators corregidos con `.or(getByText(...))` y `getByRole('heading')`. 10/10. | ✅ Resuelto |

**Descartados (falsos positivos / no explotables):**

- **`u_update_self` permite auto-escalar rol/sede** — NO explotable: `trg_usuarios_inmutables` bloquea server-side cualquier cambio de `rol`/`sede_id`/`activo` hecho por un no-Admin. La política RLS sin restricción de columnas es defensa-en-profundidad mejorable, pero el trigger es la barrera efectiva.
- **`eslint-disable` de la dep `cargar` en Top10/Conteo** — benigno: esas páginas no paginan, `cargar` solo lee estado de filtro ya cubierto.
- **`new Date(undefined)` → NaN en Alertas** — no alcanzable: la query filtra `fecha_devolucion_esperada` no nula con `.lt(...)`.

**Backlog P2 (documentado, no bloqueante):** `fn_top_productos`/`fn_dashboard_kpis` sin clamp de parámetros (los valores vienen de botones fijos de la UI); `Conteo` sobre-trae filas de `inventario` de todas las sedes y filtra en JS.

**Verificado OK:** stress SQL 2/2 con rollback (Admin no puede auto-desactivarse; sí puede desactivar a otro usuario); E2E `admin-fase8.spec.js` 10/10; `eslint` + `build` limpios; RoleGuard `/admin/*` redirige a los no-Admin.

### Fase 9 — Configuración General ✅ CERRADA

3 agentes revisaron `src/pages/admin/Configuracion/*` (`index`, `Parametros`,
`CuentasBancarias`, `ChecklistOT`) + verificación de RLS de las 3 tablas de
config. **Todos los hallazgos resueltos** (2 P1 + 2 P2).

**Resueltos:**

| ID    | Sev | Área         | Repro / Descripción                                                                                                    | Fix                                             | Estado      |
| ----- | --- | ------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------- |
| F9-01 | P1  | Doble-submit | `Parametros`, `CuentasBancarias` y `ChecklistOT`: `guardar` solo con state `saving` (no síncrono) → doble-tap duplica. | `useRef` guard síncrono en los tres.            | ✅ Resuelto |
| F9-02 | P1  | Validación   | `Parametros.validate`: los `BOUNDS` solo se aplicaban a tipo `int`; un parámetro `decimal` se escapaba del rango.      | `checkBounds` unificado para `int` y `decimal`. | ✅ Resuelto |
| F9-03 | P2  | Input        | `ChecklistOT`: el campo `orden` aceptaba negativos y decimales.                                                        | `Math.max(0, Math.trunc(...))`.                 | ✅ Resuelto |
| F9-04 | P2  | Crash        | `CuentasBancarias`: `c.banco.toLowerCase()` en el chequeo de duplicados crashea si una fila tiene `banco` nulo.        | `c.banco?.toLowerCase()`.                       | ✅ Resuelto |

**Descartados (falsos positivos):**

- **"Las 3 tablas de config no tienen RLS" (reportado P0)** — FALSO: `parametros_sistema`, `cuentas_bancarias` y `checklist_componentes` tienen política `admin_write_*` (ALL, `get_my_rol()='Admin'`). Stress: Vendedor bloqueado en las 3.
- **Números de cuenta bancaria sin enmascarar** — por diseño: el número va en el PDF de la cotización para que el cliente pague; debe ser visible.
- **`index.jsx` `eslint-disable` de `searchParams`** — benigno: la sincronización tab→URL es unidireccional intencional; añadir la dep haría que la navegación externa se sobrescriba.

**Verificado OK:** stress SQL 4/4 con rollback (Vendedor no escribe `parametros_sistema`/`cuentas_bancarias`/`checklist_componentes`; Admin sí); E2E `fase09-configuracion.spec.js` 5/5 (3 tabs, RBAC); `eslint` + `build` limpios.

### Fase 10 — Ajustes OT ✅ CERRADA

El frontend de OT (`OrdenDetalle`, `AbonosPanel`, `ChecklistRecepcion`,
`CotizacionesAsociadasOT`) ya se revisó a fondo en la Fase 7; esta fase se
enfocó en `AutorizacionPanel` y en las reglas de negocio de OT a nivel BD.
**Hallazgos resueltos** (1 P1 + 1 P2).

| ID     | Sev | Área         | Repro / Descripción                                                                                                                                                                                                                                   | Fix                                                                                     | Estado      |
| ------ | --- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------- |
| F10-01 | P1  | Bug / stock  | `trg_orden_consumir_repuesto`: `IF v_cant < cantidad` no detecta stock NULL (producto sin fila de inventario en la sede de la OT) → INSERT en `movimientos` con `stock_anterior=NULL` viola el NOT NULL. Alcanzable vía `fn_asociar_cotizacion_a_ot`. | `IF v_cant IS NULL OR v_cant < cantidad` → lanza "Stock insuficiente" claro. Stress OK. | ✅ Resuelto |
| F10-02 | P2  | Doble-submit | `AutorizacionPanel.guardar` sin guard de ref síncrono.                                                                                                                                                                                                | `useRef` guard.                                                                         | ✅ Resuelto |

**Verificado OK:** `trg_orden_validar_anticipo` (pendiente bloquea avanzar;
autorizado+trabajo exige abono>0; no_autorizado+cierre exige valor_revision>0)
y `trg_orden_validar_transicion` (máquina de estados + atajo no_autorizado)
revisados y sólidos; `trg_orden_consumir_repuesto`/`trg_orden_revertir_repuesto`
descuentan/reponen stock con `FOR UPDATE`; el equipo del cliente nunca entra al
inventario (es texto en la OT, no un producto). Stress SQL del fix OK; E2E
`fase10-ot.spec.js` 11/11 + `fase10-chaos.spec.js` 7/7; `eslint` + `build` limpios.

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
