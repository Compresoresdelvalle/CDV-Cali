# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: admin-fase8.spec.js >> Admin Fase 8 >> Reorden — vista carga sin error
- Location: tests\e2e\admin-fase8.spec.js:111:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: table, ul[role="list"], text=/Sin sugerencias|No hay/i, text=/sugerencias de reorden/i >> nth=0
Expected: visible
Error: Unexpected token "=" while parsing css selector "table, ul[role="list"], text=/Sin sugerencias|No hay/i, text=/sugerencias de reorden/i". Did you mean to CSS.escape it?

Call log:
  - Expect "toBeVisible" with timeout 12000ms
  - waiting for table, ul[role="list"], text=/Sin sugerencias|No hay/i, text=/sugerencias de reorden/i >> nth=0

```

# Page snapshot

```yaml
- generic [ref=e3]:
    - complementary [ref=e5]:
        - generic [ref=e7]:
            - img [ref=e9]
            - generic [ref=e14]:
                - paragraph [ref=e15]: Panel Admin
                - paragraph [ref=e16]: Compresores del Valle
        - generic [ref=e17]:
            - paragraph [ref=e18]: Carlos Dueño
            - generic [ref=e19]: Admin
        - navigation [ref=e20]:
            - link "📊 Dashboard" [ref=e21] [cursor=pointer]:
                - /url: /admin
                - generic [ref=e22]: 📊
                - generic [ref=e23]: Dashboard
            - link "🔔 Alertas" [ref=e24] [cursor=pointer]:
                - /url: /admin/alertas
                - generic [ref=e25]: 🔔
                - generic [ref=e26]: Alertas
            - link "🔢 Conteo" [ref=e27] [cursor=pointer]:
                - /url: /admin/conteo
                - generic [ref=e28]: 🔢
                - generic [ref=e29]: Conteo
            - link "📈 Análisis ABC" [ref=e30] [cursor=pointer]:
                - /url: /admin/abc
                - generic [ref=e31]: 📈
                - generic [ref=e32]: Análisis ABC
            - link "♻️ Reorden" [ref=e33] [cursor=pointer]:
                - /url: /admin/reorden
                - generic [ref=e34]: ♻️
                - generic [ref=e35]: Reorden
            - link "🔍 Auditoría" [ref=e36] [cursor=pointer]:
                - /url: /admin/auditoria
                - generic [ref=e37]: 🔍
                - generic [ref=e38]: Auditoría
            - link "👥 Usuarios" [ref=e39] [cursor=pointer]:
                - /url: /admin/usuarios
                - generic [ref=e40]: 👥
                - generic [ref=e41]: Usuarios
            - link "🏆 Top 10" [ref=e42] [cursor=pointer]:
                - /url: /admin/top10
                - generic [ref=e43]: 🏆
                - generic [ref=e44]: Top 10
        - generic [ref=e45]:
            - link "← Volver a Operaciones" [ref=e46] [cursor=pointer]:
                - /url: /ops
                - img [ref=e47]
                - generic [ref=e49]: ← Volver a Operaciones
            - button "Cerrar sesión" [ref=e50] [cursor=pointer]:
                - img [ref=e51]
                - generic [ref=e53]: Cerrar sesión
    - generic [ref=e54]:
        - banner [ref=e55]:
            - generic [ref=e56]:
                - generic [ref=e57]: Carlos Dueño
                - generic [ref=e58]: Admin
            - generic [ref=e59]:
                - link "Operaciones" [ref=e60] [cursor=pointer]:
                    - /url: /ops
                    - img [ref=e61]
                    - generic [ref=e63]: Operaciones
                - button "Salir" [ref=e64] [cursor=pointer]:
                    - img [ref=e65]
                    - generic [ref=e67]: Salir
        - main [ref=e68]:
            - generic [ref=e69]:
                - generic [ref=e70]:
                    - generic [ref=e71]:
                        - heading "Sugerencias de reorden" [level=1] [ref=e72]
                        - paragraph [ref=e73]: 1 productos · $ 418.000 estimado
                    - button "Nueva compra" [ref=e75] [cursor=pointer]
                - table [ref=e77]:
                    - rowgroup [ref=e78]:
                        - row "Producto ABC Sede Estado Stock Mínimo Sugerido Costo estimado" [ref=e79]:
                            - columnheader "Producto" [ref=e80]
                            - columnheader "ABC" [ref=e81]
                            - columnheader "Sede" [ref=e82]
                            - columnheader "Estado" [ref=e83]
                            - columnheader "Stock" [ref=e84]
                            - columnheader "Mínimo" [ref=e85]
                            - columnheader "Sugerido" [ref=e86]
                            - columnheader "Costo estimado" [ref=e87]
                    - rowgroup [ref=e88]:
                        - row "Filtro Aire P/N 2236 FA-2236 C Almacén 01 Agotado 1 5 19 $ 418.000" [ref=e89]:
                            - cell "Filtro Aire P/N 2236 FA-2236" [ref=e90]:
                                - paragraph [ref=e91]: Filtro Aire P/N 2236
                                - paragraph [ref=e92]: FA-2236
                            - cell "C" [ref=e93]
                            - cell "Almacén 01" [ref=e94]
                            - cell "Agotado" [ref=e95]:
                                - generic [ref=e96]: Agotado
                            - cell "1" [ref=e97]
                            - cell "5" [ref=e98]
                            - cell "19" [ref=e99]
                            - cell "$ 418.000" [ref=e100]
                    - rowgroup [ref=e101]:
                        - 'row "Total estimado: $ 418.000" [ref=e102]':
                            - cell "Total estimado:" [ref=e103]
                            - cell "$ 418.000" [ref=e104]
