/**
 * E2E Fase 3 — Inventario + QR.
 *
 * Cubre: carga del listado de inventario, búsqueda server-side con debounce,
 * y apertura del detalle de producto. (Realtime no se prueba en E2E — requiere
 * un cambio externo en la BD.)
 */
import { test, expect } from "@playwright/test";
import { loginUI } from "./helpers.js";

test.describe("Fase 3 — Inventario + QR", () => {
  test("El inventario carga con productos", async ({ page }) => {
    await loginUI(page, "carlos");
    await page.goto("/ops/inventario");
    // Tabla de escritorio (viewport por defecto de Playwright es desktop).
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("La búsqueda filtra el inventario", async ({ page }) => {
    await loginUI(page, "carlos");
    await page.goto("/ops/inventario");
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 30_000,
    });
    const search = page
      .locator('input[type="search"], input[placeholder*="usc" i]')
      .first();
    await search.waitFor({ state: "visible", timeout: 15_000 });
    await search.fill("filtro");
    // Debounce 300ms + ida y vuelta al servidor.
    await page.waitForTimeout(2500);
    // La fila debe aparecer en la tabla (no en las cards móviles ocultas).
    await expect(
      page.locator("tbody tr", { hasText: /filtro aire/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Abrir un producto navega a su detalle", async ({ page }) => {
    await loginUI(page, "carlos");
    await page.goto("/ops/inventario");
    const firstRow = page.locator("tbody tr").first();
    await firstRow.waitFor({ state: "visible", timeout: 20_000 });
    await firstRow.click();
    await page.waitForTimeout(2000);
    // El detalle carga — la URL deja de ser exactamente el listado.
    await expect(page).not.toHaveURL(/\/ops\/inventario\/?$/);
  });
});
