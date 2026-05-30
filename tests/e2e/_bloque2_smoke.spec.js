/**
 * TEMPORAL — smoke test del Bloque 2 (insumos + ubicación). BORRAR tras verificar.
 * Login como ADMIN. PIN por env: TEST_ADMIN_PIN (NUNCA hardcodear el PIN aquí).
 *
 * Cubre, como ADMIN y SOLO sobre el producto de prueba (TEST-PRUEBA-001):
 *  - #7 Ventas OCULTA insumos (busca un insumo real → no aparece; busca el de
 *       prueba → sí aparece).
 *  - #7 ProductoDetalle muestra doble stock (Venta/Insumo) por sede, la Ubicación,
 *       y los botones de conversión (solo Admin).
 *  - #7 Conversión venta→insumo y de vuelta (round-trip que se AUTO-REVIERTE:
 *       neto 0 en el stock del producto de prueba).
 *  - #8 ProductoForm (nuevo) tiene los campos Stand / Posición / Vendible.
 *  - Regresión: Órdenes carga.
 *
 * Lo que NO automatiza (va en pruebas MANUALES): consumir insumo en una OT real,
 * ensamble, ocultar insumos por rol no-Admin, crear un producto con ubicación.
 *
 * Correr (PowerShell), con el dev server en :5174 ya levantado (npm run dev):
 *   $env:TEST_ADMIN_PIN="<tu-pin>"; npx playwright test tests/e2e/_bloque2_smoke.spec.js --project=chromium
 */
/* global process */
import { test, expect } from "@playwright/test";

const ADMIN = { nombre: "Admin", pin: process.env.TEST_ADMIN_PIN || "" };

// Producto de prueba (categoria='PRUEBA', stock 999, vendible). NO es un insumo.
const TEST_PROD_ID = "8d524a87-0b2a-4060-af18-afb727008dd4"; // INVENTARIO DE PRUEBA 1
// Un insumo real (categoria='INSUMOS', vendible=false tras la migración).
const INSUMO_NOMBRE = "AEROSOL LIMPIADOR DE CONTACTOS";

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

test.describe("Bloque 2 — smoke (Admin)", () => {
  test.beforeAll(() => {
    if (!ADMIN.pin) {
      throw new Error(
        'Falta el PIN. Corre con:  $env:TEST_ADMIN_PIN="<pin>"; npx playwright test tests/e2e/_bloque2_smoke.spec.js --project=chromium',
      );
    }
  });

  test("#7 Ventas: oculta insumos y muestra vendibles", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/ops/ventas/nueva");
    const search = page.locator('input[placeholder*="referencia" i]').first();
    await search.waitFor({ state: "visible", timeout: 15_000 });

    // Vendible: el producto de prueba SÍ aparece.
    await search.fill("INVENTARIO DE PRUEBA");
    await expect(page.getByText(/INVENTARIO DE PRUEBA/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Insumo: NO debe aparecer en el buscador de ventas.
    await search.fill("");
    await search.fill(INSUMO_NOMBRE);
    await page.waitForTimeout(1_500); // debounce 400ms + red
    await expect(page.getByText(new RegExp(INSUMO_NOMBRE, "i"))).toHaveCount(0);
    await page.screenshot({
      path: "tests/results/bloque2-ventas-oculta-insumo.png",
      fullPage: true,
    });
  });

  test("#7 ProductoDetalle: doble stock + ubicación + botones convertir", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto(`/ops/inventario/${TEST_PROD_ID}`);
    await expect(page.getByText(/stock por sede/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Venta:/i).first()).toBeVisible();
    await expect(page.getByText(/Insumo:/i).first()).toBeVisible();
    await expect(page.getByText(/Ubicación/i).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /a insumo/i }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: "tests/results/bloque2-detalle-doble-stock.png",
      fullPage: true,
    });
  });

  test("#7 Conversión venta→insumo y de vuelta (auto-revierte)", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto(`/ops/inventario/${TEST_PROD_ID}`);
    await expect(page.getByText(/stock por sede/i)).toBeVisible({
      timeout: 15_000,
    });

    // Convertir 1 de venta a insumo.
    await page
      .getByRole("button", { name: /a insumo/i })
      .first()
      .click();
    const modal = page.locator('input[type="number"]').last();
    await modal.waitFor({ state: "visible", timeout: 10_000 });
    await modal.fill("1");
    await page.getByRole("button", { name: /confirmar/i }).click();
    await expect(page.getByText(/Insumo:\s*1/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: "tests/results/bloque2-convertido.png",
      fullPage: true,
    });

    // Revertir: devolver 1 de insumo a venta (deja el stock como estaba).
    await page
      .getByRole("button", { name: /a venta/i })
      .first()
      .click();
    const modal2 = page.locator('input[type="number"]').last();
    await modal2.waitFor({ state: "visible", timeout: 10_000 });
    await modal2.fill("1");
    await page.getByRole("button", { name: /confirmar/i }).click();
    await expect(page.getByText(/Insumo:\s*0/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("#8 ProductoForm (nuevo) tiene Stand / Posición / Vendible", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/ops/inventario/nuevo");
    await expect(page.getByText(/clasificación y ubicación/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/stand/i).first()).toBeVisible();
    await expect(page.getByText(/posición/i).first()).toBeVisible();
    await expect(page.getByText(/vendible/i).first()).toBeVisible();
    await page.screenshot({
      path: "tests/results/bloque2-form-ubicacion.png",
      fullPage: true,
    });
  });

  test("Regresión: Órdenes carga", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/ops/ordenes");
    await expect(page).toHaveURL(/\/ops\/ordenes$/);
  });
});
