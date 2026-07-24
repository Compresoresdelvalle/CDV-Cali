/**
 * TEMPORAL — smoke test del Bloque 0 (BORRAR tras la verificación).
 * Valida: fix de login (EMAIL_MAP), página de Clientes, búsqueda de productos
 * de prueba en venta, y creación de cliente que aparece en la lista.
 * PIN por env: TEST_ADMIN_PIN
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

test.describe("Bloque 0 — smoke", () => {
  test("Admin inicia sesión (fix EMAIL_MAP)", async ({ page }) => {
    await loginAdmin(page);
    await expect(page).toHaveURL(/\/(ops|admin)/);
  });

  test("Página de Clientes carga y muestra encabezado", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/ops/clientes");
    await expect(
      page.getByRole("button", { name: /nuevo cliente/i }),
    ).toBeVisible({ timeout: 15_000 });
    await page.screenshot({
      path: "tests/results/bloque0-clientes.png",
      fullPage: true,
    });
  });

  test("Nueva venta encuentra los productos de prueba", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/ops/ventas/nueva");
    // Buscador de PRODUCTOS de la venta (placeholder incluye "referencia"),
    // NO la barra global del header ("Buscar productos, ventas, clientes…").
    const search = page.locator('input[placeholder*="referencia" i]').first();
    await search.waitFor({ state: "visible", timeout: 15_000 });
    await search.click();
    await search.fill("INVENTARIO DE PRUEBA");
    await expect(page.getByText(/INVENTARIO DE PRUEBA/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: "tests/results/bloque0-venta-busqueda.png",
      fullPage: true,
    });
  });

  test("Crear cliente desde la página y verlo en la lista", async ({
    page,
  }) => {
    const NOMBRE = "CLIENTE QA E2E";
    await loginAdmin(page);
    await page.goto("/ops/clientes");
    await page.getByRole("button", { name: /nuevo cliente/i }).click();
    const nombreInput = page.locator('input[placeholder*="XYZ" i]').first();
    await nombreInput.waitFor({ state: "visible", timeout: 10_000 });
    await nombreInput.fill(NOMBRE);
    await page.getByRole("button", { name: /crear cliente/i }).click();
    // Buscar en la lista para confirmar que quedó creado.
    const listSearch = page
      .locator('input[placeholder*="identificaci" i]')
      .first();
    await listSearch.waitFor({ state: "visible", timeout: 10_000 });
    await listSearch.fill(NOMBRE);
    await expect(page.getByText(NOMBRE).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: "tests/results/bloque0-cliente-creado.png",
      fullPage: true,
    });
  });
});
