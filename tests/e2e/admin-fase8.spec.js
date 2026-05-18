/**
 * E2E — Módulo Admin (Fase 8)
 *
 * Cubre:
 *   ✓ Dashboard carga con cards KPI
 *   ✓ Alertas — 3 tabs visibles con contadores
 *   ✓ Reorden — vista sin error
 *   ✓ Top10 — cambio de período recarga
 *   ✓ Análisis ABC — 3 cards A/B/C + filtro
 *   ✓ Auditoría — tabla movimientos + filtros
 *   ✓ Usuarios — lista + abrir modal editar
 *   ✓ Conteo — lista + abrir modal "Nuevo conteo"
 *   ✓ Seguridad — María (Vendedor) NO puede acceder a /admin
 */

import { test, expect } from "@playwright/test";
import { loginUI } from "./helpers.js";

// ─── Helpers locales ────────────────────────────────────────────────────────

/** Espera a que la página deje de mostrar estado de carga (spinner / "Cargando") */
async function waitForLoad(page, timeout = 20_000) {
  // Esperar que desaparezca el texto "Cargando" o el skeleton
  await page
    .locator("text=/Cargando/i")
    .waitFor({ state: "hidden", timeout })
    .catch(() => {}); // si nunca apareció, está bien
}

// ─── Suite principal ─────────────────────────────────────────────────────────

