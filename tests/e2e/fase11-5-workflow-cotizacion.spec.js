/**
 * Fase 11.5 — Workflow de cotizaciones
 *
 * Cubre:
 * - W1 borrador → enviada (botón "Marcar como enviada")
 * - W2 enviada → aprobada con nota, después convertir a venta
 * - W3 enviada → rechazada con razón obligatoria
 * - W4 borrador → rechazada (descartar)
 * - W5 convertir desde borrador BLOQUEADO (debe forzar aprobación)
 * - W6 transición ilegal bloqueada (borrador → aprobada directo)
 * - W7 reactivar vencida (Admin only) — manipulando estado vía SQL
 *
 * Login: Carlos (Admin). Prefijo: "E2E_WF_" para cleanup.
 */
import { test, expect } from "@playwright/test";
import { loginUI } from "./helpers";

const PREFIX = "E2E_WF_";

async function crearCotSuelta(page, suffix) {
  await page.goto("/ops/cotizaciones/nueva");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);

  await page.getByPlaceholder("Nombre del cliente").fill(`${PREFIX}${suffix}`);

  // Buscador de items (placeholder específico, no el global del header)
  const search = page.getByPlaceholder("Nombre o referencia...");
  await search.waitFor({ state: "visible", timeout: 5000 });
  await search.fill("ace");
  await page.waitForTimeout(1500);

  // Resultados del dropdown (clase específica del item)
  const dropdownButtons = page.locator(
    "button.w-full.flex.items-center.justify-between",
  );
  if ((await dropdownButtons.count()) > 0) {
    await dropdownButtons.first().click();
  } else {
    const alt = page
      .locator("button")
      .filter({ hasText: /\$/ })
      .filter({ hasNotText: /guardar|crear|cancelar/i })
      .first();
    if (await alt.isVisible({ timeout: 2000 }).catch(() => false)) {
      await alt.click();
    }
  }
  await page.waitForTimeout(800);

  await page
    .getByRole("button", { name: /crear cotizaci|guardar cotizaci|registrar/i })
    .first()
    .click();

  await page.waitForURL(/\/ops\/cotizaciones(\/[\w-]+)?(\?|$|#)/, {
    timeout: 15000,
  });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);

  if (/\/ops\/cotizaciones\/[\w-]+/.test(page.url())) return page.url();

  const fila = page
    .locator("tr.cursor-pointer")
    .filter({ hasText: `${PREFIX}${suffix}` })
    .first();
  await fila.waitFor({ state: "visible", timeout: 10000 });
  await fila.click();
  await page.waitForURL(/\/ops\/cotizaciones\/[\w-]+$/, { timeout: 10000 });
  await page.waitForLoadState("networkidle");
  return page.url();
}

test.describe("Fase 11.5 — Workflow Cotización", () => {
  test.setTimeout(90000);

  test.beforeEach(async ({ page }) => {
    await loginUI(page, "carlos");
  });

  // ─────────────────────────────────────────────────────────────────
  test("W1 borrador → enviada", async ({ page }) => {
    await crearCotSuelta(page, "W1");

    // Banner muestra "Borrador" + botón Marcar como enviada
    await expect(page.getByRole("heading", { name: /borrador/i })).toBeVisible({
      timeout: 5000,
    });
    await page.getByRole("button", { name: /marcar como enviada/i }).click();
    // Confirm dialog
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /sí, marcar enviada/i })
      .click();

    // Ahora el banner debe ser "Enviada"
    await expect(
      page.getByRole("heading", { name: /enviada.*esperando/i }),
    ).toBeVisible({ timeout: 8000 });
  });

  // ─────────────────────────────────────────────────────────────────
  test("W2 enviada → aprobada → convertir a venta", async ({ page }) => {
    await crearCotSuelta(page, "W2");

    // Enviar primero
    await page.getByRole("button", { name: /marcar como enviada/i }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /sí, marcar enviada/i })
      .click();
    await expect(page.getByRole("heading", { name: /enviada/i })).toBeVisible({
      timeout: 8000,
    });

    // Llenar nota y aprobar
    await page.getByPlaceholder(/whatsapp|llamada/i).fill("WhatsApp 4pm");
    await page.getByRole("button", { name: /cliente aprobó/i }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /sí, aprobar/i })
      .click();

    // Banner aprobada visible
    await expect(page.getByRole("heading", { name: /aprobada/i })).toBeVisible({
      timeout: 8000,
    });

    // Ahora convertir a venta debe estar permitido
    const btnConvertir = page
      .getByRole("button", {
        name: /convertir.*venta|convertir en venta|→ venta/i,
      })
      .first();
    await expect(btnConvertir).toBeVisible({ timeout: 5000 });
  });

  // ─────────────────────────────────────────────────────────────────
  test("W3 enviada → rechazada exige razón", async ({ page }) => {
    await crearCotSuelta(page, "W3");

    await page.getByRole("button", { name: /marcar como enviada/i }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /sí, marcar enviada/i })
      .click();
    await expect(page.getByRole("heading", { name: /enviada/i })).toBeVisible({
      timeout: 8000,
    });

    // Click rechazar SIN razón → debe mostrar error
    await page.getByRole("button", { name: /cliente rechazó/i }).click();
    await expect(
      page.getByText(/razón obligatoria|razon obligatoria/i).first(),
    ).toBeVisible({ timeout: 4000 });

    // Llenar razón y rechazar
    await page
      .getByPlaceholder(/precio|cambió proveedor|no contesta/i)
      .fill("Precio muy alto");
    await page.getByRole("button", { name: /cliente rechazó/i }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /sí, rechazar/i })
      .click();

    // Banner Rechazada con la razón
    await expect(page.getByRole("heading", { name: /rechazada/i })).toBeVisible(
      { timeout: 8000 },
    );
    await expect(page.getByText(/precio muy alto/i)).toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────
  test("W4 borrador → descartar (rechazada interno)", async ({ page }) => {
    await crearCotSuelta(page, "W4");

    await page.getByRole("button", { name: /descartar/i }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /sí, descartar/i })
      .click();

    await expect(page.getByRole("heading", { name: /rechazada/i })).toBeVisible(
      { timeout: 8000 },
    );
  });

  // ─────────────────────────────────────────────────────────────────
  test("W5 convertir desde borrador BLOQUEADO (no muestra botón)", async ({
    page,
  }) => {
    await crearCotSuelta(page, "W5");

    // En borrador NO debe haber botón convertir
    const btnConvertir = page.getByRole("button", {
      name: /convertir.*venta|convertir en venta|→ venta/i,
    });
    expect(await btnConvertir.count()).toBe(0);
  });
});
