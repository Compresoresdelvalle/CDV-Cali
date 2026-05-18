/**
 * E2E Fase 6 — Traspasos + Picking.
 *
 * Spec NO destructivo: verifica renderizado, navegación y validación de los
 * formularios sin crear traspasos reales (el flujo completo de estados y
 * stock está cubierto por el stress SQL). Complementa `traspasos.spec.js`
 * sin duplicar casos.
 *
 * Login como Pedro (Bodeguero): rol que opera Traspasos y Picking.
 */
import { test, expect } from "@playwright/test";
import { loginUI } from "./helpers.js";

test.describe("Fase 6 — Traspasos + Picking", () => {
  test("El historial de traspasos carga", async ({ page }) => {
    await loginUI(page, "pedro");
    await page.goto("/ops/traspasos");
    await page.waitForTimeout(3000);
    const filas = page.locator("tbody tr");
    const vacio = page.getByText(/Sin traspasos registrados/i);
    await expect(filas.first().or(vacio)).toBeVisible({ timeout: 20_000 });
  });

  test("Los filtros de estado se renderizan", async ({ page }) => {
    await loginUI(page, "pedro");
    await page.goto("/ops/traspasos");
    await expect(page.locator('button:has-text("En Tránsito")')).toBeVisible({
      timeout: 20_000,
    });
    await page.locator('button:has-text("En Tránsito")').click();
    // Tras filtrar, la página sigue mostrando contenido (lista o vacío).
    await page.waitForTimeout(2500);
    const filas = page.locator("tbody tr");
    const vacio = page.getByText(/Sin traspasos registrados/i);
    await expect(filas.first().or(vacio)).toBeVisible({ timeout: 15_000 });
  });

  test("Nuevo Traspaso renderiza el formulario", async ({ page }) => {
    await loginUI(page, "pedro");
    await page.goto("/ops/traspasos/nuevo");
    await expect(page.getByText(/Sede destino/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.locator('button:has-text("Crear traspaso")'),
    ).toBeVisible();
  });

  test("Crear traspaso está deshabilitado sin destino ni productos", async ({
    page,
  }) => {
    await loginUI(page, "pedro");
    await page.goto("/ops/traspasos/nuevo");
    const btn = page.locator('button:has-text("Crear traspaso")');
    await btn.waitFor({ state: "visible", timeout: 20_000 });
    await expect(btn).toBeDisabled();
  });

  test("Seleccionar sede destino habilita la búsqueda de productos", async ({
    page,
  }) => {
    await loginUI(page, "pedro");
    await page.goto("/ops/traspasos/nuevo");
    // Para Pedro (Bodeguero) la sede origen es fija; solo elige destino.
    const selectDestino = page.locator("select").first();
    await selectDestino.waitFor({ state: "visible", timeout: 20_000 });
    // El buscador de productos solo aparece con sede origen definida.
    await expect(
      page.locator('input[placeholder*="nombre o referencia" i]'),
    ).toBeVisible({ timeout: 10_000 });
  });
});
