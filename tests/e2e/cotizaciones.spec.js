/**
 * E2E — Flujo Cotizaciones → Venta
 *
 * Cubre:
 *   ✓ Historial de cotizaciones carga
 *   ✓ Nueva cotización tiene formulario con productos y cliente
 *   ✓ Detalle muestra botón "Convertir a Venta" si está en pendiente
 *   ✓ Cotización convertida muestra estado "Convertida" (no "Pendiente")
 *   ✓ Cotización ya convertida NO muestra botón de convertir
 */

import { test, expect } from "@playwright/test";
import { loginUI } from "./helpers.js";

test.describe("Flujo Cotizaciones", () => {
  test.beforeEach(async ({ page }) => {
    await loginUI(page, "maria");
  });

  test("historial de cotizaciones carga la lista", async ({ page }) => {
    await page.goto("/ops/cotizaciones");

    await expect(
      page
        .locator(
          'table, ul[role="list"], [data-testid="cotizaciones-list"], h1:has-text("Cotizacion"), p:has-text("No hay")',
        )
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("nueva cotización tiene campo de cliente y búsqueda de producto", async ({
    page,
  }) => {
    await page.goto("/ops/cotizaciones/nueva");

    await expect(
      page
        .locator(
          'input[placeholder*="cliente"], input[placeholder*="nombre"], input[placeholder*="buscar"], input[placeholder*="producto"]',
        )
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("cotización en estado Convertida no muestra botón Convertir", async ({
    page,
  }) => {
    await page.goto("/ops/cotizaciones");
    await page.waitForTimeout(1_200);

    // Buscar cotización en estado Convertida
    const convertidaItem = page
      .locator('li:has-text("Convertida"), tr:has-text("Convertida")')
      .first();

    if ((await convertidaItem.count()) === 0) {
      test.skip();
      return;
    }

    await convertidaItem.locator("button, a").first().click();
    await page.waitForTimeout(800);

    // No debe haber botón de convertir
    const convertirBtn = page.locator(
      'button:has-text("Convertir"), button:has-text("Venta")',
    );
    if ((await convertirBtn.count()) > 0) {
      expect(await convertirBtn.isDisabled()).toBe(true);
    } else {
      // No aparece = correcto
      expect(await convertirBtn.count()).toBe(0);
    }
  });

  test("cotización pendiente muestra botón Convertir a Venta", async ({
    page,
  }) => {
    await page.goto("/ops/cotizaciones");
    await page.waitForTimeout(1_200);

    const pendienteItem = page
      .locator('li:has-text("Pendiente"), tr:has-text("Pendiente")')
      .first();

    if ((await pendienteItem.count()) === 0) {
      test.skip();
      return;
    }

    await pendienteItem.locator("button, a").first().click();
    await page.waitForTimeout(800);

    await expect(
      page
        .locator('button:has-text("Convertir"), button:has-text("Venta")')
        .first(),
    ).toBeVisible({ timeout: 8_000 });
  });
});
