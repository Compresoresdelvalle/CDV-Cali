/**
 * ABC: los tres criterios y el selector de periodo.
 *
 * El ABC miraba sólo ventas y forzaba 'C' a todo lo que no se vendía. Medido en
 * producción, 209 productos 'C' consumieron $41.896.595 como insumo en 90 días,
 * más que los A y B juntos: cabezotes, tanques y motores que casi no se venden
 * sueltos pero entran en cada ensamble.
 */
import { describe, it, expect } from "vitest";
import {
  CRITERIOS_ABC,
  campoCriterioABC,
  labelCriterioABC,
  PERIODOS_RANKING,
  labelPeriodoRanking,
} from "../../src/lib/admin-analytics-ui";

describe("criterios ABC", () => {
  it("ofrece los tres criterios, no sólo ventas", () => {
    expect(CRITERIOS_ABC.map((c) => c.label)).toEqual([
      "Ventas",
      "Consumo",
      "Combinado",
    ]);
  });

  it("cada criterio apunta a su columna real de la base", () => {
    expect(campoCriterioABC("Ventas")).toBe("clasificacion");
    expect(campoCriterioABC("Consumo")).toBe("clasificacion_consumo");
    expect(campoCriterioABC("Combinado")).toBe("clasificacion_global");
  });

  it("cae en ventas ante una etiqueta desconocida, sin romper la pantalla", () => {
    expect(campoCriterioABC("inventada")).toBe("clasificacion");
    expect(campoCriterioABC(undefined)).toBe("clasificacion");
  });

  it("traduce el campo de vuelta a su etiqueta", () => {
    expect(labelCriterioABC("clasificacion_global")).toBe("Combinado");
    expect(labelCriterioABC("clasificacion_consumo")).toBe("Consumo");
    expect(labelCriterioABC("clasificacion")).toBe("Ventas");
    expect(labelCriterioABC(null)).toBe("Ventas");
  });

  it("ida y vuelta consistente para los tres", () => {
    for (const c of CRITERIOS_ABC) {
      expect(campoCriterioABC(labelCriterioABC(c.campo))).toBe(c.campo);
    }
  });
});

describe("periodos del recálculo", () => {
  it("ofrece mes, trimestre y año", () => {
    expect(PERIODOS_RANKING.map((p) => p.dias)).toEqual([30, 90, 365]);
  });

  it("todos los periodos caen en el rango que acepta el RPC (1..3650)", () => {
    for (const p of PERIODOS_RANKING) {
      expect(p.dias).toBeGreaterThanOrEqual(1);
      expect(p.dias).toBeLessThanOrEqual(3650);
    }
  });

  it("etiqueta legible por días, con respaldo para valores sueltos", () => {
    expect(labelPeriodoRanking(90)).toBe("Último trimestre");
    expect(labelPeriodoRanking(7)).toBe("7 días");
  });
});

/**
 * La clase que manda en Reorden: la combinada, con respaldo a la de ventas.
 * Se replica aquí la regla de `claseReorden` porque es la que decide qué se
 * compra primero y no puede quedarse en blanco.
 */
const claseReorden = (i) => i?.clasificacion_global ?? i?.clasificacion ?? null;

describe("clase ABC que prioriza Reorden", () => {
  it("usa la combinada cuando existe, no la de ventas", () => {
    expect(
      claseReorden({ clasificacion: "C", clasificacion_global: "A" }),
    ).toBe("A");
  });

  it("cae a la de ventas cuando no hay combinada", () => {
    // El asistente de min/max viene de fn_sugerir_minmax, que sólo trae ventas.
    expect(claseReorden({ clasificacion: "B" })).toBe("B");
    expect(
      claseReorden({ clasificacion: "B", clasificacion_global: null }),
    ).toBe("B");
  });

  it("devuelve null sin datos, para que la interfaz muestre el guion", () => {
    expect(claseReorden({})).toBeNull();
    expect(claseReorden(undefined)).toBeNull();
  });
});
