# QA Campaign Log — Compresores del Valle

> Registro maestro de la campaña de QA end-to-end fase por fase (Fase 0 → 15).
> Plan: `C:\Users\davi-\.claude\plans\planea-bien-como-lo-cryptic-pancake.md`.
> Severidad: **P0** bloquea la fase · **P1** se arregla en la fase · **P2** backlog.

## Estado por fase

| Fase | Tema                                 | Estado       | Hallazgos (P0/P1/P2) | Commit                |
| ---- | ------------------------------------ | ------------ | -------------------- | --------------------- |
| 0    | Setup                                | ✅ Cerrada   | 0 / 3 / 4            | (ver commit qa fase0) |
| 1    | Base de datos                        | ✅ Cerrada   | 0 / 3 / 8            | (ver commit qa fase1) |
| 2    | Login + Layout + Roles               | 🟡 En curso  | —                    | —                     |
| 3    | Inventario + QR + Realtime           | ⏳ Pendiente | —                    | —                     |
| 4    | Ventas + Cotizaciones                | ⏳ Pendiente | —                    | —                     |
| 5    | Compras + Devoluciones               | ⏳ Pendiente | —                    | —                     |
| 6    | Traspasos + Picking                  | ⏳ Pendiente | —                    | —                     |
| 7    | Órdenes + Ensambles + Herramientas   | ⏳ Pendiente | —                    | —                     |
| 8    | Dashboard Admin                      | ⏳ Pendiente | —                    | —                     |
| 9    | Configuración General                | ⏳ Pendiente | —                    | —                     |
| 10   | Ajustes OT                           | ⏳ Pendiente | —                    | —                     |
| 11   | Ajustes Cotizaciones                 | ⏳ Pendiente | —                    | —                     |
| 12   | Ajustes Inventario/Compras/Traspasos | ⏳ Pendiente | —                    | —                     |
| 13   | Garantías                            | ⏳ Pendiente | —                    | —                     |
| 14   | Recibos manuales                     | ⏳ Pendiente | —                    | —                     |
| 15   | Dashboard + Cierres                  | ⏳ Pendiente | —                    | —                     |

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

## Backlog (P2 sin resolver)

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
