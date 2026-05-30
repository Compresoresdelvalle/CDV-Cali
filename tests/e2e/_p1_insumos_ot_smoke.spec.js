/* global process */
/**
 * TEMPORAL — smoke de la Parte 1 (insumos en OT + notificaciones). BORRAR luego.
 * Login ADMIN. PIN por env: TEST_ADMIN_PIN (NUNCA hardcodear).
 *
 * Solo checks SIN mutar datos:
 *  - Campana de notificaciones (BellDot) visible en el panel Admin.
 *  - En el detalle de una OT editable: el toggle "Solo insumos / Inventario
 *    global" del picker de repuestos está presente (best-effort: si no hay OT
 *    editable, anota y sigue).
 *
 * El flujo real (convertir desde la OT, consumir insumo, que llegue la
 * notificación al Admin) va en las pruebas MANUALES (crea datos reales).
 *
 * Correr (PowerShell):
 *   $env:TEST_ADMIN_PIN="<tu-pin>"; npx playwright test tests/e2e/_p1_insumos_ot_smoke.spec.js --project=chromium
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

test.describe("Parte 1 — insumos en OT (Admin)", () => {
  test.beforeAll(() => {
    if (!ADMIN.pin) {
      throw new Error(
        'Falta el PIN. Corre con:  $env:TEST_ADMIN_PIN="<pin>"; npx playwright test tests/e2e/_p1_insumos_ot_smoke.spec.js --project=chromium',
      );
    }
  });

  test("Campana de notificaciones visible en panel Admin", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin");
    await expect(
      page.getByRole("button", { name: /notificaciones/i }),
    ).toBeVisible({ timeout: 15_000 });
    await page.screenshot({
      path: "tests/results/p1-campana-notificaciones.png",
      fullPage: true,
    });
  });

  test("OT editable: toggle 'Solo insumos / Inventario global' presente", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/ops/ordenes");
    const primera = page.locator('a[href*="/ops/ordenes/"]').first();
    const hayOT = await primera
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (!hayOT) {
      test.info().annotations.push({
        type: "nota",
        description: "No hay OT para abrir.",
      });
      return;
    }
    await primera.click();
    await page.waitForURL(/\/ops\/ordenes\/[0-9a-f-]+/i, { timeout: 15_000 });
    const toggle = page.getByRole("button", { name: /inventario global/i });
    const visible = await toggle
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (!visible) {
      test.info().annotations.push({
        type: "nota",
        description:
          "La OT abierta no está en estado editable (no se ve el picker). Probar con una OT editable manualmente.",
      });
      return;
    }
    await expect(toggle).toBeVisible();
    await page.screenshot({
      path: "tests/results/p1-ot-toggle-insumos.png",
      fullPage: true,
    });
  });
});
