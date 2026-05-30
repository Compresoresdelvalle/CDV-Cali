/* global process */
/**
 * TEMPORAL — smoke del nuevo flujo de Ensambles (estados + técnico). BORRAR luego.
 * Login ADMIN. PIN por env: TEST_ADMIN_PIN.
 *
 * Checks SIN mutar datos (la UI del flujo):
 *  - Lista de Ensambles: las 3 pestañas (En proceso / Terminados / Completados).
 *  - EnsambleNuevo: al elegir un compresor aparece el selector "Técnico asignado"
 *    (Paso 2b), la sección de insumos y el botón "Crear ensamble".
 *  - Detalle de ensamble (si hay alguno): carga con su estado e "Insumos de la receta".
 *
 * El ciclo real (crear → terminado → completar → eliminar) y los permisos por rol
 * (vendedora crea/completa, técnico marca terminado) van en las pruebas MANUALES,
 * porque crean datos y requieren iniciar sesión con cada rol.
 *
 * Correr:
 *   $env:TEST_ADMIN_PIN="<pin>"; npx playwright test tests/e2e/_p3_flujo_ensamble_smoke.spec.js --project=chromium
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

test.describe("Flujo de Ensambles — smoke (Admin)", () => {
  test.beforeAll(() => {
    if (!ADMIN.pin) {
      throw new Error(
        'Falta el PIN. Corre con:  $env:TEST_ADMIN_PIN="<pin>"; npx playwright test tests/e2e/_p3_flujo_ensamble_smoke.spec.js --project=chromium',
      );
    }
  });

  test("Lista: pestañas En proceso / Terminados / Completados", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/ops/ensambles");
    await expect(
      page.getByRole("button", { name: /^En proceso$/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /^Terminados$/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Completados$/i }),
    ).toBeVisible();
    await page.screenshot({
      path: "tests/results/p3-ensambles-tabs.png",
      fullPage: true,
    });
  });

  test("Nuevo: técnico asignado + insumos + botón Crear ensamble", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/ops/ensambles/nuevo");
    const search = page.locator('input[placeholder*="ensamblable" i]').first();
    await search.waitFor({ state: "visible", timeout: 15_000 });
    await search.fill("COMPRESOR");
    const primer = page.getByRole("button", { name: /COMPRESOR/i }).first();
    await primer.waitFor({ state: "visible", timeout: 15_000 });
    await primer.click();
    await expect(page.getByText(/técnico asignado/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/insumos de la receta/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /crear ensamble/i }),
    ).toBeVisible();
    await page.screenshot({
      path: "tests/results/p3-ensamble-nuevo.png",
      fullPage: true,
    });
  });

  test("Detalle: abre un ensamble existente (best-effort)", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/ops/ensambles");
    // La primera fila/card es clicable → detalle.
    const fila = page.locator("tr.cursor-pointer, div.cursor-pointer").first();
    const hay = await fila
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (!hay) {
      test.info().annotations.push({
        type: "nota",
        description:
          "No hay ensambles para abrir (crea uno en las pruebas manuales).",
      });
      return;
    }
    await fila.click();
    await page.waitForURL(/\/ops\/ensambles\/[0-9a-f-]+/i, { timeout: 15_000 });
    await expect(page.getByText(/insumos de la receta/i)).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: "tests/results/p3-ensamble-detalle.png",
      fullPage: true,
    });
  });
});
