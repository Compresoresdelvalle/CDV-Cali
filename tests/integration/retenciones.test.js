import { describe, it, expect } from "vitest";
import { calcularRetenciones } from "../../src/lib/retenciones";

/**
 * La aritmética de las retenciones.
 *
 * Estos números tienen que dar EXACTAMENTE lo mismo que las columnas generadas
 * de `ventas` y `ordenes_servicio`. Si divergen, la pantalla le promete al
 * cliente un neto distinto del que la caja va a contar — que es justo el error
 * que costó caro en el cambio de producto, cuando la fórmula estaba duplicada
 * entre el modal y el servidor.
 */
describe("calcularRetenciones", () => {
  it("sin tarifas devuelve todo en cero y el neto igual al total", () => {
    const r = calcularRetenciones({
      base: 1000000,
      iva: 190000,
      total: 1190000,
    });
    expect(r.retefuente).toBe(0);
    expect(r.reteica).toBe(0);
    expect(r.reteiva).toBe(0);
    expect(r.total).toBe(0);
    expect(r.neto).toBe(1190000);
    expect(r.hay).toBe(false);
  });

  it("retefuente y reteICA van sobre la base, reteIVA sobre el IVA", () => {
    // Mismo caso verificado contra produccion: la columna generada da 60.400.
    const r = calcularRetenciones({
      base: 1000000,
      iva: 190000,
      total: 1190000,
      retefuentePct: 2.5,
      reteicaPct: 0.69,
      reteivaPct: 15,
    });
    expect(r.retefuente).toBe(25000);
    expect(r.reteica).toBe(6900);
    expect(r.reteiva).toBe(28500);
    expect(r.total).toBe(60400);
    expect(r.neto).toBe(1129600);
    expect(r.hay).toBe(true);
  });

  it("redondea cada retencion por separado, como el servidor", () => {
    // base 333.333 * 2,5% = 8.333,325 -> 8.333
    const r = calcularRetenciones({
      base: 333333,
      iva: 0,
      total: 333333,
      retefuentePct: 2.5,
    });
    expect(r.retefuente).toBe(8333);
    expect(r.total).toBe(8333);
  });

  it("recorta las tarifas fuera de rango en vez de producir basura", () => {
    const r = calcularRetenciones({
      base: 1000000,
      iva: 0,
      total: 1000000,
      retefuentePct: -5,
    });
    expect(r.retefuente).toBe(0);
    const r2 = calcularRetenciones({
      base: 1000000,
      iva: 0,
      total: 1000000,
      retefuentePct: 500,
    });
    expect(r2.retefuente).toBe(1000000);
  });

  it("tolera entradas nulas o vacias sin devolver NaN", () => {
    const r = calcularRetenciones({});
    expect(r.total).toBe(0);
    expect(r.neto).toBe(0);
    expect(Number.isNaN(r.neto)).toBe(false);
    const r2 = calcularRetenciones({
      base: null,
      iva: undefined,
      total: "1190000",
      retefuentePct: "2.5",
    });
    expect(r2.neto).toBe(1190000);
  });

  it("el neto nunca es negativo", () => {
    const r = calcularRetenciones({
      base: 1000000,
      iva: 0,
      total: 1000,
      retefuentePct: 100,
    });
    expect(r.neto).toBe(0);
  });
});

/**
 * Paridad con el servidor.
 *
 * Los valores esperados NO se calcularon aquí: salieron de correr las mismas
 * funciones inmutables contra producción, que son las que alimentan las
 * columnas generadas. Casos escogidos por incómodos: redondeos que caen justo
 * en el medio, tarifas por mil con tres decimales, IVA en cero y una venta de
 * un peso con las tres tarifas al 100%.
 *
 * Si alguno de estos falla, el frontend y la caja dejaron de decir lo mismo.
 */
describe("paridad con las columnas generadas del servidor", () => {
  const CASOS = [
    { base: 1000000, iva: 190000, retefuentePct: 2.5, reteicaPct: 0.69, reteivaPct: 15,
      esperado: { retefuente: 25000, reteica: 6900, reteiva: 28500, total: 60400 } },
    { base: 333333, iva: 63333, retefuentePct: 2.5, reteicaPct: 0, reteivaPct: 0,
      esperado: { retefuente: 8333, reteica: 0, reteiva: 0, total: 8333 } },
    { base: 876542, iva: 166543, retefuentePct: 4, reteicaPct: 0.966, reteivaPct: 15,
      esperado: { retefuente: 35062, reteica: 8467, reteiva: 24981, total: 68510 } },
    { base: 86420, iva: 0, retefuentePct: 3.5, reteicaPct: 1.104, reteivaPct: 15,
      esperado: { retefuente: 3025, reteica: 954, reteiva: 0, total: 3979 } },
    { base: 1000000, iva: 190000, retefuentePct: 11, reteicaPct: 0.69, reteivaPct: 15,
      esperado: { retefuente: 110000, reteica: 6900, reteiva: 28500, total: 145400 } },
    { base: 1, iva: 0, retefuentePct: 100, reteicaPct: 100, reteivaPct: 100,
      esperado: { retefuente: 1, reteica: 1, reteiva: 0, total: 2 } },
  ];

  for (const c of CASOS) {
    it(`base ${c.base} / iva ${c.iva} con ${c.retefuentePct}% ${c.reteicaPct}% ${c.reteivaPct}%`, () => {
      const r = calcularRetenciones({ ...c, total: c.base + c.iva });
      expect(r.retefuente).toBe(c.esperado.retefuente);
      expect(r.reteica).toBe(c.esperado.reteica);
      expect(r.reteiva).toBe(c.esperado.reteiva);
      expect(r.total).toBe(c.esperado.total);
    });
  }
});