```

# Test source

```ts
  29  |
  30  | // ─── Suite principal ─────────────────────────────────────────────────────────
  31  |
  32  | test.describe("Admin Fase 8", () => {
  33  |   test.describe.configure({ mode: "serial" }); // mantener sesión entre tests
  34  |
  35  |   test.beforeEach(async ({ page }) => {
  36  |     await loginUI(page, "carlos");
  37  |   });
  38  |
  39  |   // ── 1. Dashboard ──────────────────────────────────────────────────────────
  40  |   test("Dashboard Admin carga con cards KPI", async ({ page }) => {
  41  |     await page.goto("/admin");
  42  |     await waitForLoad(page);
  43  |
  44  |     // Título de la página
  45  |     await expect(
  46  |       page
  47  |         .locator("h1, h2")
  48  |         .filter({ hasText: /Dashboard/i })
  49  |         .first(),
  50  |     ).toBeVisible({ timeout: 15_000 });
  51  |
  52  |     // Al menos una card KPI (contiene número formateado como moneda o dígito)
  53  |     const kpiCards = page.locator(
  54  |       '[class*="rounded"], .rounded-xl, div[style*="card"]',
  55  |     );
  56  |     await expect(kpiCards.first()).toBeVisible({ timeout: 15_000 });
  57  |
  58  |     // No debe haber mensaje de error
  59  |     await expect(page.locator("text=/Error al cargar/i")).not.toBeVisible();
  60  |
  61  |     // Screenshot — Dashboard con KPIs
  62  |     await page.screenshot({
  63  |       path: "tests/e2e/screenshots/admin-dashboard.png",
  64  |       fullPage: false,
  65  |     });
  66  |   });
  67  |
  68  |   // ── 2. Alertas — 3 tabs ───────────────────────────────────────────────────
  69  |   test("Alertas — 3 tabs visibles y accesibles", async ({ page }) => {
  70  |     await page.goto("/admin/alertas");
  71  |     await waitForLoad(page);
  72  |
  73  |     // Título de página
  74  |     await expect(
  75  |       page
  76  |         .locator("h1, h2")
  77  |         .filter({ hasText: /Alerta/i })
  78  |         .first(),
  79  |     ).toBeVisible({ timeout: 12_000 });
  80  |
  81  |     // Los 3 tabs deben estar visibles
  82  |     await expect(page.locator('button:has-text("Stock bajo")')).toBeVisible({
  83  |       timeout: 10_000,
  84  |     });
  85  |     await expect(page.locator('button:has-text("Herramientas")')).toBeVisible({
  86  |       timeout: 8_000,
  87  |     });
  88  |     await expect(page.locator('button:has-text("Órdenes")')).toBeVisible({
  89  |       timeout: 8_000,
  90  |     });
  91  |
  92  |     // Screenshot — Alertas tabs
  93  |     await page.screenshot({
  94  |       path: "tests/e2e/screenshots/admin-alertas-tabs.png",
  95  |       fullPage: false,
  96  |     });
  97  |
  98  |     // Click en cada tab — no debe lanzar error
  99  |     await page.locator('button:has-text("Herramientas")').click();
  100 |     await expect(page.locator("text=/Error al cargar/i")).not.toBeVisible({
  101 |       timeout: 5_000,
  102 |     });
  103 |
  104 |     await page.locator('button:has-text("Órdenes")').click();
  105 |     await expect(page.locator("text=/Error al cargar/i")).not.toBeVisible({
  106 |       timeout: 5_000,
  107 |     });
  108 |   });
  109 |
  110 |   // ── 3. Reorden — sin error ────────────────────────────────────────────────
  111 |   test("Reorden — vista carga sin error", async ({ page }) => {
  112 |     await page.goto("/admin/reorden");
  113 |     await waitForLoad(page);
  114 |
  115 |     await expect(
  116 |       page
  117 |         .locator("h1, h2")
  118 |         .filter({ hasText: /Reorden|Sugerencias/i })
  119 |         .first(),
  120 |     ).toBeVisible({ timeout: 12_000 });
  121 |
  122 |     // Debe mostrar tabla, lista vacía o mensaje de vacío — nunca un error de crash
  123 |     await expect(
  124 |       page
  125 |         .locator(
  126 |           'table, ul[role="list"], text=/Sin sugerencias|No hay/i, text=/sugerencias de reorden/i',
  127 |         )
  128 |         .first(),
> 129 |     ).toBeVisible({ timeout: 12_000 });
      |       ^ Error: expect(locator).toBeVisible() failed
  130 |
  131 |     await expect(page.locator("text=/Error al cargar/i")).not.toBeVisible();
  132 |   });
  133 |
  134 |   // ── 4. Top10 — cambio de período ─────────────────────────────────────────
  135 |   test("Top10 — cambiar período 7d/30d/90d/1y recarga sin error", async ({
  136 |     page,
  137 |   }) => {
  138 |     await page.goto("/admin/top10");
  139 |     await waitForLoad(page);
  140 |
  141 |     await expect(
  142 |       page
  143 |         .locator("h1, h2")
  144 |         .filter({ hasText: /Top|10/i })
  145 |         .first(),
  146 |     ).toBeVisible({ timeout: 12_000 });
  147 |
  148 |     // Los botones de período deben existir
  149 |     const periodos = ["7d", "30d", "90d", "1y"];
  150 |     for (const p of periodos) {
  151 |       const btn = page.locator(`button:has-text("${p}")`);
  152 |       if ((await btn.count()) > 0) {
  153 |         await btn.first().click();
  154 |         await waitForLoad(page, 8_000);
  155 |         await expect(page.locator("text=/Error al cargar/i")).not.toBeVisible({
  156 |           timeout: 5_000,
  157 |         });
  158 |       }
  159 |     }
  160 |
  161 |     await expect(
  162 |       page.locator('ul[role="list"], table, text=/Sin ventas|No hay/i').first(),
  163 |     ).toBeVisible({ timeout: 10_000 });
  164 |   });
  165 |
  166 |   // ── 5. Análisis ABC — cards + filtro ─────────────────────────────────────
  167 |   test("Análisis ABC — 3 cards A/B/C y filtro funciona", async ({ page }) => {
  168 |     await page.goto("/admin/abc");
  169 |     await waitForLoad(page);
  170 |
  171 |     await expect(
  172 |       page
  173 |         .locator("h1, h2")
  174 |         .filter({ hasText: /ABC|Análisis/i })
  175 |         .first(),
  176 |     ).toBeVisible({ timeout: 12_000 });
  177 |
  178 |     // Los 3 botones/cards de clasificación A, B, C deben estar presentes
  179 |     await expect(
  180 |       page.locator('button:has-text("A"), text=/Clase A/i').first(),
  181 |     ).toBeVisible({ timeout: 10_000 });
  182 |     await expect(
  183 |       page.locator('button:has-text("B"), text=/Clase B/i').first(),
  184 |     ).toBeVisible({ timeout: 8_000 });
  185 |     await expect(
  186 |       page.locator('button:has-text("C"), text=/Clase C/i').first(),
  187 |     ).toBeVisible({ timeout: 8_000 });
  188 |
  189 |     // Clic en filtro "A" — lista debe cambiar (no error)
  190 |     const filtroA = page.locator('button:has-text("A")').first();
  191 |     await filtroA.click();
  192 |     await waitForLoad(page, 6_000);
  193 |     await expect(page.locator("text=/Error/i")).not.toBeVisible({
  194 |       timeout: 4_000,
  195 |     });
  196 |
  197 |     // Volver a "Todos"
  198 |     const filtroTodos = page.locator('button:has-text("Todos")');
  199 |     if ((await filtroTodos.count()) > 0) {
  200 |       await filtroTodos.first().click();
  201 |     }
  202 |   });
  203 |
  204 |   // ── 6. Auditoría — tabla + filtros ───────────────────────────────────────
  205 |   test("Auditoría — tabla movimientos y filtros visibles", async ({ page }) => {
  206 |     await page.goto("/admin/auditoria");
  207 |     await waitForLoad(page);
  208 |
  209 |     await expect(
  210 |       page
  211 |         .locator("h1, h2")
  212 |         .filter({ hasText: /Auditor|Movimiento/i })
  213 |         .first(),
  214 |     ).toBeVisible({ timeout: 12_000 });
  215 |
  216 |     // Tabla (desktop) o lista mobile debe estar presente
  217 |     await expect(
  218 |       page
  219 |         .locator('table, ul[role="list"], text=/Sin movimientos|No hay/i')
  220 |         .first(),
  221 |     ).toBeVisible({ timeout: 15_000 });
  222 |
  223 |     // Filtros — al menos uno de tipo select o input debe estar
  224 |     const filtros = page.locator(
  225 |       'select, input[type="date"], input[placeholder*="buscar"]',
  226 |     );
  227 |     // No forzamos count > 0; si existen, interactuamos
  228 |     if ((await filtros.count()) > 0) {
  229 |       // Los filtros deben estar habilitados
```