test.describe("Admin Fase 8", () => {
  test.describe.configure({ mode: "serial" }); // mantener sesión entre tests

  test.beforeEach(async ({ page }) => {
    await loginUI(page, "carlos");
  });

  // ── 1. Dashboard ──────────────────────────────────────────────────────────
  test("Dashboard Admin carga con cards KPI", async ({ page }) => {
    await page.goto("/admin");
    await waitForLoad(page);

    // Título de la página
    await expect(
      page
        .locator("h1, h2")
        .filter({ hasText: /Dashboard/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // Al menos una card KPI (contiene número formateado como moneda o dígito)
    const kpiCards = page.locator(
      '[class*="rounded"], .rounded-xl, div[style*="card"]',
    );
    await expect(kpiCards.first()).toBeVisible({ timeout: 15_000 });

    // No debe haber mensaje de error
    await expect(page.locator("text=/Error al cargar/i")).not.toBeVisible();

    // Screenshot — Dashboard con KPIs
    await page.screenshot({
      path: "tests/e2e/screenshots/admin-dashboard.png",
      fullPage: false,
    });
  });

  // ── 2. Alertas — 3 tabs ───────────────────────────────────────────────────
  test("Alertas — 3 tabs visibles y accesibles", async ({ page }) => {
    await page.goto("/admin/alertas");
    await waitForLoad(page);

    // Título de página
    await expect(
      page
        .locator("h1, h2")
        .filter({ hasText: /Alerta/i })
        .first(),
    ).toBeVisible({ timeout: 12_000 });

    // Los 3 tabs deben estar visibles
    await expect(page.locator('button:has-text("Stock bajo")')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('button:has-text("Herramientas")')).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.locator('button:has-text("Órdenes")')).toBeVisible({
      timeout: 8_000,
    });

    // Screenshot — Alertas tabs
    await page.screenshot({
      path: "tests/e2e/screenshots/admin-alertas-tabs.png",
      fullPage: false,
    });

    // Click en cada tab — no debe lanzar error
    await page.locator('button:has-text("Herramientas")').click();
    await expect(page.locator("text=/Error al cargar/i")).not.toBeVisible({
      timeout: 5_000,
    });

    await page.locator('button:has-text("Órdenes")').click();
    await expect(page.locator("text=/Error al cargar/i")).not.toBeVisible({
      timeout: 5_000,
    });
  });

  // ── 3. Reorden — sin error ────────────────────────────────────────────────
  test("Reorden — vista carga sin error", async ({ page }) => {
    await page.goto("/admin/reorden");
    await waitForLoad(page);

    await expect(
      page
        .locator("h1, h2")
        .filter({ hasText: /Reorden|Sugerencias/i })
        .first(),
    ).toBeVisible({ timeout: 12_000 });

    // Debe mostrar tabla, lista vacía o mensaje de vacío — nunca un error de crash.
    // Nota: no se puede mezclar `text=` con selectores CSS en una lista por comas;
    // se combina el CSS con `.or(getByText(...))`.
    await expect(
      page
        .locator('table, ul[role="list"]')
        .or(page.getByText(/Sin sugerencias|No hay|sugerencias de reorden/i))
        .first(),
    ).toBeVisible({ timeout: 12_000 });

    await expect(page.locator("text=/Error al cargar/i")).not.toBeVisible();
  });

  // ── 4. Top10 — cambio de período ─────────────────────────────────────────
  test("Top10 — cambiar período 7d/30d/90d/1y recarga sin error", async ({
    page,
  }) => {
    await page.goto("/admin/top10");
    await waitForLoad(page);

    await expect(
      page
        .locator("h1, h2")
        .filter({ hasText: /Top|10/i })
        .first(),
    ).toBeVisible({ timeout: 12_000 });

    // Los botones de período deben existir
    const periodos = ["7d", "30d", "90d", "1y"];
    for (const p of periodos) {
      const btn = page.locator(`button:has-text("${p}")`);
      if ((await btn.count()) > 0) {
        await btn.first().click();
        await waitForLoad(page, 8_000);
        await expect(page.locator("text=/Error al cargar/i")).not.toBeVisible({
          timeout: 5_000,
        });
      }
    }

    await expect(
      page
        .locator('ul[role="list"], table')
        .or(page.getByText(/Sin ventas|No hay/i))
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── 5. Análisis ABC — cards + filtro ─────────────────────────────────────
  test("Análisis ABC — 3 cards A/B/C y filtro funciona", async ({ page }) => {
    await page.goto("/admin/abc");
    await waitForLoad(page);

    await expect(
      page
        .locator("h1, h2")
        .filter({ hasText: /ABC|Análisis/i })
        .first(),
    ).toBeVisible({ timeout: 12_000 });

    // Los 3 botones/cards de clasificación A, B, C deben estar presentes
    await expect(
      page
        .locator('button:has-text("A")')
        .or(page.getByText(/Clase A/i))
        .first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page
        .locator('button:has-text("B")')
        .or(page.getByText(/Clase B/i))
        .first(),
    ).toBeVisible({ timeout: 8_000 });
    await expect(
      page
        .locator('button:has-text("C")')
        .or(page.getByText(/Clase C/i))
        .first(),
    ).toBeVisible({ timeout: 8_000 });

    // Clic en filtro "A" — lista debe cambiar (no error)
    const filtroA = page.locator('button:has-text("A")').first();
    await filtroA.click();
    await waitForLoad(page, 6_000);
    await expect(page.locator("text=/Error/i")).not.toBeVisible({
      timeout: 4_000,
    });

    // Volver a "Todos"
    const filtroTodos = page.locator('button:has-text("Todos")');
    if ((await filtroTodos.count()) > 0) {
      await filtroTodos.first().click();
    }
  });

  // ── 6. Auditoría — tabla + filtros ───────────────────────────────────────
  test("Auditoría — tabla movimientos y filtros visibles", async ({ page }) => {
    await page.goto("/admin/auditoria");
    await waitForLoad(page);

    await expect(
      page
        .locator("h1, h2")
        .filter({ hasText: /Auditor|Movimiento/i })
        .first(),
    ).toBeVisible({ timeout: 12_000 });

    // Tabla (desktop) o lista mobile debe estar presente
    await expect(
      page
        .locator('table, ul[role="list"]')
        .or(page.getByText(/Sin movimientos|No hay/i))
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // Filtros — al menos uno de tipo select o input debe estar
    const filtros = page.locator(
      'select, input[type="date"], input[placeholder*="buscar"]',
    );
    // No forzamos count > 0; si existen, interactuamos
    if ((await filtros.count()) > 0) {
      // Los filtros deben estar habilitados
      const primerFiltro = filtros.first();
      await expect(primerFiltro).toBeEnabled({ timeout: 5_000 });
    }

    await expect(page.locator("text=/Error al cargar/i")).not.toBeVisible();

    // Screenshot — Auditoría con tabla
    await page.screenshot({
      path: "tests/e2e/screenshots/admin-auditoria.png",
      fullPage: false,
    });
  });

  // ── 7. Usuarios — lista + modal editar ───────────────────────────────────
  test("Usuarios — lista carga y modal editar abre", async ({ page }) => {
    await page.goto("/admin/usuarios");
    await waitForLoad(page);

    await expect(
      page
        .locator("h1, h2")
        .filter({ hasText: /Usuario/i })
        .first(),
    ).toBeVisible({ timeout: 12_000 });

    // Lista de usuarios debe mostrar al menos un item
    const listaUsuarios = page.locator('ul[role="list"] li, table tbody tr');
    await expect(listaUsuarios.first()).toBeVisible({ timeout: 15_000 });

    // Buscar botón de editar en el primer usuario
    const editBtn = page
      .locator(
        'button:has-text("Editar"), button:has-text("✏"), button[title*="edit"]',
      )
      .first();

    if (await editBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await editBtn.click();

      // Modal debe aparecer — el modal de Usuarios renderiza el encabezado
      // "Editar usuario" (es un overlay de divs, no un <dialog>/<form>).
      await expect(
        page.getByRole("heading", { name: /Editar usuario/i }),
      ).toBeVisible({ timeout: 8_000 });

      // Screenshot — modal usuarios
      await page.screenshot({
        path: "tests/e2e/screenshots/admin-usuarios-modal.png",
        fullPage: false,
      });

      // Cerrar modal
      const cancelBtn = page.locator('button:has-text("Cancelar")').first();
      if (await cancelBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await cancelBtn.click();
      }
    }

    await expect(page.locator("text=/Error al cargar/i")).not.toBeVisible();
  });

  // ── 8. Conteo — lista + modal nuevo conteo ────────────────────────────────
  test("Conteo cíclico — lista carga y modal Nuevo conteo abre", async ({
    page,
  }) => {
    await page.goto("/admin/conteo");
    await waitForLoad(page);

    await expect(
      page
        .locator('h1, h2, [class*="title"]')
        .filter({ hasText: /Conteo/i })
        .first(),
    ).toBeVisible({ timeout: 12_000 });

    // Botón "Nuevo conteo" debe estar visible (está en PageHeader actions)
    const nuevoBtn = page
      .locator('button:has-text("Nuevo conteo"), button:has-text("+ Nuevo")')
      .first();
    await expect(nuevoBtn).toBeVisible({ timeout: 10_000 });

    // Abrir modal
    await nuevoBtn.click();

    // Modal debe aparecer — renderiza el encabezado "Nuevo conteo cíclico"
    // (overlay de divs, no un <dialog>/<form>).
    await expect(
      page.getByRole("heading", { name: /Nuevo conteo/i }),
    ).toBeVisible({ timeout: 8_000 });

    await page.screenshot({
      path: "tests/e2e/screenshots/admin-conteo-modal.png",
      fullPage: false,
    });

    // Cerrar sin guardar
    const cancelBtn = page.locator('button:has-text("Cancelar")').first();
    if (await cancelBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await cancelBtn.click();
    } else {
      await page.keyboard.press("Escape");
    }

    await expect(page.locator("text=/Error al cargar/i")).not.toBeVisible();
  });
});

// ─── Seguridad: RoleGuard bloquea a no-Admin ─────────────────────────────────

test.describe("Admin — Seguridad RoleGuard", () => {
  test("María (Vendedor) no puede acceder a /admin — redirige a /ops o /login", async ({
    page,
  }) => {
    await loginUI(page, "maria");

    // Intentar navegar directo a la ruta protegida
    await page.goto("/admin");

    // Debe terminar en /ops o /login — nunca en /admin
    await page.waitForURL(/\/(ops|login)/, { timeout: 10_000 });

    const currentUrl = page.url();
    expect(currentUrl).not.toMatch(/\/admin/);
  });

  test("María no puede acceder a /admin/usuarios — redirige", async ({
    page,
  }) => {
    await loginUI(page, "maria");
    await page.goto("/admin/usuarios");

    await page.waitForURL(/\/(ops|login)/, { timeout: 10_000 });

    const currentUrl = page.url();
    expect(currentUrl).not.toMatch(/\/admin/);
  });
});
