/* global process */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { writeFileSync } from "node:fs";

// El componente se monta como portal en <body>; aquí se prueba la hoja sola
// porque en el render del servidor no hay document.
import { HojaEgreso } from "../../src/components/compras/ComprobanteEgreso";

/**
 * Comprobante de egreso de caja menor (media carta). No prueba cómo se ve:
 * prueba que diga lo que la clienta pidió y que a Crédito no se presente como
 * un pago ya hecho.
 */

const BASE = {
  id: "x",
  numero: 1276,
  fecha: "2026-10-17T15:30:00Z",
  proveedor: "Ferretería La 34",
  concepto: "Repuesto de chapa para la puerta",
  categoria: { nombre: "Mantenimiento" },
  metodo_pago: "Efectivo",
  cuenta_bancaria: null,
  sede_destino_id: "CV",
  total: 647185,
  retenciones_total: 0,
  observaciones: "",
  estado: "completada",
  registrador: { nombre: "Edna" },
};

const montar = (props) =>
  renderToStaticMarkup(createElement(HojaEgreso, props));

describe("ComprobanteEgreso", () => {
  it("de contado: egreso con número, monto en letras y firmas", () => {
    const html = montar({ compra: BASE });
    expect(html).toContain("Comprobante de egreso");
    expect(html).toMatch(/#(<!-- -->)?1276/);
    expect(html).toContain("Valor pagado");
    expect(html).toContain(
      "Seiscientos cuarenta y siete mil ciento ochenta y cinco pesos",
    );
    expect(html).toContain("Mantenimiento");
    expect(html).toContain("Ferretería La 34");
    expect(html).toContain("Repuesto de chapa");
    expect(html).toContain("Edna");
    expect(html).toContain("Entregado por");
    expect(html).toContain("Recibido por");
    expect(html).toContain("Nombre, cédula y firma");
    // Hora de Bogotá (UTC-5): 15:30Z son las 10:30 a. m.
    expect(html).toMatch(/10:30/);
    expect(html).not.toContain("Cuenta por pagar");
  });

  it("a Crédito: cuenta por pagar, valor adeudado y pagos hechos", () => {
    const html = montar({
      compra: { ...BASE, metodo_pago: "Crédito" },
      pagos: [
        {
          id: "p1",
          fecha: "2026-10-18T14:00:00Z",
          monto: 200000,
          metodo_pago: "Transferencia",
          cuenta_bancaria: "Bancolombia",
        },
      ],
      saldo: 447185,
    });
    expect(html).toContain("Cuenta por pagar");
    expect(html).toContain("Valor adeudado");
    expect(html).not.toContain("Comprobante de egreso");
    expect(html).toContain("Pagos hechos");
    expect(html).toContain("Bancolombia");
    expect(html).toMatch(/Saldo por pagar/);
  });

  it("a Crédito sin pagos lo dice, sin tabla vacía", () => {
    const html = montar({
      compra: { ...BASE, metodo_pago: "Crédito" },
      pagos: [],
      saldo: 647185,
    });
    expect(html).toContain("Todavía no tiene pagos.");
  });

  it("con retenciones, el monto y las letras son lo que sale de la caja", () => {
    const html = montar({
      compra: { ...BASE, total: 1000000, retenciones_total: 25000 },
    });
    expect(html).toContain("Novecientos setenta y cinco mil pesos");
    expect(html).toContain("retenciones");
  });

  it("una caja menor cancelada sale marcada como anulada", () => {
    const html = montar({ compra: { ...BASE, estado: "cancelada" } });
    expect(html).toContain("ANULADO");
  });

  // Deja una página de prueba para mirarla con la vista de impresión del
  // navegador (o Chrome headless --print-to-pdf): solo debe salir la hoja.
  it.skipIf(!process.env.COMPROBANTE_HTML)("página de prueba", () => {
    const hoja = montar({ compra: BASE });
    writeFileSync(
      process.env.COMPROBANTE_HTML,
      `<!doctype html><html><head><meta charset="utf-8"></head><body>` +
        `<div id="root"><h1>APP COMPLETA QUE NO DEBE SALIR</h1></div>` +
        hoja +
        `</body></html>`,
    );
  });
});
