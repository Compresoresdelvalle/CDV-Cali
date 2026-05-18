# 🔄 RETOMAR AQUÍ — Campaña de QA fase por fase

> **Léeme apenas se compacte el contexto.** Resume qué estamos haciendo, cómo,
> y por dónde vamos. Última actualización: **2026-05-17**.

## Qué estamos haciendo

Campaña de **QA exhaustiva fase por fase** de la app Compresores del Valle
(React 18 + Vite + Tailwind + Zustand + Supabase). Se revisan las 16 fases
(0→15), una por una, buscando bugs y reforzando seguridad, y **se arregla todo
lo que se encuentra en el momento**.

- **Plan maestro:** `C:\Users\davi-\.claude\plans\planea-bien-como-lo-cryptic-pancake.md`
- **Registro de hallazgos:** `docs/QA-CAMPAIGN-LOG.md` (tabla de estado por fase + hallazgos + backlog).
- **Worktree:** rama `claude/stupefied-wescoff-93d5df`. Se commitea y mergea a `main` **por fase**.

## Por dónde vamos

| Fases                          | Estado                               |
| ------------------------------ | ------------------------------------ |
| 0, 1, 2, 3, 4                  | ✅ **Cerradas** y mergeadas a `main` |
| **5 — Compras + Devoluciones** | ⏭️ **SIGUIENTE**                     |
| 6 → 15                         | ⏳ Pendientes                        |

Último commit en `main`: `1b9d27c` (cierre de Fase 4). Working tree limpio.

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

- **Fase 11:** F4-08 — `CotizacionEditar` guarda con `DELETE`+`INSERT` no transaccional → mover a un RPC transaccional.
- **Fase 16:** polish de a11y/táctil de varias pantallas (botones 48px, focus rings, roles ARIA).
- **Fase 17:** F0-06 (CSP en `netlify.toml`), F4-09 (Edge Functions `registrar-venta`/`convertir-cotizacion` posible código muerto + CORS `*`).
- **Backlog P2** general: ver sección "Backlog" en `docs/QA-CAMPAIGN-LOG.md` (consolidación de RLS, índices de FK, etc.).

## Siguiente acción concreta

Arrancar **QA Fase 5 (Compras + Devoluciones)**: leer la sección Fase 5 de
`fases/FASE-04-AL-09-MODULOS.md`, lanzar los 3-4 agentes de revisión sobre
`CompraNueva/Detalle/Historial.jsx`, `DevolucionNueva/Historial.jsx`, el
trigger `trg_compra_sumar_stock` y `fn_registrar_devolucion`; crear
`tests/e2e/fase05-compras-devoluciones.spec.js`; arreglar lo encontrado;
commit `qa(fase5)` + merge.
