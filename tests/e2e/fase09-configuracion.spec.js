/**
 * E2E Fase 9 — Configuración General (módulo Admin).
 *
 * Spec NO destructivo: verifica renderizado y navegación de tabs sin crear
 * cuentas/parámetros/componentes reales. La RLS Admin-only de las 3 tablas
 * está cubierta por el stress SQL.
 *
 * Login como Carlos (Admin): único rol con acceso al Panel Admin.
 */
import { test, expect } from "@playwright/test";
import { loginUI } from "./helpers.js";

test.describe("Fase 9 — Configuración General", () => {
  test("Configuración carga con las 3 tabs", async ({ page }) => {
    await loginUI(page, "carlos");
    await page.goto("/admin/configuracion");
    await expect(
      page.getByRole("tab", { name: /Cuentas Bancarias/i }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("tab", { name: /Checklist OT/i }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: /Parámetros/i })).toBeVisible();
  });

  test("Tab Cuentas Bancarias muestra el listado", async ({ page }) => {
    await loginUI(page, "carlos");
    await page.goto("/admin/configuracion");
    await page.getByRole("tab", { name: /Cuentas Bancarias/i }).click();
    await expect(page.locator('button:has-text("Nueva cuenta")')).toBeVisible({
      timeout: 15_000,
    });
  });

  test("Tab Parámetros muestra los parámetros del sistema", async ({
    page,
  }) => {
    await loginUI(page, "carlos");
    await page.goto("/admin/configuracion");
    await page.getByRole("tab", { name: /Parámetros/i }).click();
    await page.waitForTimeout(2500);
    // Debe verse al menos una fila de parámetro o el banner informativo.
    await expect(
      page.getByText(/Parámetros consumidos|iva_pct|dias_garantia/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Tab Checklist OT muestra el catálogo de componentes", async ({
    page,
  }) => {
    await loginUI(page, "carlos");
    await page.goto("/admin/configuracion");
    await page.getByRole("tab", { name: /Checklist OT/i }).click();
    await expect(
      page.locator('button:has-text("Nuevo componente")'),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("RBAC — un Vendedor no accede a Configuración", async ({ page }) => {
    await loginUI(page, "maria");
    await page.goto("/admin/configuracion");
    // RoleGuard redirige a los no-Admin fuera de /admin.
    await page.waitForURL(/\/ops($|\/)/, { timeout: 15_000 });
    expect(page.url()).not.toMatch(/\/admin\/configuracion/);
  });
});
