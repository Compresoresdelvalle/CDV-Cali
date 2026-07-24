/**
 * TEMPORAL — smoke test del Bloque 1 (BORRAR tras la verificación).
 * Login como ADMIN. PIN por env: TEST_ADMIN_PIN (NUNCA hardcodear el PIN aquí).
 *
 * Cubre, desde la perspectiva de ADMIN y SIN acciones destructivas:
 *  - Regresión: login sigue funcionando.
 *  - #3  Inventario y venta cargan; el buscador de venta encuentra los productos de prueba.
 *  - #4  Admin SÍ ve el botón "Nuevo producto" (el negativo —Bodeguero NO lo ve— es manual).
 *  - #6  Las páginas de Traspasos y Órdenes cargan.
 *  - #5  Abre el detalle del primer traspaso y CAPTURA pantalla para ver el botón
 *        "Cancelar traspaso". NO hace clic en cancelar (no toca datos reales).
 *
 * Lo de permisos por rol (Vendedor/Bodeguero) y el flujo real de cancelar van en
 * la lista de prueba MANUAL (requieren login con cada usuario).
 *
 * Correr (PowerShell):
 *   $env:TEST_ADMIN_PIN="<tu-pin>"; npx playwright test tests/e2e/_bloque1_smoke.spec.js --project=chromium
 */
/* global process */
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

test.describe("Bloque 1 — smoke (Admin)", () => {
  test.beforeAll(() => {
    if (!ADMIN.pin) {
      throw new Error(
        'Falta el PIN. Corre con:  $env:TEST_ADMIN_PIN="<pin>"; npx playwright test tests/e2e/_bloque1_smoke.spec.js --project=chromium',
      );
    }
  });

  test("Login Admin (regresión)", async ({ page }) => {
    await loginAdmin(page);
    await expect(page).toHaveURL(/\/(ops|admin)/);
  });

  test("#4 Inventario carga y Admin ve 'Nuevo producto'", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/ops/inventario");
    await expect(
      page.getByRole("heading", { name: /inventario/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /nuevo producto/i }),
    ).toBeVisible({ timeout: 15_000 });
    await page.screenshot({
      path: "tests/results/bloque1-inventario-admin.png",
      fullPage: true,
    });
  });

  test("#4 Productos carga y Admin ve 'Nuevo producto'", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/ops/productos");
    await expect(
      page.getByRole("button", { name: /nuevo producto/i }),
    ).toBeVisible({ timeout: 15_000 });
    await page.screenshot({
      path: "tests/results/bloque1-productos-admin.png",
      fullPage: true,
    });
  });

  test("#3 Venta: el buscador encuentra los productos de prueba", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/ops/ventas/nueva");
    const search = page.locator('input[placeholder*="referencia" i]').first();
    await search.waitFor({ state: "visible", timeout: 15_000 });
    await search.fill("INVENTARIO DE PRUEBA");
    await expect(page.getByText(/INVENTARIO DE PRUEBA/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("#6 Traspasos (lista) carga", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/ops/traspasos");
    await expect(page).toHaveURL(/\/ops\/traspasos$/);
    await expect(page.getByText(/traspasos/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: "tests/results/bloque1-traspasos-lista.png",
      fullPage: true,
    });
  });

  test("#6 Órdenes (lista) carga", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/ops/ordenes");
    await expect(page).toHaveURL(/\/ops\/ordenes$/);
    await page.screenshot({
      path: "tests/results/bloque1-ordenes-lista.png",
      fullPage: true,
    });
  });

  test("#5 Detalle de traspaso: captura para ver 'Cancelar traspaso' (sin clic)", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/ops/traspasos");
    // Mejor esfuerzo: abrir el primer traspaso que enlace a /ops/traspasos/<id>.
    const primer = page
      .locator(
        'a[href*="/ops/traspasos/"], [role="button"][href*="/ops/traspasos/"]',
      )
      .first();
    const hayTraspaso = await primer
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (!hayTraspaso) {
      test.info().annotations.push({
        type: "nota",
        description:
          "No se encontró ningún traspaso para abrir; verifica el botón Cancelar manualmente.",
      });
      return;
    }
    await primer.click();
    await page.waitForURL(/\/ops\/traspasos\/[0-9a-f-]+/i, { timeout: 15_000 });
    await page.waitForTimeout(1_000);
    // SOLO captura — NO hace clic en "Cancelar traspaso" (no toca datos reales).
    await page.screenshot({
      path: "tests/results/bloque1-traspaso-detalle.png",
      fullPage: true,
    });
  });
});
