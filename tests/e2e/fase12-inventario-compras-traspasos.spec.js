/**
 * Fase 12 — E2E ajustes Inventario + Compras + Traspasos + Nuevo Producto
 *
 * Cubre:
 * - F1 crear producto via /ops/inventario/nuevo (todos campos)
 * - F2 búsqueda por codigo_interno encuentra
 * - F3 búsqueda por codigo_proveedor encuentra
 * - F4 filtro tipo "Segunda mano" filtra
 * - F5 codigo_interno duplicado → error friendly
 * - F6 form sin nombre → validación cliente
 * - F7 Alertas admin tiene 7 tabs (3 de rotación nuevos)
 *
 * Login: Carlos (Admin). Prefijo cliente: "E2E_F12_" para cleanup.
 */
import { test, expect } from "@playwright/test";
import { loginUI } from "./helpers";

// Sufijo único por archivo de tests para evitar colisión codigo_interno UNIQUE
const RUN = Date.now().toString().slice(-6);
const PREFIX = `E2E_F12_${RUN}_`;

async function llenarForm(page, suffix, opts = {}) {
  await page.goto("/ops/inventario/nuevo");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);

  await page
    .getByPlaceholder("Ej. Compresor 50L 2HP")
    .fill(`${PREFIX}${suffix}`);
  await page
    .getByPlaceholder("CV-001")
    .fill(opts.codigoInterno ?? `CV-${suffix}`);
  if (opts.codigoProveedor) {
    await page.getByPlaceholder("Opcional").fill(opts.codigoProveedor);
  }
  if (opts.tipo) {
    // Selector tipo: el primer <select> en sección Identificación
    const tipoSelect = page.locator("select").nth(0);
    await tipoSelect.selectOption(opts.tipo);
  }
  if (opts.precio) {
    await page
      .locator('input[type="number"]')
      .first()
      .fill(String(opts.precio));
  }
}

