/**
 * E2E helpers compartidos entre todos los specs de Playwright.
 *
 * Login UI flow:
 *   Step 1 — Click user card by full display name (e.g. "Pedro Bodeguero")
 *   Step 2 — Fill the 4 individual password inputs one digit at a time
 */

export const USERS = {
  carlos: { nombre: "Carlos Dueño", pin: "0001" },
  pedro: { nombre: "Pedro Bodeguero", pin: "1234" },
  maria: { nombre: "María Vendedora", pin: "5678" },
};

/**
 * Inicia sesión en la app via la pantalla de login.
 * - Hace click en la tarjeta del usuario por su nombre completo
 * - Rellena los 4 inputs de PIN uno a uno
 * - Espera redirección a /ops o /admin
 */
export async function loginUI(page, usuario = "pedro") {
  const creds = USERS[usuario];
  if (!creds) throw new Error(`Usuario E2E desconocido: ${usuario}`);

  await page.goto("/");

  // Wait for user list to load (fetched from Supabase)
  await page
    .locator(`button:has-text("${creds.nombre}")`)
    .waitFor({ state: "visible", timeout: 15_000 });

  // Click the user card
  await page.locator(`button:has-text("${creds.nombre}")`).first().click();

  // Wait for PIN inputs to appear (4 password fields)
  const pinInputs = page.locator('input[type="password"]');
  await pinInputs.first().waitFor({ state: "visible", timeout: 10_000 });

  // Type each digit one at a time so React's onChange fires and auto-advances
  // focus. Using .fill() suppresses synthetic events and breaks auto-submit.
  const digits = creds.pin.split("");
  for (let i = 0; i < digits.length; i++) {
    await pinInputs.nth(i).click();
    await pinInputs.nth(i).pressSequentially(digits[i]);
  }

  // Esperar redirección al dashboard o página principal post-login
  await page.waitForURL(/\/(ops|admin)/, { timeout: 20_000 });
}

/**
 * Espera que un toast / alerta con cierto texto sea visible.
 */
export async function waitForToast(page, textPattern, timeout = 8_000) {
  await page
    .locator(`[role="alert"], .toast, [data-testid="toast"]`)
    .filter({ hasText: textPattern })
    .waitFor({ state: "visible", timeout })
    .catch(() => {});
}
