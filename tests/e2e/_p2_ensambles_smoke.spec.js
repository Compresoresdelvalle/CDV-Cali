/* global process */
/**
 * TEMPORAL — smoke de la Parte 2 (rediseño de Ensambles). BORRAR luego.
 * Login ADMIN. PIN por env: TEST_ADMIN_PIN.
 *
 * Checks SIN mutar datos:
 *  - EnsambleNuevo: el buscador encuentra un ensamblable (COMPRESOR).
 *  - Al elegirlo aparece el Paso 3 (insumos de la receta) con el toggle
 *    "Solo insumos / Inventario global".
 *  - ProductoForm (nuevo): tiene el check "Ensamblable".
 *
 * El flujo real (armar receta, convertir, completar ensamble) crea datos →
 * va en las pruebas MANUALES.
 *
 * Correr:
 *   $env:TEST_ADMIN_PIN="<pin>"; npx playwright test tests/e2e/_p2_ensambles_smoke.spec.js --project=chromium
 */
import { test, expect } from "@playwright/test";

const ADMIN = { nombre: "Admin", pin: process.env.TEST_ADMIN_PIN || "" };

async function loginAdmin(page) {
  await page.goto("/");
  const card = page.locator(`button:has-text("${ADMIN.nombre}")`).first();
  await card.waitFor({ state: "visible", timeout: 20_000 });
  await card.click();
  const pin = page.locator('input[type="password"]');
  await pin.first().waitFor({ state: "visible", timeout: 10_000 });
  const digits = ADMIN.pin.split("");
  for (let i = 0; i < digits.length; i++) {
    await pin.nth(i).click();
    await pin.nth(i).pressSequentially(digits[i]);
  }
  await page.waitForURL(/\/(ops|admin)/, { timeout: 20_000 });
}

test.describe("Parte 2 — Ensambles (Admin)", () => {
  test.beforeAll(() => {
    if (!ADMIN.pin) {
      throw new Error(
        'Falta el PIN. Corre con:  $env:TEST_ADMIN_PIN="<pin>"; npx playwright test tests/e2e/_p2_ensambles_smoke.spec.js --project=chromium',
      );
    }
  });

  test("EnsambleNuevo: ensamblable + receta con toggle de insumos", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/ops/ensambles/nuevo");
    const search = page.locator('input[placeholder*="ensamblable" i]').first();
    await search.waitFor({ state: "visible", timeout: 15_000 });
    await search.fill("COMPRESOR");
    // El primer resultado del buscador (un botón de la lista) que contiene "COMPRESOR".
    const primer = page.getByRole("button", { name: /COMPRESOR/i }).first();
    await primer.waitFor({ state: "visible", timeout: 15_000 });
    await primer.click();
    // Paso 3 + toggle aparecen tras elegir el producto.
    await expect(page.getByText(/insumos de la receta/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("button", { name: /inventario global/i }),
    ).toBeVisible();
    await page.screenshot({
      path: "tests/results/p2-ensamble-receta.png",
      fullPage: true,
    });
  });

  test("ProductoForm (nuevo) tiene el check 'Ensamblable'", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/ops/inventario/nuevo");
    await expect(page.getByText(/ensamblable/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
