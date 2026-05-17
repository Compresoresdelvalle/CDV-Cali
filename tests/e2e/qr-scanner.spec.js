/**
 * E2E — Escáner QR (regresión).
 *
 * Bug: al abrir el escáner, html5-qrcode `stop()` lanza una excepción SÍNCRONA
 * si el scanner aún no está escaneando. La cadena `.catch()` del cleanup del
 * useEffect no captura un throw síncrono → el error escapa → sin error boundary
 * React desmonta toda la app → pantalla en blanco. StrictMode lo dispara siempre.
 *
 * Este test verifica que abrir el escáner NO tumba la app: el modal del escáner
 * debe quedar presente (aunque la cámara falle en el entorno de test).
 */
import { test, expect } from "@playwright/test";
import { loginUI } from "./helpers.js";

test.describe("Escáner QR", () => {
  test("abrir el escáner QR no tumba la app", async ({ page }) => {
    await loginUI(page, "carlos");
    await page.goto("/ops/inventario");

    const fab = page.locator('button[aria-label="Abrir escáner QR"]');
    await fab.waitFor({ state: "visible", timeout: 15_000 });
    await fab.click();

    // El modal del escáner debe aparecer y, tras el ciclo mount/cleanup de
    // StrictMode, seguir presente — la app no debe quedar en blanco.
    await expect(page.locator("#qr-scanner-viewport")).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForTimeout(3000);
    await expect(page.locator("#qr-scanner-viewport")).toBeVisible();
    await expect(page.getByText("Escáner QR")).toBeVisible();

    // El root de la app sigue con contenido (no se desmontó el árbol).
    const rootLen = await page.evaluate(
      () => document.getElementById("root")?.innerHTML.length ?? 0,
    );
    expect(rootLen).toBeGreaterThan(500);
  });
});
