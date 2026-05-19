# 🔄 RETOMAR AQUÍ — Campaña de QA fase por fase

> **Léeme apenas se compacte el contexto.** Resume qué estamos haciendo, cómo,
> y por dónde vamos. Última actualización: **2026-05-18**.

## Qué estamos haciendo

Campaña de **QA exhaustiva fase por fase** de la app Compresores del Valle
(React 18 + Vite + Tailwind + Zustand + Supabase). Se revisan las 16 fases
(0→15), una por una, buscando bugs y reforzando seguridad, y **se arregla todo
lo que se encuentra en el momento**.

- **Plan maestro:** `C:\Users\davi-\.claude\plans\planea-bien-como-lo-cryptic-pancake.md`
- **Registro de hallazgos:** `docs/QA-CAMPAIGN-LOG.md` (tabla de estado por fase + hallazgos + backlog).
- **Worktree:** rama `claude/stupefied-wescoff-93d5df`. Se commitea y mergea a `main` **por fase**.

## Por dónde vamos

| Fases                        | Estado                               |
| ---------------------------- | ------------------------------------ |
| 0 … 14                       | ✅ **Cerradas** y mergeadas a `main` |
| **15 — Dashboard + Cierres** | ⏭️ **SIGUIENTE (última)**            |

Fase 14 cerrada: 4 P1 + 3 P2 resueltos. F14-01: `fn_registrar_recibo`
insertaba subtotal/total/abonos_previos/saldo del cliente → ahora se recalculan
server-side. F14-02/03 (RBAC): `sede_id` y la OT/cotización vinculadas no se
validaban contra la sede → un Vendedor podía operar en otra sede. F14-04:
`fn_anular_recibo` sin check de sede. F14-05: guard anti doble-submit. F14-06:
IVA sin acotar en el frontend. F14-07: PDF sin try/catch + setState tras
desmontaje. Stress SQL 5/5; E2E `fase14-recibos` 4/4 (1 test obsoleto
corregido). Fase 15 ya fue auditada al inicio de la campaña — falta cerrar el
ciclo formal de QA.

## Plantilla por fase (seguir IGUAL en cada una)

1. **Preparar:** leer `fases/FASE-XX-*.md` (criterios de aceptación) + `CLAUDE.md`. Marcar la tarea de esa fase como `in_progress`.
2. **Agentes en paralelo** (un solo mensaje, varios `Agent`): `code-reviewer`, `everything-claude-code:typescript-reviewer`, `everything-claude-code:security-reviewer`; sumar `everything-claude-code:database-reviewer` en fases con SQL y `everything-claude-code:architect`/`backend-architect` en fases estructurales.
3. **Tests automáticos aislados:** E2E `npx playwright test tests/e2e/<spec> --workers=1` (NUNCA toda la suite). Stress SQL en bloque `DO $$ ... RAISE EXCEPTION 'STRESS_REPORT ...' $$` (el RAISE final hace rollback, sin residuo). Gate: `npx eslint src/` + `npm run build`.
4. **Tests manuales** con las preview tools del navegador (login Carlos PIN 0001).
5. **Triar** P0/P1/P2 y **arreglar todo bug/error real** (ver regla abajo).
6. **Cerrar:** actualizar `docs/QA-CAMPAIGN-LOG.md`, commit `qa(faseXX): ...`, merge fast-forward a `main`.

## Reglas aprendidas (CRÍTICAS — no romperlas)

- **Arreglar cada bug al encontrarlo** (P1 y P2). NO acumular backlog. Solo es válido diferir si: necesita decisión de producto, es cambio de alto riesgo que requiere pruebas no disponibles, es feature nueva, o necesita autorización del usuario (ej. tocar datos de producción). En esos casos, explicarlo explícito.
- **Verificar los hallazgos de los agentes contra el código/BD real** — varios "P0/P1" resultaron falsos positivos (los agentes leen migraciones viejas o conocimiento desactualizado: React 19/Vite 8 SON actuales; `fn_convertir_cotizacion` y `movimientos` append-only ya estaban bien). Confirmar antes de "arreglar".
- **Polish de UI no funcional** (touch 48px, focus rings, `aria`) → routear a la **Fase 16 (rediseño)**, no arreglar en sitio.
- **Migraciones:** nunca editar una aplicada; cada fix SQL va en una migración nueva con timestamp, vía `apply_migration` (MCP supabase).
- **No saturar Supabase free-tier:** E2E un spec a la vez, `--workers=1`. Stress SQL siempre con rollback.
- **Datos de producción:** la BD es compartida y real. NO modificar datos sin autorización explícita del usuario (el clasificador lo bloquea, y con razón).

## Entorno (gotchas del worktree)

- El worktree necesita `.env.local` (copiado del repo principal — gitignored).
- `vite.config.js` fija el puerto **5174** (`strictPort`); `playwright.config.js` y `.claude/launch.json` apuntan a 5174. Dev server: `npm run dev` (ya sale en 5174). Preview tool: `preview_start` name `compresores-dev`.
- Si el puerto 5174 queda ocupado por un vite huérfano: liberarlo con PowerShell `Get-NetTCPConnection -LocalPort 5174 | Stop-Process`.
- Login E2E: helper `loginUI(page, "carlos"|"pedro"|"maria")` en `tests/e2e/helpers.js`.

## Hallazgos diferidos a fases posteriores (no olvidar)

- **Fase 16:** polish de a11y/táctil de varias pantallas (botones 48px, focus rings, roles ARIA).
- **Fase 17:** F0-06 (CSP en `netlify.toml`), F4-09 (Edge Functions `registrar-venta`/`convertir-cotizacion` posible código muerto + CORS `*`).
- **Feature pendiente (no QA):** §12.12 — organización física `stand`/`piso`/`espacio` en `ubicaciones` nunca se construyó (columnas inexistentes). Es feature, queda como decisión de producto.
- **Backlog P2** general: ver sección "Backlog" en `docs/QA-CAMPAIGN-LOG.md` (consolidación de RLS, índices de FK, etc.).

## Siguiente acción concreta

Arrancar **QA Fase 15 (Dashboard + Cierres)** — última fase: leer
`fases/FASE-15-DASHBOARD-CIERRES.md`, lanzar los agentes de revisión
(code/ts/security + database) sobre Dashboard, Cierres y sus RPC. Ya hay spec
`fase15-cierres` y la fase fue endurecida al inicio de la campaña — auditar vs
criterios; arreglar lo encontrado; commit `qa(fase15)` + merge. Con esto la
campaña de QA queda completa.
