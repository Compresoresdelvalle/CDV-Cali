/**
 * E2E Fase 14 — Recibos manuales.
 *
 * Cubre: navegación, listado, crear recibo desde cero, detalle con
 * botones PDF, anular, y RBAC (Bodeguero no tiene acceso).
 */
import { test, expect } from "@playwright/test";
import { loginUI } from "./helpers.js";

test.describe("Fase 14 — Recibos", () => {
  test("Vendedor tiene el módulo Recibos registrado en el menú", async ({
    page,
  }) => {
    await loginUI(page, "maria");
    // El link de Recibos vive en un grupo plegable del sidebar; basta con
    // verificar que está registrado en el DOM para el rol Vendedor.
    await expect(page.locator('a[href="/ops/recibos"]')).toHaveCount(1, {
      timeout: 15_000,
    });
  });

  test("Listado de recibos carga sin error", async ({ page }) => {
    await loginUI(page, "maria");
    await page.goto("/ops/recibos");
    await expect(page.locator('button:has-text("Nuevo recibo")')).toBeVisible({
      timeout: 15_000,
    });
    // Filtros presentes
    await expect(page.locator('button:has-text("Vigentes")')).toBeVisible();
    await expect(page.locator('button:has-text("Anulados")')).toBeVisible();
  });

  test("Crear recibo desde cero, ver detalle y anular", async ({ page }) => {
    await loginUI(page, "maria");
    await page.goto("/ops/recibos/nuevo");

    // Rellenar cliente
    const nombre = page.locator('input[placeholder="Nombre del cliente"]');
    await nombre.waitFor({ state: "visible", timeout: 15_000 });
    await nombre.fill("Cliente E2E F14");

    // Concepto (textarea)
    await page.locator("textarea").first().fill("Pago de prueba E2E");

    // Guardar
    await page.locator('button:has-text("Crear recibo")').click();

    // Debe navegar al detalle del recibo
    await page.waitForURL(/\/ops\/recibos\/[0-9a-f-]{8,}/, {
      timeout: 20_000,
    });

    // Detalle muestra botones PDF
    await expect(page.locator('button:has-text("Imprimir")')).toBeVisible();
    await expect(
      page.locator('button:has-text("Descargar PDF")'),
    ).toBeVisible();

    // Anular
    const anular = page.locator('button:has-text("Anular recibo")');
    await expect(anular).toBeVisible();
    await anular.click();
    // Confirm dialog
    await page.locator('button:has-text("Sí, anular")').click();

    // Badge "Anulado" aparece
    await expect(page.locator("text=Anulado").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("RBAC — Bodeguero no accede a Recibos", async ({ page }) => {
    await loginUI(page, "pedro");
    await page.goto("/ops/recibos");
    // RoleGuard redirige fuera de /ops/recibos
    await expect(page).not.toHaveURL(/\/ops\/recibos$/, { timeout: 10_000 });
  });
});
