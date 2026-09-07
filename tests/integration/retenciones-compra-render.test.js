import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import BloqueRetenciones from "../../src/components/ventas/BloqueRetenciones";

/**
 * El bloque de retenciones se comparte entre venta y compra, pero el sentido
 * del dinero es el opuesto: en venta el cliente nos retiene y nos entra menos;
 * en compra nosotros le retenemos al proveedor y le pagamos menos.
 *
 * Si los textos se cruzan, el bodeguero lee "Neto a recibir" mientras le está
 * pagando a alguien, y eso es exactamente el tipo de confusión que termina en
 * una caja descuadrada.
 *
 * No comprueba cómo se ve nada: responde si abre y si dice lo que debe decir.
 */

const montar = (props) =>
  renderToStaticMarkup(createElement(BloqueRetenciones, props));

const BASE = {
  base: 1000000,
  iva: 190000,
  total: 1190000,
  valores: { retefuentePct: 0, reteicaPct: 0, reteivaPct: 0 },
};

describe("BloqueRetenciones en modo compra", () => {
  it("invita a retenerle al proveedor, no a que el cliente retenga", () => {
    const html = montar({ ...BASE, modo: "compra" });
    expect(html).toContain("¿Le retenemos al proveedor?");
    expect(html).not.toContain("El cliente retiene");
  });

  it("abierto dice Neto a pagar, no Neto a recibir", () => {
    const html = montar({ ...BASE, modo: "compra", abierto: true });
    expect(html).toContain("Neto a pagar");
    expect(html).not.toContain("Neto a recibir");
  });

  it("sin modo se comporta como venta, igual que hoy", () => {
    const html = montar({ ...BASE, abierto: true });
    expect(html).toContain("¿El cliente retiene?");
    expect(html).toContain("Neto a recibir");
  });

  it("no aplica ninguna tarifa sugerida al montar", () => {
    const html = montar({
      ...BASE,
      modo: "compra",
      abierto: true,
      sugeridas: { retefuentePct: 2.5, reteicaPct: 0.414, reteivaPct: 15 },
    });
    // Con esas tres tarifas la retención sería 25.000 + 4.140 + 28.500 =
    // 57.640, y el neto 1.132.360. Ese número no puede aparecer: abrir el
    // bloque no retiene nada, aplicar las tarifas es un acto explícito.
    expect(html).toContain("1.190.000");
    expect(html).not.toContain("1.132.360");
  });

  it("con retención manda el monto en el encabezado", () => {
    const html = montar({
      ...BASE,
      modo: "compra",
      valores: { retefuentePct: 2.5, reteicaPct: 0, reteivaPct: 0 },
    });
    expect(html).toContain("25.000");
    expect(html).not.toContain("¿Le retenemos al proveedor?");
  });
});

describe("BloqueRetenciones cuando la retención se pasa del total", () => {
  it("avisa en pantalla en vez de dejar pulsar un botón que va a fallar", () => {
    const html = montar({
      ...BASE,
      modo: "compra",
      abierto: true,
      // 100% + 100% sobre la base son 2.000.000 contra un total de 1.190.000:
      // sin este aviso el servidor rechazaría el documento y el operador no
      // sabría por qué.
      valores: { retefuentePct: 100, reteicaPct: 100, reteivaPct: 0 },
    });
    expect(html).toContain("se pasan del total");
    expect(html).toContain("no 25");
  });

  it("no avisa nada cuando la retención es normal", () => {
    const html = montar({
      ...BASE,
      modo: "compra",
      abierto: true,
      valores: { retefuentePct: 2.5, reteicaPct: 0, reteivaPct: 0 },
    });
    expect(html).not.toContain("se pasan del total");
  });
});