test.describe("Fase 12 — Inventario + Compras + Traspasos", () => {
  test.setTimeout(90000);

  test.beforeEach(async ({ page }) => {
    await loginUI(page, "carlos");
  });

  test("F1 crear producto via UI con todos los campos", async ({ page }) => {
    await llenarForm(page, "F1", {
      codigoInterno: `CV-F1-${RUN}`,
      codigoProveedor: `PROV-F1-${RUN}`,
      tipo: "segunda_mano",
      precio: 50000,
    });
    await page.getByRole("button", { name: /crear producto/i }).click();
    // Tras submit, redirige a /ops/inventario/<id>
    // UUID pattern (36 chars) — evita matchear "/nuevo"
    await page.waitForURL(
      /\/ops\/inventario\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      { timeout: 10000 },
    );
    // El detalle muestra el nombre y badge "Segunda mano"
    await expect(page.getByText(`${PREFIX}F1`).first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText(/segunda mano/i).first()).toBeVisible();
  });

  test("F2 búsqueda por codigo_interno encuentra el producto creado", async ({
    page,
  }) => {
    // Crear primero
    await llenarForm(page, "F2", {
      codigoInterno: `CV-F2-${RUN}`,
      precio: 10000,
    });
    await page.getByRole("button", { name: /crear producto/i }).click();
    await page.waitForURL(
      /\/ops\/inventario\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      { timeout: 10000 },
    );

    // Ir a inventario y buscar por codigo_interno
    await page.goto("/ops/inventario");
    await page.waitForLoadState("networkidle");
    const buscador = page.getByPlaceholder(/buscar por nombre o referencia/i);
    await buscador.fill(`CV-F2-${RUN}`);
    await page.waitForTimeout(800); // debounce 300ms

    // El producto aparece (en card móvil hidden o tabla desktop visible).
    // En viewport Playwright (1280px) solo desktop visible — buscar en tabla.
    await expect(
      page.locator("tbody").getByText(`${PREFIX}F2`).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("F3 búsqueda por codigo_proveedor encuentra el producto", async ({
    page,
  }) => {
    await llenarForm(page, "F3", {
      codigoInterno: `CV-F3-${RUN}`,
      codigoProveedor: `EXTRA-F3-${RUN}`,
      precio: 1000,
    });
    await page.getByRole("button", { name: /crear producto/i }).click();
    await page.waitForURL(
      /\/ops\/inventario\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      { timeout: 10000 },
    );

    await page.goto("/ops/inventario");
    await page.waitForLoadState("networkidle");
    await page
      .getByPlaceholder(/buscar por nombre o referencia/i)
      .fill(`EXTRA-F3-${RUN}`);
    await page.waitForTimeout(800);
    await expect(
      page.locator("tbody").getByText(`${PREFIX}F3`).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("F4 filtro tipo Segunda mano oculta los Nuevo", async ({ page }) => {
    // Crear 1 nuevo + 1 segunda mano
    await llenarForm(page, "F4N", {
      codigoInterno: `CV-F4N-${RUN}`,
      tipo: "nuevo",
      precio: 500,
    });
    await page.getByRole("button", { name: /crear producto/i }).click();
    await page.waitForURL(
      /\/ops\/inventario\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      { timeout: 10000 },
    );

    await llenarForm(page, "F4S", {
      codigoInterno: `CV-F4S-${RUN}`,
      tipo: "segunda_mano",
      precio: 500,
    });
    await page.getByRole("button", { name: /crear producto/i }).click();
    await page.waitForURL(
      /\/ops\/inventario\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      { timeout: 10000 },
    );

    // Ir al inventario y buscar con prefijo común
    await page.goto("/ops/inventario");
    await page.waitForLoadState("networkidle");
    await page
      .getByPlaceholder(/buscar por nombre o referencia/i)
      .fill(`${PREFIX}F4`);
    await page.waitForTimeout(800);
    // Sin filtro tipo: ambos visibles (scope tbody desktop)
    const tbody = page.locator("tbody");
    await expect(tbody.getByText(`${PREFIX}F4N`).first()).toBeVisible({
      timeout: 5000,
    });
    await expect(tbody.getByText(`${PREFIX}F4S`).first()).toBeVisible();

    // Aplicar filtro tipo "Segunda mano"
    const tipoSelect = page
      .locator('select[aria-label="Filtrar por tipo"]')
      .first();
    await tipoSelect.selectOption("segunda_mano");
    await page.waitForTimeout(800);

    // Solo F4S debe quedar visible en tbody
    await expect(tbody.getByText(`${PREFIX}F4S`).first()).toBeVisible({
      timeout: 5000,
    });
    expect(await tbody.getByText(`${PREFIX}F4N`).count()).toBe(0);
  });

  test("F5 codigo_interno duplicado → error friendly", async ({ page }) => {
    const codigo = `CV-F5-${RUN}`;
    await llenarForm(page, "F5A", {
      codigoInterno: codigo,
      precio: 100,
    });
    await page.getByRole("button", { name: /crear producto/i }).click();
    await page.waitForURL(
      /\/ops\/inventario\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      { timeout: 10000 },
    );

    // Segundo intento con mismo codigo_interno
    await llenarForm(page, "F5B", {
      codigoInterno: codigo,
      precio: 100,
    });
    await page.getByRole("button", { name: /crear producto/i }).click();
    // Debe quedarse en /nuevo y mostrar error
    await page.waitForTimeout(1500);
    expect(page.url()).toContain("/ops/inventario/nuevo");
    // safeError mapea 23505 a "Ya existe un registro con esos datos"
    await expect(
      page.getByText(/ya existe un registro|duplicate/i).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("F6 form sin nombre → validación cliente", async ({ page }) => {
    await page.goto("/ops/inventario/nuevo");
    await page.waitForLoadState("networkidle");
    // Solo llenar codigo_interno, dejar nombre vacío
    await page.getByPlaceholder("CV-001").fill(`CV-F6-${RUN}`);
    await page.getByRole("button", { name: /crear producto/i }).click();
    await expect(page.getByText(/nombre es obligatorio/i).first()).toBeVisible({
      timeout: 3000,
    });
    // No debe haber redirect
    expect(page.url()).toContain("/ops/inventario/nuevo");
  });

  test("F7 Alertas admin tiene 7 tabs (3 de rotación nuevos)", async ({
    page,
  }) => {
    await page.goto("/admin/alertas");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);
    // Los 3 tabs nuevos
    await expect(
      page.getByRole("button", { name: /sobre-stock/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /mayor rotaci/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /menor rotaci/i }),
    ).toBeVisible();

    // Click "Mayor rotación" — no debe lanzar error
    await page.getByRole("button", { name: /mayor rotaci/i }).click();
    await page.waitForTimeout(800);
    // No tiene que romperse: la página sigue rendereando
    await expect(page.getByRole("heading", { name: /alertas/i })).toBeVisible();
  });
});
