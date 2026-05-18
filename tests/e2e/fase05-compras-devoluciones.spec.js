/**
 * E2E Fase 5 — Compras + Devoluciones.
 *
 * Spec NO destructivo: verifica renderizado, búsqueda, carrito y validación
 * de los formularios sin registrar compras/devoluciones reales (eso queda
 * cubierto por el stress SQL y el test de integración, que sí mutan la BD).
 *
 * Login como Pedro (Bodeguero): es el rol que opera Compras y Devoluciones.
 */
import { test, expect } from "@playwright/test";
import { loginUI } from "./helpers.js";

test.describe("Fase 5 — Compras + Devoluciones", () => {
  test("El historial de compras carga", async ({ page }) => {
    await loginUI(page, "pedro");
    await page.goto("/ops/compras");
    await page.waitForTimeout(3000);
    const filas = page.locator("tbody tr");
    const vacio = page.getByText(/Sin compras registradas/i);
    await expect(filas.first().or(vacio)).toBeVisible({ timeout: 20_000 });
  });

  test("Nueva Compra renderiza el formulario", async ({ page }) => {
    await loginUI(page, "pedro");
    await page.goto("/ops/compras/nueva");
    await expect(
      page.locator('input[placeholder*="proveedor" i]').first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.locator('input[placeholder*="por nombre o referencia" i]'),
    ).toBeVisible();
  });

  test("Agregar un producto al carrito calcula el subtotal", async ({
    page,
  }) => {
    await loginUI(page, "pedro");
    await page.goto("/ops/compras/nueva");
    const search = page.locator(
      'input[placeholder*="por nombre o referencia" i]',
    );
    await search.waitFor({ state: "visible", timeout: 20_000 });
    await search.fill("filtro");
    // Debounce 300ms + ida y vuelta al servidor.
    await page.waitForTimeout(2500);
    const resultado = page.locator('button:has-text("Agregar")').first();
    await resultado.waitFor({ state: "visible", timeout: 15_000 });
    await resultado.click();
    // El carrito (tabla desktop) muestra la fila del producto.
    await expect(page.locator("table tbody tr").first()).toBeVisible({
      timeout: 10_000,
    });
    // El bloque de Totales aparece al haber al menos un ítem.
    await expect(page.getByText(/Subtotal/i).first()).toBeVisible();
  });

  test("Registrar compra está deshabilitado sin proveedor ni productos", async ({
    page,
  }) => {
    await loginUI(page, "pedro");
    await page.goto("/ops/compras/nueva");
    const btn = page.locator('button:has-text("Registrar compra")');
    await btn.waitFor({ state: "visible", timeout: 20_000 });
    await expect(btn).toBeDisabled();
  });

  test("El historial de devoluciones carga", async ({ page }) => {
    await loginUI(page, "pedro");
    await page.goto("/ops/devoluciones");
    await page.waitForTimeout(3000);
    const filas = page.locator("tbody tr");
    const vacio = page.getByText(/Sin devoluciones registradas/i);
    await expect(filas.first().or(vacio)).toBeVisible({ timeout: 20_000 });
  });

  test("Nueva Devolución renderiza y alterna el tipo", async ({ page }) => {
    await loginUI(page, "pedro");
    await page.goto("/ops/devoluciones/nueva");
    const proveedorBtn = page.locator(
      'button:has-text("Devolución a proveedor")',
    );
    await proveedorBtn.waitFor({ state: "visible", timeout: 20_000 });
    // El campo de venta solo existe para devoluciones de cliente.
    await expect(
      page.locator('input[placeholder*="UUID de la venta" i]'),
    ).toHaveCount(1);
    await proveedorBtn.click();
    await expect(
      page.locator('input[placeholder*="UUID de la venta" i]'),
    ).toHaveCount(0);
  });
});
