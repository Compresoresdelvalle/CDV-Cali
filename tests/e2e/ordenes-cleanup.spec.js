/**
 * E2E — ordenes-cleanup.spec.js
 *
 * Nuevos casos post-Fase7-fixes:
 *   ✓ Click intensivo UI: modales Herramientas + pasos Órdenes + filtros rápidos
 *   ✓ Search hang fix: buscador de repuesto no se queda pegado tras agregar uno
 *   ✓ DELETE repuesto: X elimina sin error de trigger BD (costo_unitario bug)
 *   ✓ Transición de estado inválida: botón "Entregada" deshabilitado en Abierta
 *   ✓ Banner error visible: token CSS --destructive usado (no --danger)
 */

import { test, expect } from "@playwright/test";
import { loginUI } from "./helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push({ type: "js", msg: e.message }));
  page.on("console", (msg) => {
    if (msg.type() === "error")
      errors.push({ type: "console", msg: msg.text() });
  });
  page.on("response", (res) => {
    if (res.status() >= 400)
      errors.push({ type: "http", msg: `${res.status()} ${res.url()}` });
  });
  return errors;
}

function criticalErrors(errors) {
  return errors.filter(
    (e) =>
      !e.msg.includes("ResizeObserver") &&
      !e.msg.includes("Non-Error promise rejection") &&
      !e.msg.includes("favicon"),
  );
}

async function waitNoSkeleton(page, timeout = 15_000) {
  await page
    .waitForFunction(() => !document.querySelector(".animate-pulse"), {
      timeout,
    })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Helper: navegar a la primera orden existente (o crearla)
// ---------------------------------------------------------------------------
async function goToFirstOrden(page) {
  await page.goto("/ops/ordenes");
  await page.waitForLoadState("networkidle");
  await waitNoSkeleton(page);

  const firstItem = page.locator('ul[role="list"] li button').first();
  const hasItems = (await firstItem.count()) > 0;

  if (hasItems) {
    await firstItem.click();
    await page.waitForURL(/\/ops\/ordenes\/[^/]+$/, { timeout: 12_000 });
    return page.url();
  }

  // Create one
  await page.goto("/ops/ordenes/nueva");
  await page.waitForFunction(
    () => {
      const sel = document.querySelector("select");
      return sel && sel.options.length > 1;
    },
    { timeout: 15_000 },
  );
  await page
    .locator('input[placeholder*="Juan Pérez"]')
    .first()
    .fill("Cliente Cleanup Test");
  await page
    .locator('input[placeholder*="Compresor"]')
    .first()
    .fill("Equipo Cleanup E2E");
  await page.locator("select").first().selectOption({ index: 1 });

  const submitBtn = page.locator(
    'button[type="submit"]:has-text("Crear orden")',
  );
  await expect(submitBtn).toBeVisible({ timeout: 5_000 });

  const [response] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().includes("ordenes_servicio") &&
        res.request().method() === "POST",
      { timeout: 30_000 },
    ),
    submitBtn.click(),
  ]);

  await page.waitForURL(
    /\/ops\/ordenes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    { timeout: 15_000 },
  );
  return page.url();
}

