/**
 * TEMPORAL — verificación visual de las fases A y B del panel (BORRAR después).
 *
 * Comprueba lo que ninguna prueba de humo puede: que la pantalla se vea, que el
 * rango responda de verdad y que el calendario y el modo oscuro no se rompan.
 *
 * PIN por env: TEST_ADMIN_PIN
 */
/* global process */
import { test, expect } from "@playwright/test";

const ADMIN = {
  usuario: "Admin Maritza",
  pin: process.env.TEST_ADMIN_PIN || "",
};

/**
 * El login tiene DOS pasos: primero se elige el rol y después el usuario. El
 * helper de los specs viejos solo hacía el primero —hacía clic en
 * "Administrador" y se quedaba esperando el PIN que todavía no existía—, así
 * que aquí se hacen los dos.
 */
async function loginAdmin(page) {
  await page.goto("/");

  // Paso 1: el rol. Solo si la tarjeta del usuario no está ya en pantalla.
  const tarjetaUsuario = page
    .locator(`button:has-text("${ADMIN.usuario}")`)
    .first();
  if (!(await tarjetaUsuario.isVisible().catch(() => false))) {
    await page
      .locator('button:has-text("Administrador")')
      .first()
      .click({ timeout: 20_000 });
  }

  // Paso 2: el usuario.
  await tarjetaUsuario.waitFor({ state: "visible", timeout: 20_000 });
  await tarjetaUsuario.click();

  // Paso 3: el PIN, en cuatro cajas de un dígito.
  const pin = page.locator('input[type="password"]');
  await pin.first().waitFor({ state: "visible", timeout: 10_000 });
  const digits = ADMIN.pin.split("");
  for (let i = 0; i < digits.length; i++) {
    await pin.nth(i).click();
    await pin.nth(i).pressSequentially(digits[i]);
  }
  await page.waitForURL(/\/(ops|admin)/, { timeout: 20_000 });
}

test.describe("Panel — fases A y B", () => {
  test("el panel abre y la frase del rango dice lo que está aplicado", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/admin/panel");

    // La frase en español es lo que quita el adivinar.
    await expect(page.getByText(/Del \d+ .* al \d+ de/i).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/Actualizado/i).first()).toBeVisible();

    await page.screenshot({
      path: "tests/results/panel-01-abre.png",
      fullPage: true,
    });
  });

  test("cambiar de atajo cambia la frase de verdad", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/panel");
    await page
      .getByText(/Actualizado/i)
      .first()
      .waitFor({ timeout: 20_000 });

    const frase = page
      .locator("p")
      .filter({ hasText: /Actualizado/i })
      .first();
    const antes = await frase.innerText();

    await page.getByRole("button", { name: "Mes pasado", exact: true }).click();
    await expect(frase).not.toHaveText(antes, { timeout: 5_000 });

    // "Ayer" es un solo día: la frase tiene que decirlo corto, sin "Del ... al".
    await page.getByRole("button", { name: "Ayer", exact: true }).click();
    await expect(frase).toContainText(/de \w+ de \d{4}/i);

    await page.screenshot({ path: "tests/results/panel-02-atajos.png" });
  });

  test("el calendario personalizado abre", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/panel");
    await page
      .getByText(/Actualizado/i)
      .first()
      .waitFor({ timeout: 20_000 });

    await page.getByRole("button", { name: /Personalizado/i }).click();
    await expect(page.locator(".rdp-root").first()).toBeVisible({
      timeout: 5_000,
    });
    await page.screenshot({ path: "tests/results/panel-03-calendario.png" });
  });

  test("el calendario respeta el modo oscuro", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/panel");
    await page
      .getByText(/Actualizado/i)
      .first()
      .waitFor({ timeout: 20_000 });

    // react-day-picker es la única librería de terceros que pinta superficies:
    // es justo donde se cuela una paleta propia que ignora los tokens.
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.getByRole("button", { name: /Personalizado/i }).click();
    await expect(page.locator(".rdp-root").first()).toBeVisible({
      timeout: 5_000,
    });
    await page.screenshot({ path: "tests/results/panel-04-oscuro.png" });
  });

  test("en celular (360px) nada se sale de la pantalla", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await loginAdmin(page);
    await page.goto("/admin/panel");
    await page
      .getByText(/Actualizado/i)
      .first()
      .waitFor({ timeout: 20_000 });

    // La página no puede rodar en horizontal: lo ancho debe rodar dentro de su
    // propio contenedor, no mover la pantalla entera.
    const desborda = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(desborda).toBe(false);

    // Los chips necesitan SU PROPIA fila. Compartiéndola con el selector de
    // sede y el botón, en 360 px solo se alcanzaban a ver "Hoy" y medio
    // "Ayer": había que adivinar que el resto se arrastra.
    const anchoChips = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.textContent.trim() === "Hoy",
      );
      return b ? b.parentElement.clientWidth : 0;
    });
    expect(anchoChips).toBeGreaterThan(300);

    await page.screenshot({
      path: "tests/results/panel-05-movil.png",
      fullPage: true,
    });
  });

  test("la bandeja de egresos abre y agrupa", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/egresos");

    await expect(page.getByText(/Faltan \d+ egresos/i)).toBeVisible({
      timeout: 20_000,
    });
    // El agrupado es lo que hace usable la pantalla: sin él son 465 filas.
    await expect(page.getByText(/movimientos/i).first()).toBeVisible();

    await page.screenshot({
      path: "tests/results/panel-06-egresos.png",
      fullPage: true,
    });
  });

  test("un egreso nuevo no se puede guardar sin categoría", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/ops/compras/nueva");

    await page.getByRole("button", { name: "Caja menor", exact: true }).click();

    // El campo tiene que estar: si solo se limpia lo viejo, la bandeja de
    // clasificación se vuelve a llenar sola y el Resultado nunca cierra.
    // El label lleva un asterisco de obligatorio, así que no es texto exacto.
    await expect(page.getByText(/^Categoría/).first()).toBeVisible({
      timeout: 10_000,
    });

    // Con concepto y monto pero SIN categoría, guardar sigue bloqueado.
    await page
      .locator('input[placeholder*="transporte"]')
      .fill("PRUEBA CATEGORIA OBLIGATORIA");
    await page.locator('input[type="number"]').first().fill("1000");

    await expect(
      page.getByRole("button", { name: "Registrar caja menor" }),
    ).toBeDisabled();

    await page.screenshot({
      path: "tests/results/panel-07-caja-menor.png",
      fullPage: true,
    });
  });
});
