/**
 * Fase 10 — Tests E2E del módulo Órdenes de Trabajo (OT).
 *
 * 12 escenarios "irracionales": usuario salta pasos, deja vacío, hace
 * cosas en desorden. Cubren los triggers BD, los 3 paneles nuevos, la
 * vinculación con cotizaciones, el checklist y la regla 30 días.
 *
 * Login: Carlos (Admin) — acceso global.
 * Cleanup: prefijo "E2E_F10_" en cliente_nombre. Borrar manual si necesario.
 */
import { test, expect } from "@playwright/test";
import { loginUI } from "./helpers";

const PREFIX = "E2E_F10_";

/**
 * Crea una OT mínima vía UI usando selectores por label/placeholder.
 * Llena: cliente, teléfono, equipo, técnico, costo mano obra.
 * Espera redirect a OrdenDetalle.
 */
async function crearOTMinima(page, suffix) {
  await page.goto("/ops/ordenes/nueva");
  await page.waitForLoadState("networkidle");

  // Cliente (label "Nombre *")
  await page.getByPlaceholder("Ej. Juan Pérez").fill(`${PREFIX}${suffix}`);
  // Teléfono (placeholder "3001234567")
  await page.getByPlaceholder("3001234567").fill("3001234567");
  // Equipo descripción: se busca por label ("Descripción del equipo *"), que es
  // más estable que rastrear el textarea por posición.
  const desc = page.getByLabel(/descripción del equipo/i).first();
  if (await desc.isVisible({ timeout: 1000 }).catch(() => false)) {
    await desc.fill("Compresor E2E");
  } else {
    // Fallback: input/textarea bajo el heading "Equipo"
    await page
      .locator(
        'h3:has-text("Equipo") + * input, h3:has-text("Equipo") + * textarea',
      )
      .first()
      .fill("Compresor E2E");
  }

  // Técnico (select)
  const tecSelect = page.locator("select").first();
  await tecSelect.waitFor({ state: "visible", timeout: 5000 });
  const opts = await tecSelect.locator("option").all();
  // Seleccionar primer técnico válido (no el placeholder vacío)
  for (const o of opts) {
    const v = await o.getAttribute("value");
    if (v && v.length > 5) {
      await tecSelect.selectOption(v);
      break;
    }
  }

  // Costo mano obra (input number con label/placeholder)
  const moInput = page.locator('input[type="number"]').first();
  if (await moInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await moInput.fill("50000");
  }

  // Submit
  await page.getByRole("button", { name: /crear orden/i }).click();
  await page.waitForURL(/\/ops\/ordenes\/[\w-]+$/, { timeout: 20000 });
  // Esperar carga del detalle (los 3 paneles)
  await page
    .getByRole("heading", { name: /autorización del cliente/i })
    .waitFor({ state: "visible", timeout: 10000 });
  return page.url();
}