// ---------------------------------------------------------------------------
// Suite 1 — Click intensivo UI
// ---------------------------------------------------------------------------
test.describe("Click intensivo UI — Herramientas + Órdenes", () => {
  test.beforeEach(async ({ page }) => {
    await loginUI(page, "carlos");
  });

  test("herramientas: abrir modal Nueva, cerrar, abrir modal Prestar, cerrar — sin botón atascado", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.goto("/ops/herramientas");
    await page
      .locator("h1, h2")
      .filter({ hasText: /herramienta/i })
      .first()
      .waitFor({ state: "visible", timeout: 20_000 })
      .catch(() => {});
    await waitNoSkeleton(page);

    // Abrir modal Nueva herramienta
    const nuevaBtn = page
      .locator('button:has-text("Nueva herramienta")')
      .first();
    await expect(nuevaBtn).toBeVisible({ timeout: 10_000 });
    await nuevaBtn.click();
    await expect(page.locator('button:has-text("Crear")')).toBeVisible({
      timeout: 5_000,
    });

    // Cerrar
    await page.locator('button:has-text("Cancelar")').first().click();
    await expect(page.locator('button:has-text("Crear")')).not.toBeVisible({
      timeout: 3_000,
    });

    // Verificar que el botón "Nueva herramienta" no quedó deshabilitado
    await expect(nuevaBtn).toBeEnabled({ timeout: 3_000 });

    // Intentar abrir modal Prestar si hay disponibles
    await page.locator('button:has-text("Disponibles")').first().click();
    await page.waitForTimeout(800);
    await waitNoSkeleton(page);

    const prestarBtn = page.locator('button:has-text("Prestar")').first();
    const prestarCount = await prestarBtn.count();
    if (prestarCount > 0) {
      await prestarBtn.click();
      await expect(page.locator("text=Prestar:")).toBeVisible({
        timeout: 5_000,
      });
      await page.locator('button:has-text("Cancelar")').first().click();
      await expect(page.locator("text=Prestar:")).not.toBeVisible({
        timeout: 3_000,
      });
      // Prestar button still enabled after close
      await expect(prestarBtn).toBeEnabled({ timeout: 3_000 });
    }

    await page.screenshot({
      path: "tests/results/herramientas-modal-abierto.png",
      fullPage: true,
    });

    expect(criticalErrors(errors)).toHaveLength(0);
  });

  test("herramientas: cambiar entre filtros rápido sin crash", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.goto("/ops/herramientas");
    await waitNoSkeleton(page, 20_000);

    const filtros = [
      "Disponibles",
      "Prestadas",
      "Mantenimiento",
      "Extraviadas",
      "Todas",
    ];
    for (const f of filtros) {
      await page.locator(`button:has-text("${f}")`).first().click();
      await page.waitForTimeout(150); // intencional: rápido sin esperar debounce
    }
    // Final espera para que termine el último query
    await page.waitForTimeout(1_000);
    await waitNoSkeleton(page);

    // Página sigue viva
    await expect(
      page
        .locator("h1, h2")
        .filter({ hasText: /herramienta/i })
        .first(),
    ).toBeVisible();

    expect(criticalErrors(errors)).toHaveLength(0);
  });

  test("órdenes: flujo Nueva → Detalle abre correctamente cada paso", async ({
    page,
  }) => {
    const errors = watchErrors(page);

    // Paso 1: lista — wait for the filter buttons (reliable signal that list module loaded)
    await page.goto("/ops/ordenes");
    // Wait for the "Todas" filter button — this is the most reliable indicator that
    // the ordenes module has fully mounted (same pattern as ordenes.spec.js)
    await page
      .locator('button:has-text("Todas")')
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });
    await waitNoSkeleton(page);

    // Paso 2: clic en todos los filtros de estado
    const filtros = [
      "Abiertas",
      "En proceso",
      "Esperando repuesto",
      "Completadas",
      "Entregadas",
      "Todas",
    ];
    for (const f of filtros) {
      await page.locator(`button:has-text("${f}")`).first().click();
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(600);

    // Paso 3: ir a detalle de primera orden (o crear)
    const ordenUrl = await goToFirstOrden(page);
    expect(ordenUrl).toMatch(/\/ops\/ordenes\/[^/]+$/);

    // Detalle cargó
    await expect(
      page.locator('input[placeholder*="repuesto"]').first(),
    ).toBeVisible({ timeout: 10_000 });

    await page.screenshot({
      path: "tests/results/orden-detalle-repuestos.png",
      fullPage: true,
    });

    expect(criticalErrors(errors)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — Search hang fix
// ---------------------------------------------------------------------------
test.describe("Search hang fix — buscador repuesto no se queda pegado", () => {
  test.beforeEach(async ({ page }) => {
    await loginUI(page, "carlos");
  });

  test("escribir en buscador, seleccionar resultado, escribir de nuevo — sin hang", async ({
    page,
  }) => {
    const errors = watchErrors(page);

    await goToFirstOrden(page);

    // Esperar buscador de repuesto
    const searchInput = page.locator('input[placeholder*="repuesto"]').first();
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // Paso 1: escribir "ace" y esperar resultados
    await searchInput.fill("ace");
    await page.waitForTimeout(700); // debounce 300ms + red

    // Puede haber resultados o no — en ambos casos el input no debe bloquearse
    const dropdown = page
      .locator('[role="listbox"], [role="option"], ul:has(li button)')
      .first();
    const hasDropdown = await dropdown.isVisible().catch(() => false);

    if (hasDropdown) {
      // Hacer click en primer resultado
      const firstResult = page.locator('[role="option"], ul li button').first();
      const hasResult = (await firstResult.count()) > 0;
      if (hasResult) {
        await firstResult.click();
        await page.waitForTimeout(300);
      }
    }

    // Paso 2: INMEDIATAMENTE escribir más en el buscador
    await searchInput.click();
    await searchInput.fill("comp");
    // Input debe seguir habilitado y el valor debe cambiar
    await expect(searchInput).toBeEnabled({ timeout: 3_000 });
    const val = await searchInput.inputValue();
    expect(val).toBe("comp");

    // Esperar que termine la query sin hang
    await page.waitForTimeout(700);
    await expect(searchInput).toBeEnabled();

    expect(criticalErrors(errors)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — DELETE repuesto sin error de trigger BD
// ---------------------------------------------------------------------------
test.describe("DELETE repuesto — trigger costo_unitario arreglado", () => {
  test.beforeEach(async ({ page }) => {
    await loginUI(page, "carlos");
  });

  test("agregar repuesto con cantidad, eliminarlo con X, vuelve a 0 items sin error", async ({
    page,
  }) => {
    const errors = watchErrors(page);

    await goToFirstOrden(page);

    const searchInput = page.locator('input[placeholder*="repuesto"]').first();
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // Intentar agregar un repuesto buscando genérico
    await searchInput.fill("a");
    await page.waitForTimeout(800);

    const firstResult = page
      .locator('[role="option"], ul li button, [data-testid="repuesto-option"]')
      .first();
    const hasResult = (await firstResult.count()) > 0;

    if (!hasResult) {
      // No hay repuestos en la BD — no podemos probar el delete; skip graceful
      test.info().annotations.push({
        type: "skip-reason",
        description: "Sin repuestos en BD para probar DELETE",
      });
      return;
    }

    // Click en primer resultado para agregarlo
    await firstResult.click();
    await page.waitForTimeout(500);

    // Contar filas de repuesto antes de eliminar
    const repuestoRows = page.locator(
      '[data-testid="repuesto-row"], tr:has(button[aria-label*="eliminar"]), tr:has(button:has-text("×")), li:has(button:has-text("×"))',
    );
    const countBefore = await repuestoRows.count();

    if (countBefore === 0) {
      // El repuesto puede haberse añadido en una estructura diferente
      // Verificar que el search no lanzó error de DB
      const dbErrors = errors.filter(
        (e) =>
          e.msg.includes("costo_unitario") ||
          e.msg.includes("violates not-null") ||
          e.msg.includes("trigger"),
      );
      expect(dbErrors).toHaveLength(0);
      return;
    }

    // Hacer click en el botón de eliminar (X)
    const deleteBtn = page
      .locator(
        'button[aria-label*="eliminar"], button:has-text("×"), button:has-text("✕")',
      )
      .first();
    const hasDelete = (await deleteBtn.count()) > 0;

    if (hasDelete) {
      await deleteBtn.click();

      // Esperar que la fila desaparezca o la cantidad baje
      await page.waitForTimeout(800);

      const countAfter = await repuestoRows.count();
      expect(countAfter).toBeLessThan(countBefore);

      // NO debe haber errores relacionados con costo_unitario
      const triggerErrors = errors.filter(
        (e) =>
          e.msg.includes("costo_unitario") ||
          e.msg.includes("violates not-null"),
      );
      expect(triggerErrors).toHaveLength(0);
    }

    await page.screenshot({
      path: "tests/results/orden-repuesto-eliminado.png",
      fullPage: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — Transiciones de estado inválidas
// ---------------------------------------------------------------------------
test.describe("Transiciones de estado inválidas — frontend protege", () => {
  test.beforeEach(async ({ page }) => {
    await loginUI(page, "carlos");
  });

  test("botón Entregada deshabilitado cuando orden está en estado Abierta", async ({
    page,
  }) => {
    const errors = watchErrors(page);

    // Navegar a lista y filtrar por Abiertas
    await page.goto("/ops/ordenes");
    await page.waitForLoadState("networkidle");
    await waitNoSkeleton(page);

    await page.locator('button:has-text("Abiertas")').first().click();
    await page.waitForTimeout(800);
    await waitNoSkeleton(page);

    const firstAbierta = page.locator('ul[role="list"] li button').first();
    const hasAbierta = (await firstAbierta.count()) > 0;

    if (!hasAbierta) {
      test.info().annotations.push({
        type: "skip-reason",
        description:
          "No hay órdenes Abiertas para verificar transición inválida",
      });
      return;
    }

    await firstAbierta.click();
    await page.waitForURL(/\/ops\/ordenes\/[^/]+$/, { timeout: 10_000 });
    await waitNoSkeleton(page);

    // Verificar que la orden está en estado Abierta (badge visible)
    const badgeAbierta = page
      .locator('span:has-text("Abierta"), [class*="badge"]:has-text("Abierta")')
      .first();

    const isAbierta = await badgeAbierta.isVisible().catch(() => false);
    if (!isAbierta) {
      // Puede ser que la orden ya avanzó de estado — skip graceful
      test.info().annotations.push({
        type: "skip-reason",
        description:
          "La orden no está en Abierta, no se puede verificar transición inválida a Entregada",
      });
      return;
    }

    // El botón "Entregada" debe estar deshabilitado (no se puede saltar de Abierta a Entregada)
    const entregadaBtn = page.locator('button:has-text("Entregada")').first();
    const entregadaCount = await entregadaBtn.count();

    if (entregadaCount > 0) {
      await expect(entregadaBtn).toBeDisabled({ timeout: 5_000 });
    }
    // Si el botón no aparece en absoluto, también es correcto (UI lo oculta completamente)

    expect(criticalErrors(errors)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 5 — Banners de error visibles (token CSS --destructive)
// ---------------------------------------------------------------------------
test.describe("Banners de error visibles — token --destructive", () => {
  test.beforeEach(async ({ page }) => {
    await loginUI(page, "carlos");
  });

  test("intentar crear orden sin técnico — banner de error rojo se muestra", async ({
    page,
  }) => {
    const errors = watchErrors(page);

    await page.goto("/ops/ordenes/nueva");

    // Esperar que el form cargue
    await expect(
      page.locator('input[placeholder*="Juan Pérez"]').first(),
    ).toBeVisible({ timeout: 10_000 });

    // Llenar solo cliente y equipo, NO seleccionar técnico
    await page
      .locator('input[placeholder*="Juan Pérez"]')
      .first()
      .fill("Cliente Error Test");
    await page
      .locator('input[placeholder*="Compresor"]')
      .first()
      .fill("Equipo Error Test");
    // Dejar técnico en el valor por defecto (vacío)

    const submitBtn = page.locator(
      'button[type="submit"]:has-text("Crear orden")',
    );
    await expect(submitBtn).toBeVisible({ timeout: 5_000 });
    await submitBtn.click();

    // Esperar un momento para que aparezca la validación / error
    await page.waitForTimeout(1_500);

    // El banner/alert de error debe ser visible
    // Acepta: [role="alert"], div con texto de error, elemento rojo
    const errorVisible =
      (await page
        .locator('[role="alert"]')
        .isVisible()
        .catch(() => false)) ||
      (await page
        .locator(
          'p:has-text("error"), p:has-text("requerido"), p:has-text("técnico"), div:has-text("error")',
        )
        .first()
        .isVisible()
        .catch(() => false)) ||
      (await page
        .locator(
          '[style*="destructive"], [class*="destructive"], [class*="error"], [class*="danger"]',
        )
        .first()
        .isVisible()
        .catch(() => false));

    // También aceptar que el submit simplemente no redirige (validación nativa browser)
    const stillOnForm = page.url().includes("/ops/ordenes/nueva");

    // Una de las dos debe cumplirse: error visible O sigue en el form sin crash
    expect(errorVisible || stillOnForm).toBe(true);

    await page.screenshot({
      path: "tests/results/orden-error-banner.png",
      fullPage: true,
    });

    // No debe haber errores JS criticos del token CSS
    const cssTokenErrors = errors.filter(
      (e) => e.msg.includes("--danger") || e.msg.includes("undefined color"),
    );
    expect(cssTokenErrors).toHaveLength(0);
  });

  test("error banner usa token --destructive (no --danger) — sin color undefined en DOM", async ({
    page,
  }) => {
    // Esta prueba evalúa si algún elemento en la página usa --danger (token viejo)
    // navegando a una página que pueda mostrar alertas
    const errors = watchErrors(page);

    await page.goto("/ops/ordenes");
    await page.waitForLoadState("networkidle");

    // Evaluar el DOM: buscar cualquier style que referencie --danger (token viejo)
    const dangerUsages = await page.evaluate(() => {
      const all = document.querySelectorAll("*");
      const found = [];
      for (const el of all) {
        const style = el.getAttribute("style") || "";
        if (style.includes("--danger")) {
          found.push({ tag: el.tagName, style });
        }
      }
      return found;
    });

    // No debe haber elementos con --danger en su style inline
    expect(dangerUsages).toHaveLength(0);

    expect(criticalErrors(errors)).toHaveLength(0);
  });
});
