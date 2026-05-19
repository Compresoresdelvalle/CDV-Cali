/**
 * E2E Fase 15 — Dashboard expandido + Cierres.
 *
 * Cubre: módulo Cierres en el panel admin, sección de ingresos por categoría
 * en el Dashboard, previsualizar + generar un cierre, y rechazo de solapamiento.
 *
 * Nota: `cierres` es append-only (no se puede borrar). Cada corrida usa una
 * ventana de fecha única (en el pasado lejano) para no colisionar con
 * corridas previas. No se usan fechas futuras: cerrar un periodo futuro es
 * un sin-sentido contable y la app lo rechaza.
 */
import { test, expect } from "@playwright/test";
import { loginUI } from "./helpers.js";

// Día único por corrida — pasado lejano (2000-2008), derivado del reloj.
// Pasado, para no colisionar con datos reales ni con la validación de la app
// que prohíbe cerrar periodos con fecha futura.
function fechaUnica() {
  const offset = Date.now() % 3000;
  const d = new Date(Date.UTC(2000, 0, 1));
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

test.describe("Fase 15 — Cierres", () => {
  test("Admin tiene el módulo Cierres registrado en el panel", async ({
    page,
  }) => {
    await loginUI(page, "carlos");
    await page.goto("/admin");
    // El link aparece en varios navs (sidebar desktop, drawer móvil); basta
    // con verificar que está registrado y visible.
    await expect(page.locator('a[href="/admin/cierres"]').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("Dashboard muestra ingresos por categoría", async ({ page }) => {
    await loginUI(page, "carlos");
    await page.goto("/admin");
    await expect(
      page.getByText("Ingresos por categoría", { exact: false }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Ingresos productos")).toBeVisible();
    await expect(page.getByText("Ingresos servicios")).toBeVisible();
    await expect(page.getByText("Margen")).toBeVisible();
  });

  test("Previsualizar, generar cierre y rechazar solapamiento", async ({
    page,
  }) => {
    await loginUI(page, "carlos");
    await page.goto("/admin/cierres");

    await expect(page.locator('button:has-text("Previsualizar")')).toBeVisible({
      timeout: 15_000,
    });

    // Tipo diario (default) — fija hasta = desde automáticamente.
    const dia = fechaUnica();
    await page.locator('input[type="date"]').first().fill(dia);

    // Previsualizar.
    await page.locator('button:has-text("Previsualizar")').click();
    await expect(page.getByText("Vista previa", { exact: false })).toBeVisible({
      timeout: 15_000,
    });

    // Generar — abre el diálogo de confirmación y confirma.
    await page.locator('button:has-text("Generar cierre")').first().click();
    await page
      .locator('[role="alertdialog"] button:has-text("Generar cierre")')
      .click();

    // Mensaje de éxito.
    await expect(
      page.getByText("generado correctamente", { exact: false }),
    ).toBeVisible({ timeout: 20_000 });

    // Re-previsualizar el mismo rango → debe avisar solapamiento.
    await page.locator('button:has-text("Previsualizar")').click();
    await expect(
      page.locator('[role="alert"]').filter({ hasText: "solapa" }),
    ).toBeVisible({ timeout: 15_000 });

    // El botón Generar queda deshabilitado por el solapamiento.
    await expect(
      page.locator('button:has-text("Generar cierre")').first(),
    ).toBeDisabled();
  });
});
