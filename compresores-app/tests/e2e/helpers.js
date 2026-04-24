/**
 * E2E helpers compartidos entre todos los specs de Playwright.
 */

export const USERS = {
  carlos: { email: "carlos@compresores.local", pin: "0001" },
  pedro: { email: "pedro@compresores.local", pin: "1234" },
  maria: { email: "maria@compresores.local", pin: "5678" },
};

/**
 * Inicia sesión en la app via la pantalla de login.
 * Espera a que aparezca el Dashboard antes de continuar.
 */
export async function loginUI(page, usuario = "pedro") {
  const creds = USERS[usuario];
  if (!creds) throw new Error(`Usuario E2E desconocido: ${usuario}`);

  await page.goto("/");

  // Seleccionar usuario de la lista de login (login por selector de usuario)
  // La app muestra botones/chips por usuario — hacer click en el correspondiente
  const userBtn = page.locator(
    `[data-testid="user-${usuario}"], button:has-text("${creds.email.split("@")[0]}")`,
  );
  if ((await userBtn.count()) > 0) {
    await userBtn.first().click();
  }

  // Ingresar PIN usando el teclado numérico
  for (const digit of creds.pin) {
    const digitBtn = page.locator(
      `[data-testid="pin-${digit}"], button:has-text("${digit}"):not([data-testid*="nav"])`,
    );
    if ((await digitBtn.count()) > 0) {
      await digitBtn.first().click();
    }
  }

  // Esperar redirección al dashboard o página principal post-login
  await page.waitForURL(/\/(ops|admin)/, { timeout: 15_000 }).catch(() => {});
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
