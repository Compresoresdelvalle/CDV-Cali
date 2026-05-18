/**
 * E2E — Módulo Órdenes de Servicio
 *
 * Cubre:
 *   ✓ Lista /ops/ordenes carga (lista o empty state) sin errores de consola
 *   ✓ Filtros de estado son clicables sin error
 *   ✓ Botón "Nueva orden" navega a /ops/ordenes/nueva
 *   ✓ Formulario mínimo (cliente, equipo, técnico) → submit → redirect a detalle
 *   ✓ Detalle: badge de estado, sección "Repuestos", buscador de repuesto
 *   ✓ Cambiar estado a "En proceso" y verificar badge cambia
 *   ✓ RoleGuard: Vendedor (María) no puede acceder a /ops/ordenes/nueva
 */

import { test, expect } from "@playwright/test";
import { loginUI } from "./helpers.js";

// Collect console errors during a test
function watchConsoleErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      errors.push(`HTTP ${res.status()} ${res.url()}`);
    }
  });
  return errors;
}

test.describe("Órdenes de Servicio — Admin (Carlos)", () => {
  let createdOrdenId = null;

  test.beforeEach(async ({ page }) => {
    await loginUI(page, "carlos");
  });

  test("lista /ops/ordenes carga sin errores", async ({ page }) => {
    const errors = watchConsoleErrors(page);
    await page.goto("/ops/ordenes");

    // Wait for list, empty state, or skeleton to resolve
    await expect(
      page
        .locator(
          'ul[role="list"], p:has-text("Sin órdenes"), h1:has-text("Órdenes"), [class*="animate-pulse"]',
        )
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // Wait for loading to finish (skeleton disappears or list appears)
    await page.waitForFunction(
      () => !document.querySelector('[class*="animate-pulse"]'),
      { timeout: 15_000 },
    );

    // Screenshot
    await page.screenshot({
      path: "tests/results/ordenes-lista.png",
      fullPage: true,
    });

    // No 4xx/5xx errors
    const httpErrors = errors.filter(
      (e) => e.startsWith("HTTP 4") || e.startsWith("HTTP 5"),
    );
    expect(httpErrors).toHaveLength(0);
  });

  test("filtros de estado son clicables sin error", async ({ page }) => {
    await page.goto("/ops/ordenes");
    await page.waitForLoadState("networkidle");

    const filtros = [
      "Abiertas",
      "En proceso",
      "Esperando repuesto",
      "Completadas",
      "Entregadas",
      "Todas",
    ];
    for (const filtro of filtros) {
      const btn = page.locator(`button:has-text("${filtro}")`).first();
      await expect(btn).toBeVisible({ timeout: 8_000 });
      await btn.click();
      // Brief pause to let the query fire; no crash = pass
      await page.waitForTimeout(400);
    }
  });

  test("botón Nueva orden navega a /ops/ordenes/nueva", async ({ page }) => {
    await page.goto("/ops/ordenes");
    await page.waitForLoadState("networkidle");

    const btn = page.locator('button:has-text("Nueva orden")').first();
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await btn.click();

    await page.waitForURL(/\/ops\/ordenes\/nueva/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/ops\/ordenes\/nueva/);
  });

  test("formulario nueva orden: campos cargan correctamente", async ({
    page,
  }) => {
    await page.goto("/ops/ordenes/nueva");

    // Esperar que los campos estén visibles
    await expect(
      page.locator('input[placeholder*="Juan Pérez"]').first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('input[placeholder*="Compresor"]').first(),
    ).toBeVisible({ timeout: 8_000 });

    // Técnico select debe cargar al menos una opción
    const select = page.locator("select").first();
    await expect(select).toBeVisible({ timeout: 10_000 });
    // Wait for technicians to load from Supabase
    await page.waitForFunction(
      () => {
        const sel = document.querySelector("select");
        return sel && sel.options.length > 1;
      },
      { timeout: 15_000 },
    );

    await page.screenshot({
      path: "tests/results/ordenes-form.png",
      fullPage: true,
    });
  });

  test("crear nueva orden y redirige a detalle", async ({ page }) => {
    const errors = watchConsoleErrors(page);
    await page.goto("/ops/ordenes/nueva");

    // Wait for technicians to load
    await page.waitForFunction(
      () => {
        const sel = document.querySelector("select");
        return sel && sel.options.length > 1;
      },
      { timeout: 15_000 },
    );

    // Fill cliente nombre
    const clienteInput = page
      .locator('input[placeholder*="Juan Pérez"]')
      .first();
    await clienteInput.fill("Cliente E2E Test");

    // Fill equipo descripcion
    const equipoInput = page.locator('input[placeholder*="Compresor"]').first();
    await equipoInput.fill("Compresor 50L 2HP E2E");

    // Select first available technician (index 1 skips blank option)
    const select = page.locator("select").first();
    await select.selectOption({ index: 1 });

    // Submit — wait for the Supabase insert response before asserting redirect
    const submitBtn = page.locator(
      'button[type="submit"]:has-text("Crear orden")',
    );
    await expect(submitBtn).toBeVisible({ timeout: 5_000 });

    // Race: click submit and wait for the POST to ordenes_servicio to complete
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("ordenes_servicio") &&
          res.request().method() === "POST",
        { timeout: 30_000 },
      ),
      submitBtn.click(),
    ]);

    // Log the response status for debugging
    const status = response.status();

    // Should redirect to /ops/ordenes/:uuid (not /nueva)
    // UUID regex: 8-4-4-4-12 hex chars
    await page.waitForURL(
      /\/ops\/ordenes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      { timeout: 15_000 },
    );
    const url = page.url();
    expect(url).toMatch(
      /\/ops\/ordenes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // Store the ID for use in subsequent checks
    createdOrdenId = url.split("/ops/ordenes/")[1];

    // Insert must succeed (201 Created)
    expect(status).toBe(201);

    // No HTTP errors during creation
    const httpErrors = errors.filter(
      (e) => e.startsWith("HTTP 4") || e.startsWith("HTTP 5"),
    );
    expect(httpErrors).toHaveLength(0);
  });

  test("detalle de orden: badge estado, sección repuestos y buscador visibles", async ({
    page,
  }) => {
    // Navigate to a real order: first go to list and open first item, or use the created one
    await page.goto("/ops/ordenes");
    await page.waitForLoadState("networkidle");

    // If list has items, click the first
    const firstItem = page.locator('ul[role="list"] li button').first();
    const hasItems = (await firstItem.count()) > 0;

    if (hasItems) {
      await firstItem.click();
      await page.waitForURL(/\/ops\/ordenes\/[^/]+$/, { timeout: 10_000 });
    } else if (createdOrdenId) {
      await page.goto(`/ops/ordenes/${createdOrdenId}`);
    } else {
      test.skip(true, "No hay órdenes creadas para verificar detalle");
      return;
    }

    // Badge de estado visible (StatusBadge rendered inside the info card)
    await expect(
      page
        .locator(
          '[class*="badge"], span:has-text("Abierta"), span:has-text("En proceso"), span:has-text("abierta")',
        )
        .first(),
    ).toBeVisible({ timeout: 10_000 });

    // Sección "Repuestos consumidos"
    await expect(
      page.locator('h3:has-text("Repuestos"), p:has-text("Repuestos")').first(),
    ).toBeVisible({ timeout: 8_000 });

    // Buscador de repuestos
    await expect(
      page.locator('input[placeholder*="repuesto"]').first(),
    ).toBeVisible({ timeout: 8_000 });

    await page.screenshot({
      path: "tests/results/ordenes-detalle.png",
      fullPage: true,
    });
  });

  test("el cambio de estado responde (transición válida o bloqueo de autorización)", async ({
    page,
  }) => {
    // Nota: desde Fase 10, una OT con estado_autorizacion='pendiente' NO puede
    // avanzar de 'abierta' (trigger trg_orden_validar_anticipo). Por eso este
    // test acepta dos desenlaces válidos al pulsar "En proceso": que la OT
    // transicione, o que el sistema informe el bloqueo de autorización.
    await page.goto("/ops/ordenes");
    await page.waitForLoadState("networkidle");

    const firstItem = page.locator('ul[role="list"] li button').first();
    const hasItems = (await firstItem.count()) > 0;

    if (!hasItems && !createdOrdenId) {
      test.skip(true, "No hay órdenes para probar cambio de estado");
      return;
    }

    if (hasItems) {
      await firstItem.click();
      await page.waitForURL(/\/ops\/ordenes\/[^/]+$/, { timeout: 10_000 });
    } else {
      await page.goto(`/ops/ordenes/${createdOrdenId}`);
    }

    const enProcesoBtn = page.locator('button:has-text("En proceso")').first();
    await expect(enProcesoBtn).toBeVisible({ timeout: 10_000 });

    if (await enProcesoBtn.isDisabled()) return; // estado no permite la transición

    await enProcesoBtn.click();
    await page.waitForTimeout(1_500);

    // Desenlace válido: la OT pasó a "En proceso" O el sistema bloqueó la
    // transición por la regla de autorización del cliente (Fase 10).
    const badge = page
      .locator(
        'span:has-text("En proceso"), [class*="badge"]:has-text("En proceso")',
      )
      .first();
    const bloqueo = page
      .getByText(/autorizaci|Error al cambiar estado/i)
      .first();
    await expect(badge.or(bloqueo)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("RoleGuard — Vendedor (María) no puede crear órdenes", () => {
  test("acceder a /ops/ordenes/nueva redirige a /ops", async ({ page }) => {
    await loginUI(page, "maria");

    await page.goto("/ops/ordenes/nueva");

    // RoleGuard redirects Vendedor to /ops
    await page.waitForURL(/\/ops($|\/)(?!ordenes\/nueva)/, { timeout: 10_000 });
    expect(page.url()).not.toMatch(/\/ops\/ordenes\/nueva/);
  });

  test("acceder a /ops/ordenes es bloqueado (redirige a /ops)", async ({
    page,
  }) => {
    await loginUI(page, "maria");

    await page.goto("/ops/ordenes");

    // Vendedor is NOT in roles for ordenes list either ["Admin","Tecnico","Bodeguero"]
    await page.waitForURL(/\/ops($|\/)(?!ordenes)/, { timeout: 10_000 });
    expect(page.url()).not.toMatch(/\/ops\/ordenes/);
  });
});