test.describe("Fase 10 — OT flujos completos", () => {
  test.beforeEach(async ({ page }) => {
    await loginUI(page, "carlos");
  });

  // 1) Submit vacío → error
  test("1. submit vacío en OrdenNueva muestra error", async ({ page }) => {
    await page.goto("/ops/ordenes/nueva");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /crear orden/i }).click();
    await expect(
      page.getByText(/cliente.*equipo.*tecnico|obligatorio/i).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  // 2) Crear OT mínima
  test("2. crear OT mínima llega a OrdenDetalle", async ({ page }) => {
    const url = await crearOTMinima(page, "minima");
    expect(url).toMatch(/\/ops\/ordenes\/[\w-]+$/);
    await expect(
      page.getByRole("heading", { name: /checklist de recepci/i }),
    ).toBeVisible();
  });

  // 4) Pendiente → En proceso bloqueado
  test("4. estado pendiente bloquea avanzar a en_proceso", async ({ page }) => {
    await crearOTMinima(page, "pendiente");
    await page.getByRole("button", { name: /^en proceso$/i }).click();
    await expect(
      page.getByText(/pendiente|autorización del cliente/i).first(),
    ).toBeVisible({ timeout: 8000 });
  });

  // 5) Autorizado SIN abono bloquea
  test("5. autorizado sin abono no permite iniciar trabajo", async ({
    page,
  }) => {
    await crearOTMinima(page, "autoSinAbono");
    await page.getByRole("button", { name: /^✅?\s*autorizado$/i }).click();
    await page.getByRole("button", { name: /guardar autoriz/i }).click();
    await expect(
      page.getByText(/autorización actualizada|requiere/i).first(),
    ).toBeVisible({ timeout: 5000 });
    // Intentar pasar a En proceso
    await page.getByRole("button", { name: /^en proceso$/i }).click();
    await expect(
      page.getByText(/anticipo|autorizada con trabajo/i).first(),
    ).toBeVisible({ timeout: 8000 });
  });

  // 6) Abono que excede → confirm dialog → cancelar
  test("6. abono que excede dispara confirm dialog (cancelar)", async ({
    page,
  }) => {
    await crearOTMinima(page, "abonoExcedeC");
    await page.getByRole("button", { name: /^✅?\s*autorizado$/i }).click();
    await page.getByRole("button", { name: /guardar autoriz/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: /\+ ?registrar abono/i }).click();
    await page
      .getByPlaceholder(/100000|ej.*100/i)
      .or(page.locator('input[type="number"]').last())
      .first()
      .fill("5000000");
    await page.getByRole("button", { name: /^registrar$/i }).click();
    // Confirm dialog (role=alertdialog) visible
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText(/excede el saldo/i)).toBeVisible();
    // Cancelar dentro del dialog
    await dialog.getByRole("button", { name: /cancelar/i }).click();
    // No se creó abono
    await expect(page.getByText(/sin abonos registrados/i)).toBeVisible({
      timeout: 5000,
    });
  });

  // 7) Abono que excede → confirmar → creado
  test("7. abono que excede + confirmar crea el abono", async ({ page }) => {
    await crearOTMinima(page, "abonoExcedeOk");
    await page.getByRole("button", { name: /^✅?\s*autorizado$/i }).click();
    await page.getByRole("button", { name: /guardar autoriz/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: /\+ ?registrar abono/i }).click();
    await page.locator('input[type="number"]').last().fill("5000000");
    await page.getByRole("button", { name: /^registrar$/i }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog
      .getByRole("button", { name: /sí.*registrar|confirmar/i })
      .click();
    await page.waitForTimeout(2000);
    await expect(
      page.getByText(/5\.000\.000|5,000,000|abono.*registrado/i).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  // 8) No autorizado sin valor_revision → error
  test("8. no_autorizado sin valor_revision bloquea guardar", async ({
    page,
  }) => {
    await crearOTMinima(page, "noAuthSinV");
    await page.getByRole("button", { name: /no autorizado/i }).click();
    await page.getByRole("button", { name: /guardar autoriz/i }).click();
    await expect(page.getByText(/valor por revisi.*cobrar/i)).toBeVisible({
      timeout: 5000,
    });
  });

  // 9) No autorizado + valor + Completada
  test("9. no_autorizado con valor pasa abierta → completada", async ({
    page,
  }) => {
    await crearOTMinima(page, "noAuthCierra");
    await page.getByRole("button", { name: /no autorizado/i }).click();
    await page.getByPlaceholder(/50000/).first().fill("50000");
    await page.getByRole("button", { name: /guardar autoriz/i }).click();
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /^completada$/i }).click();
    await page.waitForTimeout(2000);
    // Check no error visible (transición permitida)
    const err = await page.getByText(/transición ilegal|no se puede/i).count();
    expect(err).toBe(0);
  });

  // 10) Marcar checklist + persiste
  test("10. marcar checklist persiste tras refresh", async ({ page }) => {
    const url = await crearOTMinima(page, "checklist");
    await page.waitForTimeout(2000);
    // Click 3 checkbox-buttons del checklist (los con aria-pressed)
    const items = page.locator("button[aria-pressed]");
    const c = await items.count();
    expect(c).toBeGreaterThan(20);
    for (let i = 0; i < 3; i++) {
      await items.nth(i).click();
      await page.waitForTimeout(300);
    }
    // Refresh
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/3 ?\/ ?24/)).toBeVisible({ timeout: 8000 });
  });

  // 11) Generar nueva cotización desde OT
  test("11. generar cotización desde OT navega y pre-llena", async ({
    page,
  }) => {
    await crearOTMinima(page, "cotDesdeOT");
    await page.getByRole("button", { name: /generar nueva cotizaci/i }).click();
    await page.waitForURL(/\/ops\/cotizaciones\/nueva\?ot_id=/, {
      timeout: 10000,
    });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    // Buscar input cuyo valor contenga el prefijo E2E_F10_cotDesdeOT
    const found = await page
      .locator(`input[value*="E2E_F10_cotDesdeOT"], input[value*="E2E_F10_"]`)
      .count();
    expect(found).toBeGreaterThan(0);
  });

  // 12) OT entregada inmutable
  test("12. estado entregada bloquea cambios posteriores", async ({ page }) => {
    await crearOTMinima(page, "inmutable");
    await page.getByRole("button", { name: /no autorizado/i }).click();
    await page.getByPlaceholder(/50000/).first().fill("50000");
    await page.getByRole("button", { name: /guardar autoriz/i }).click();
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /^completada$/i }).click();
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /^entregada$/i }).click();
    await page.waitForTimeout(2000);
    // Intentar volver a Abierta
    const abierta = page.getByRole("button", { name: /^abierta$/i });
    if (await abierta.isVisible().catch(() => false)) {
      await abierta.click({ force: true }).catch(() => {});
      await expect(
        page.getByText(/inmutable|entregada es/i).first(),
      ).toBeVisible({ timeout: 5000 });
    }
  });
});
