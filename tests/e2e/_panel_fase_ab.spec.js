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

  test("la cascada y las pérdidas se ven con datos reales", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/admin/panel");

    // Últimos 90 para que haya datos de verdad.
    await page.getByRole("button", { name: "Últimos 90", exact: true }).click();

    await expect(page.getByText("Margen bruto")).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByText("Vendido bajo costo")).toBeVisible({
      timeout: 25_000,
    });
    // El aviso tiene que ser un incentivo, no una amenaza.
    await expect(page.getByText(/puede subir hasta/i)).toBeVisible();

    await page.screenshot({
      path: "tests/results/panel-08-cascada.png",
      fullPage: true,
    });
  });

  test("una cifra de pérdida abre su detalle hasta el documento", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/admin/panel");
    await page.getByRole("button", { name: "Últimos 90", exact: true }).click();
    await expect(page.getByText("Vendido bajo costo")).toBeVisible({
      timeout: 25_000,
    });

    await page.getByText("Vendido bajo costo").click();

    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    // Cada fila lleva a su venta: una cifra que no se puede abrir genera
    // desconfianza.
    await expect(panel.locator('a[href^="/ops/ventas/"]').first()).toBeVisible({
      timeout: 15_000,
    });

    await page.screenshot({ path: "tests/results/panel-09-detalle.png" });

    // Cierra con Escape.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden({ timeout: 5_000 });
  });
});

test.describe("Panel — fase D", () => {
  test("la composición cuadra con la cascada y cambia de eje", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/admin/panel");

    const seccion = page
      .locator("section")
      .filter({ hasText: "CÓMO SE COMPONE LA VENTA" });
    await expect(seccion).toBeVisible({ timeout: 30_000 });

    // Lo único que de verdad hay que comprobar: el total del desglose tiene que
    // ser el mismo número que las ventas netas de la cascada. Si no, hay dos
    // cifras contradictorias en la misma pantalla.
    const netas = await page
      .locator("section")
      .filter({ hasText: "RESULTADO DEL PERIODO" })
      .getByText(/^\$\s?[\d.]+$/)
      .first()
      .innerText();
    await expect(seccion.locator("tfoot")).toContainText(netas.trim(), {
      timeout: 30_000,
    });

    // Cambiar de eje trae otras filas.
    const primeraSede = await seccion
      .locator("tbody tr td")
      .first()
      .innerText();
    await seccion.getByRole("button", { name: "Vendedora" }).click();
    await expect(seccion.locator("tbody tr td").first()).not.toHaveText(
      primeraSede,
      { timeout: 30_000 },
    );

    // Y el total sigue cuadrando después de cambiar de eje: el reparto de la
    // venta neta entre las líneas no depende de la dimensión.
    await expect(seccion.locator("tfoot")).toContainText(netas.trim());

    await page.screenshot({
      path: "tests/results/panel-10-composicion.png",
      fullPage: false,
    });
  });

  test("ver los peores deja de primero el de menor margen", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/admin/panel");

    const seccion = page
      .locator("section")
      .filter({ hasText: "Cómo se compone la venta" });
    await seccion.locator("tbody tr").first().waitFor({ timeout: 30_000 });

    // No se puede afirmar que el primero CAMBIE: puede que quien más vende sea
    // ya quien menos margen deja (con los datos de septiembre, Almacén CV es
    // las dos cosas). Lo que sí se puede afirmar siempre es que después de
    // pulsar, arriba queda el mínimo.
    await seccion.getByRole("button", { name: /Ver los peores/ }).click();

    const pcts = (
      await seccion.locator("tbody tr td:nth-child(6)").allInnerTexts()
    )
      .map((t) => parseFloat(t.replace("%", "")))
      .filter((n) => !Number.isNaN(n));

    expect(pcts.length).toBeGreaterThan(1);
    expect(pcts[0]).toBe(Math.min(...pcts));
  });
});

test.describe("Panel — fase E", () => {
  test("cartera e inventario se ven y dicen que no dependen del rango", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/admin/panel");

    const cartera = page.locator("section").filter({ hasText: "Quién debe" });
    const inv = page
      .locator("section")
      .filter({ hasText: "Plata parada en inventario" });

    await expect(cartera).toBeVisible({ timeout: 30_000 });
    await expect(inv).toBeVisible({ timeout: 30_000 });

    // Los cuatro tramos salen siempre, incluso los que están en cero.
    for (const t of [
      "Hasta 30 días",
      "De 31 a 60",
      "De 61 a 90",
      "Más de 90 días",
    ]) {
      await expect(cartera.getByText(t)).toBeVisible();
    }

    // Decir que es una foto de hoy es lo que evita que alguien crea que el
    // rango de arriba la está filtrando.
    await expect(
      cartera.getByText(/el rango de arriba no la filtra/),
    ).toBeVisible();
    await expect(
      inv.getByText(/el rango de arriba no la filtra/),
    ).toBeVisible();

    await expect(inv.getByText("Capital en inventario")).toBeVisible();
    await expect(inv.getByRole("link", { name: "Ver reorden" })).toBeVisible();
    await expect(inv.getByRole("link", { name: "Ver alertas" })).toBeVisible();

    await cartera.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "tests/results/panel-11-cartera-inventario.png",
      fullPage: false,
    });
  });

  test("cambiar de sede no toca el rango pero sí recarga las fotos", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/admin/panel");

    const inv = page
      .locator("section")
      .filter({ hasText: "Plata parada en inventario" });
    await expect(inv.getByText("Capital en inventario")).toBeVisible({
      timeout: 30_000,
    });
    const todas = await inv.locator("p.tabular-nums").first().innerText();

    await page.locator("select").first().selectOption({ index: 1 });

    // Con una sola sede el capital tiene que ser menor que con todas.
    await expect
      .poll(async () => inv.locator("p.tabular-nums").first().innerText(), {
        timeout: 30_000,
      })
      .not.toBe(todas);
  });
});

