/**
 * B12 — Capturas de UX móvil. NO es un test de aserción: navega las pantallas
 * clave en viewport de celular (375px, y 320px para los formularios más densos)
 * y guarda PNG fullPage en tests/results/mobile/ para revisión visual de
 * overflow, tap-targets y recortes. Login como Admin (carlos) para alcanzar
 * /ops y /admin. Cada ruta va en try/catch para que una falla no aborte el resto.
 */
import { test } from "@playwright/test";

const OUT = "tests/results/mobile";

// Credenciales por env var (no se commitea ningún secreto). Ejemplo:
//   B12_USER="Admin Maritza" B12_PIN=1234 npm run test:e2e -- _b12_mobile_shots
const ENV = globalThis.process?.env ?? {};
const B12_USER = ENV.B12_USER;
const B12_PIN = ENV.B12_PIN;

/** Login por nombre visible + PIN (mismos pasos que helpers.loginUI). */
async function loginEnv(page) {
  await page.goto("/");
  await page
    .locator(`button:has-text("${B12_USER}")`)
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.locator(`button:has-text("${B12_USER}")`).first().click();
  const pin = page.locator('input[type="password"]');
  await pin.first().waitFor({ state: "visible", timeout: 10_000 });
  const digits = String(B12_PIN).split("");
  for (let i = 0; i < digits.length; i++) {
    await pin.nth(i).click();
    await pin.nth(i).pressSequentially(digits[i]);
  }
  await page.waitForURL(/\/(ops|admin)/, { timeout: 20_000 });
}

// Pantallas de alto riesgo en móvil (formularios densos + listas + el módulo nuevo).
const ROUTES = [
  ["dashboard", "/ops"],
  ["inventario", "/ops/inventario"],
  ["venta-nueva", "/ops/ventas/nueva"],
  ["cotizacion-nueva", "/ops/cotizaciones/nueva"],
  ["compra-nueva", "/ops/compras/nueva"],
  ["orden-nueva", "/ops/ordenes/nueva"],
  ["recibo-nuevo", "/ops/recibos/nuevo"],
  ["traspasos", "/ops/traspasos"],
  ["herramientas", "/ops/herramientas"],
  ["ensambles", "/ops/ensambles"],
  ["admin-cuentas", "/admin/cuentas"],
];

async function shoot(page, name, route, width) {
  try {
    await page.setViewportSize({ width, height: 812 });
    await page.goto(route, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: `${OUT}/${name}-${width}.png`,
      fullPage: true,
    });
    console.log(`OK  ${name}@${width}  (${page.url()})`);
  } catch (e) {
    console.log(`FAIL ${name}@${width} (${route}): ${e.message}`);
  }
}

test("capturas móvil B12", async ({ page }) => {
  test.skip(
    !B12_USER || !B12_PIN,
    'Define B12_USER y B12_PIN (ej: B12_USER="Admin Maritza" B12_PIN=1234) para capturar pantallas autenticadas.',
  );
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await loginEnv(page);

  for (const [name, route] of ROUTES) {
    await shoot(page, name, route, 375);
  }
  // 320px solo para los formularios más propensos a desbordar.
  await shoot(page, "venta-nueva", "/ops/ventas/nueva", 320);
  await shoot(page, "cotizacion-nueva", "/ops/cotizaciones/nueva", 320);
});
