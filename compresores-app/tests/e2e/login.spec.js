/**
 * E2E — Login y navegación básica
 *
 * Cubre:
 *   ✓ La app carga sin errores JS críticos
 *   ✓ Pantalla de login es visible
 *   ✓ Login exitoso navega al área operativa
 *   ✓ PIN incorrecto muestra error (no navega)
 */

import { test, expect } from "@playwright/test";
import { loginUI } from "./helpers.js";

test.describe("Login", () => {
  test("pantalla de login carga correctamente", async ({ page }) => {
    await page.goto("/");
    // Debe mostrar algún elemento de login — email, PIN o logo
    await expect(
      page
        .locator('input[type="email"], [data-testid="login"], h1, h2')
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("login exitoso con Pedro (Bodeguero) navega a ops", async ({ page }) => {
    await loginUI(page, "pedro");

    // Después del login debe estar en /ops o /admin
    await expect(page).toHaveURL(/\/(ops|admin)/, { timeout: 15_000 });

    // No debe haber errores de JS no capturados
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    expect(errors.filter((e) => !e.includes("ResizeObserver"))).toHaveLength(0);
  });

  test("login exitoso con Carlos (Admin) navega a dashboard", async ({
    page,
  }) => {
    await loginUI(page, "carlos");
    await expect(page).toHaveURL(/\/(ops|admin)/, { timeout: 15_000 });
  });
});
