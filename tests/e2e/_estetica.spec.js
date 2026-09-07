/**
 * TEMPORAL — el cabo suelto del Dashboard (BORRAR cuando ya no haga falta).
 *
 * El botón "Refrescar" SÍ llamaba a las tres cargas, pero la pantalla se
 * refresca sola cada 60 s: al pulsarlo los números ya venían al día y no
 * cambiaba nada, así que parecía roto. Ahora hay un sello de "Actualizado hace
 * X" que sí cambia, y esta prueba lo fija.
 *
 * PIN por env: TEST_ADMIN_PIN
 */
/* global process */
import { test, expect } from "@playwright/test";

const ADMIN = {
  usuario: "Admin Maritza",
  pin: process.env.TEST_ADMIN_PIN || "",
};

async function loginAdmin(page) {
  await page.goto("/");
  const t = page.locator(`button:has-text("${ADMIN.usuario}")`).first();
  if (!(await t.isVisible().catch(() => false)))
    await page
      .locator('button:has-text("Administrador")')
      .first()
      .click({ timeout: 20_000 });
  await t.waitFor({ state: "visible", timeout: 20_000 });
  await t.click();
  const pin = page.locator('input[type="password"]');
  await pin.first().waitFor({ state: "visible", timeout: 10_000 });
  for (const [i, d] of ADMIN.pin.split("").entries()) {
    await pin.nth(i).click();
    await pin.nth(i).pressSequentially(d);
  }
  await page.waitForURL(/\/(ops|admin)/, { timeout: 20_000 });
}

test("dashboard: el boton de refrescar ahora dice algo", async ({ page }) => {
  await loginAdmin(page);
  await page.goto("/admin");
  await expect(page.getByText(/Actualizado hace/)).toBeVisible({
    timeout: 30_000,
  });
  // Y al pulsarlo tiene que seguir diciendo algo, no desaparecer.
  await page.getByRole("button", { name: /Refrescar/ }).click();
  await expect(page.getByText(/Actualizado hace/)).toBeVisible({
    timeout: 30_000,
  });
});
