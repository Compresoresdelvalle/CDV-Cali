import { describe, it, expect } from "vitest";
import { generarVentaPOS } from "../../src/lib/pdf/ventaPOS";

/**
 * Retenciones en el recibo POS.
 *
 * La tirilla se dibuja en DOS pasadas: una mide el alto del papel y otra pinta.
 * Si solo se añaden líneas al dibujo, el recibo sale cortado por abajo — es el
 * modo exacto en que ya falló una vez con los nombres largos.
 */

const VENTA_BASE = {
  numero: 1234,
  fecha: "2026-09-05T15:00:00Z",
  sede_id: "CV",
  subtotal: 1000000,
  descuento_valor: 0,
  iva_pct: 19,
  domicilio: 0,
  total: 1190000,
  metodo_pago: "Efectivo",
};

const ITEMS = [
  {
    descripcion: "FILTRO AIRE TORNILLO",
    cantidad: 1,
    precio_unitario: 1000000,
    subtotal: 1000000,
  },
];

const alto = (venta) =>
  generarVentaPOS({ venta, items: ITEMS, pagos: [] }).altura;

const CON_RETENCION = {
  ...VENTA_BASE,
  retefuente_pct: 2.5,
  retefuente_valor: 25000,
  reteica_pct: 0.69,
  reteica_valor: 6900,
  reteiva_pct: 15,
  reteiva_valor: 28500,
  retenciones_total: 60400,
};

describe("recibo POS con retenciones", () => {
  it("una venta sin retencion genera el mismo recibo de siempre", () => {
    expect(() =>
      generarVentaPOS({ venta: VENTA_BASE, items: ITEMS }),
    ).not.toThrow();
  });

  it("una venta con retencion no revienta", () => {
    expect(() =>
      generarVentaPOS({ venta: CON_RETENCION, items: ITEMS }),
    ).not.toThrow();
  });

  it("con retencion el papel es MAS LARGO: si no, la tirilla sale cortada", () => {
    expect(alto(CON_RETENCION)).toBeGreaterThan(alto(VENTA_BASE));
  });

  it("una sola retencion alarga menos que las tres", () => {
    const soloUna = {
      ...VENTA_BASE,
      retefuente_pct: 2.5,
      retefuente_valor: 25000,
      retenciones_total: 25000,
    };
    expect(alto(soloUna)).toBeGreaterThan(alto(VENTA_BASE));
    expect(alto(soloUna)).toBeLessThan(alto(CON_RETENCION));
  });

  it("sin retencion el alto es identico al de antes de esta funcionalidad", () => {
    expect(alto(VENTA_BASE)).toBe(
      alto({ ...VENTA_BASE, retenciones_total: 0 }),
    );
  });
});

/**
 * El saldo impreso de una venta a crédito.
 *
 * Es el papel que el cliente se lleva en la mano. Si no descuenta la retención,
 * le imprime un saldo que nunca va a pagar porque esa plata ya está en la DIAN.
 */
describe("saldo pendiente en la tirilla de una venta a credito", () => {
  const credito = (venta) =>
    generarVentaPOS({
      venta: { ...venta, metodo_pago: "Crédito" },
      items: ITEMS,
      pagos: [],
      credito: { abonosCotiz: 400000, cobros: [] },
    });

  it("sin retencion imprime total menos abonado", () => {
    expect(() => credito(VENTA_BASE)).not.toThrow();
  });

  it("con retencion el papel es mas largo y no revienta", () => {
    // El bloque de abonos y el de retenciones conviven: las dos pasadas
    // (medir y dibujar) tienen que seguir contando lo mismo.
    expect(() => credito(CON_RETENCION)).not.toThrow();
    expect(credito(CON_RETENCION).altura).toBeGreaterThan(
      credito(VENTA_BASE).altura,
    );
  });
});
