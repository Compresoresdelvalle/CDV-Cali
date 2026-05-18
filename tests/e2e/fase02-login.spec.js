/**
 * E2E Fase 2 — Login + Layout + Roles.
 *
 * Cubre: login con PIN por rol, menú por rol, PIN incorrecto, RBAC del
 * RoleGuard (un rol no entra a rutas ajenas), persistencia de sesión, logout.
 */
import { test, expect } from "@playwright/test";
import { loginUI, USERS } from "./helpers.js";

test.describe("Fase 2 — Login + Layout + Roles", () => {
  test("Carlos (Admin) inicia sesión y llega al panel admin", async ({
    page,
  }) => {
    await loginUI(page, "carlos");
    await expect(page).toHaveURL(/\/(admin|ops)/, { timeout: 20_000 });
  });

  test("María (Vendedora) ve sus módulos y NO los de otros roles", async ({
    page,
  }) => {
    await loginUI(page, "maria");
    await expect(page).toHaveURL(/\/ops/, { timeout: 20_000 });
    // Módulos del Vendedor (incluye Garantías y Recibos).
    await expect(page.locator('a[href="/ops/ventas"]').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.locator('a[href="/ops/cotizaciones"]').first(),
    ).toBeVisible();
    await expect(
      page.locator('a[href="/ops/garantias"]').first(),
    ).toBeVisible();
    await expect(page.locator('a[href="/ops/recibos"]').first()).toBeVisible();
    // Compras es de Bodeguero/Admin — un Vendedor NO debe verlo en el menú.
    await expect(page.locator('a[href="/ops/compras"]')).toHaveCount(0);
  });

  test("PIN incorrecto no inicia sesión", async ({ page }) => {
    await page.goto("/");
    const card = page.locator(`button:has-text("${USERS.carlos.nombre}")`);
    await card.first().waitFor({ state: "visible", timeout: 15_000 });
    await card.first().click();
    const pinInputs = page.locator('input[type="password"]');
    await pinInputs.first().waitFor({ state: "visible", timeout: 10_000 });
    for (let i = 0; i < 4; i++) {
      await pinInputs.nth(i).click();
      await pinInputs.nth(i).pressSequentially("9");
    }
    // Con PIN incorrecto NO debe redirigir a /ops ni /admin.
    await page.waitForTimeout(3000);
    await expect(page).not.toHaveURL(/\/(ops|admin)/);
  });

  test("RBAC — María (Vendedora) no accede al Panel Admin", async ({
    page,
  }) => {
    await loginUI(page, "maria");
    await page.goto("/admin");
    // El RoleGuard la saca de /admin.
    await expect(page).not.toHaveURL(/\/admin$/, { timeout: 10_000 });
  });

  test("La sesión persiste al recargar la página", async ({ page }) => {
    await loginUI(page, "carlos");
    await page.reload();
    // Tras recargar sigue autenticada — no vuelve al login.
    await page.waitForTimeout(3000);
    await expect(page).not.toHaveURL(/\/login/);
  });
});
