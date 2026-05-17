# QA Campaign Log — Compresores del Valle

> Registro maestro de la campaña de QA end-to-end fase por fase (Fase 0 → 15).
> Plan: `C:\Users\davi-\.claude\plans\planea-bien-como-lo-cryptic-pancake.md`.
> Severidad: **P0** bloquea la fase · **P1** se arregla en la fase · **P2** backlog.

## Estado por fase

| Fase | Tema                                 | Estado       | Hallazgos (P0/P1/P2) | Commit                |
| ---- | ------------------------------------ | ------------ | -------------------- | --------------------- |
| 0    | Setup                                | ✅ Cerrada   | 0 / 3 / 4            | (ver commit qa fase0) |
| 1    | Base de datos                        | 🟡 En curso  | —                    | —                     |
| 2    | Login + Layout + Roles               | ⏳ Pendiente | —                    | —                     |
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

## Backlog (P2 sin resolver)

- **F0-06 (P2, seguridad):** `netlify.toml` aún sin `Content-Security-Policy`. Se implementará en la **Fase 17 (deploy)**, probándola contra el sitio desplegado para no romper Supabase / cámara / PDF.
- **F0-07 (P2, config):** `eslint.config.js` con `ecmaVersion: 2020` redundante; `tests/` sin globals de lint (Node/Vitest).
- **F0-08 (P2, PWA):** faltan íconos `maskable` y `apple-touch-icon` para instalación adaptativa en iOS/Android.
- **F0-09 (P2, doc):** `CLAUDE.md` dice "React 18" pero el proyecto usa React 19. Inconsistencia de documentación (la app compila y corre bien).