test.describe("Panel — exportar", () => {
  test("el boton descarga un CSV con el rango en el nombre y datos reales", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/admin/panel");

    const seccion = page
      .locator("section")
      .filter({ hasText: "Cómo se compone la venta" });
    await seccion.locator("tbody tr").first().waitFor({ timeout: 30_000 });

    const [descarga] = await Promise.all([
      page.waitForEvent("download"),
      seccion.getByRole("button", { name: "Exportar" }).click(),
    ]);

    // El rango va en el nombre: dos descargas del mismo panel con rangos
    // distintos no se pueden confundir en la carpeta de descargas.
    expect(descarga.suggestedFilename()).toMatch(
      /^panel-composicion-sede-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.csv$/,
    );

    const ruta = await descarga.path();
    const texto = (await import("node:fs")).readFileSync(ruta, "utf8");
    // BOM para que Excel no rompa los acentos, titulos, y punto y coma.
    expect(texto.charCodeAt(0)).toBe(0xfeff);
    expect(texto).toContain("Nombre;Facturas;Venta;Costo;Margen;Margen %");
    // Y al menos una fila de datos ademas del encabezado.
    expect(texto.trim().split("\n").length).toBeGreaterThan(1);
  });
});

test.describe("Panel — cierre visual", () => {
  test("a 360 px nada desborda la pagina, ni con el historico completo", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await loginAdmin(page);
    await page.goto("/admin/panel");

    // Todo el histórico: los nombres largos de producto y los montos de nueve
    // cifras son los que rompen un diseño, no los datos de ejemplo.
    await page.getByRole("button", { name: "Este año" }).click();

    const composicion = page
      .locator("section")
      .filter({ hasText: "Cómo se compone la venta" });
    await composicion.getByRole("button", { name: "Producto" }).click();
    await expect(composicion.locator("li").first()).toBeVisible({
      timeout: 30_000,
    });

    // La página no puede rodar en horizontal. Las tablas anchas ruedan DENTRO
    // de su contenedor, no moviendo la página entera.
    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(desborde).toBeLessThanOrEqual(1);

    await page.screenshot({
      path: "tests/results/panel-12-movil-360.png",
      fullPage: true,
    });
  });

  test("un rango sin ventas explica en vez de quedar en blanco", async ({
    page,
  }) => {
    await loginAdmin(page);
    await page.goto("/admin/panel");

    // "Hoy" en esta base suele no tener ventas todavía; si las tiene, la
    // aserción sigue valiendo porque lo que se comprueba es que NUNCA quede
    // una tarjeta muda.
    await page.getByRole("button", { name: "Hoy", exact: true }).click();

    const composicion = page
      .locator("section")
      .filter({ hasText: "Cómo se compone la venta" });
    await expect(composicion).toBeVisible({ timeout: 30_000 });
    await expect(
      composicion.getByText(/No hubo ventas en este rango|Nombre/),
    ).toBeVisible({ timeout: 30_000 });

    // El resultado se muestra SIEMPRE, aunque esté en cero: fue la corrección
    // expresa del usuario contra "si siempre falta algo, nunca muestra nada".
    const resultado = page
      .locator("section")
      .filter({ hasText: "Resultado del periodo" });
    await expect(resultado.getByText("Ventas netas")).toBeVisible();
    // El renglón lleva el signo en el mismo span: el texto es "= Resultado".
    await expect(resultado.getByText("= Resultado")).toBeVisible();
  });

  test("en modo oscuro se sigue leyendo todo", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/panel");
    await expect(
      page.locator("section").filter({ hasText: "Resultado del periodo" }),
    ).toBeVisible({ timeout: 30_000 });

    await page
      .getByRole("button", { name: /oscuro|claro|tema/i })
      .first()
      .click();
    await page.waitForTimeout(400);

    // El calendario es donde una librería mete su propia paleta y desaparece.
    await page.getByRole("button", { name: /Personalizado/ }).click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: "tests/results/panel-13-oscuro.png",
      fullPage: false,
    });
  });
});
