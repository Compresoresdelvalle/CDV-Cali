import { describe, it, expect } from "vitest";
import {
  ATAJOS,
  rangoDeAtajo,
  periodoAnterior,
  etiquetaRango,
  hayDatosParaComparar,
  PRIMER_DIA_CON_DATOS,
} from "../../src/lib/panel-rango";

/**
 * La aritmética de fechas del panel.
 *
 * Vive aparte y se prueba sola porque es lo que impide que el "mes pasado" que
 * se consulta y el "mes pasado" contra el que se compara se desincronicen. Un
 * desfase de un día aquí mueve todas las cifras del panel.
 *
 * La fecha se inyecta para que las pruebas no dependan del día en que corran.
 */
const HOY = new Date(2026, 8, 15); // 15 de septiembre de 2026

describe("rangoDeAtajo", () => {
  it("hoy es un solo día", () => {
    const r = rangoDeAtajo("hoy", HOY);
    expect(r.desde).toBe("2026-09-15");
    expect(r.hasta).toBe("2026-09-15");
  });

  it("ayer también, pero el anterior", () => {
    const r = rangoDeAtajo("ayer", HOY);
    expect(r.desde).toBe("2026-09-14");
    expect(r.hasta).toBe("2026-09-14");
  });

  it("este mes va del 1 al día de hoy, no a fin de mes", () => {
    // Contar hasta el 30 estando a 15 haría ver una caída que no existe.
    const r = rangoDeAtajo("mes", HOY);
    expect(r.desde).toBe("2026-09-01");
    expect(r.hasta).toBe("2026-09-15");
  });

  it("mes pasado va completo", () => {
    const r = rangoDeAtajo("mes_pasado", HOY);
    expect(r.desde).toBe("2026-08-01");
    expect(r.hasta).toBe("2026-08-31");
  });

  it("este año arranca el 1 de enero", () => {
    const r = rangoDeAtajo("ano", HOY);
    expect(r.desde).toBe("2026-01-01");
    expect(r.hasta).toBe("2026-09-15");
  });

  it("últimos 30 días incluye hoy", () => {
    const r = rangoDeAtajo("30d", HOY);
    expect(r.hasta).toBe("2026-09-15");
    expect(r.desde).toBe("2026-08-17"); // 30 días contando hoy
  });

  it("últimos 90 también", () => {
    const r = rangoDeAtajo("90d", HOY);
    expect(r.hasta).toBe("2026-09-15");
    expect(r.desde).toBe("2026-06-18");
  });

  it("un atajo desconocido cae en hoy, no revienta", () => {
    const r = rangoDeAtajo("inventado", HOY);
    expect(r.desde).toBe("2026-09-15");
  });
});

describe("periodoAnterior", () => {
  it("toma la misma cantidad de días, justo antes", () => {
    const p = periodoAnterior({ desde: "2026-09-01", hasta: "2026-09-15" });
    expect(p.hasta).toBe("2026-08-31");
    expect(p.desde).toBe("2026-08-17"); // 15 días
  });

  it("un solo día se compara contra el día anterior", () => {
    const p = periodoAnterior({ desde: "2026-09-15", hasta: "2026-09-15" });
    expect(p.desde).toBe("2026-09-14");
    expect(p.hasta).toBe("2026-09-14");
  });

  it("no es 'el mes pasado': son los mismos días", () => {
    // Septiembre completo (30 días) se compara contra los 30 días anteriores,
    // que se meten en agosto pero no lo cubren entero. Eso es lo comparable.
    const p = periodoAnterior({ desde: "2026-09-01", hasta: "2026-09-30" });
    expect(p.hasta).toBe("2026-08-31");
    expect(p.desde).toBe("2026-08-02");
  });
});

describe("hayDatosParaComparar", () => {
  it("dice que no cuando el periodo anterior cae antes del primer dato", () => {
    // La app arrancó el 1 de junio de 2026: comparar junio contra mayo daría un
    // −100% falso, así que la comparación se apaga sola.
    expect(
      hayDatosParaComparar({ desde: "2026-06-01", hasta: "2026-06-30" }),
    ).toBe(false);
  });

  it("dice que sí cuando el periodo anterior tiene datos", () => {
    expect(
      hayDatosParaComparar({ desde: "2026-09-01", hasta: "2026-09-30" }),
    ).toBe(true);
  });

  it("el primer día con datos es el 1 de junio de 2026", () => {
    expect(PRIMER_DIA_CON_DATOS).toBe("2026-06-01");
  });
});

describe("etiquetaRango", () => {
  it("un solo día se dice corto", () => {
    expect(etiquetaRango({ desde: "2026-09-15", hasta: "2026-09-15" })).toBe(
      "15 de septiembre de 2026",
    );
  });

  it("dentro del mismo mes no repite el mes", () => {
    expect(etiquetaRango({ desde: "2026-09-01", hasta: "2026-09-30" })).toBe(
      "Del 1 al 30 de septiembre de 2026",
    );
  });

  it("entre meses distintos nombra los dos", () => {
    expect(etiquetaRango({ desde: "2026-08-15", hasta: "2026-09-15" })).toBe(
      "Del 15 de agosto al 15 de septiembre de 2026",
    );
  });

  it("entre años distintos nombra los dos años", () => {
    expect(etiquetaRango({ desde: "2025-12-20", hasta: "2026-01-10" })).toBe(
      "Del 20 de diciembre de 2025 al 10 de enero de 2026",
    );
  });
});

describe("ATAJOS", () => {
  it("trae los ocho del diseño, en orden", () => {
    expect(ATAJOS.map((a) => a.id)).toEqual([
      "hoy",
      "ayer",
      "semana",
      "mes",
      "mes_pasado",
      "ano",
      "30d",
      "90d",
    ]);
  });

  it("cada uno produce un rango válido", () => {
    for (const a of ATAJOS) {
      const r = rangoDeAtajo(a.id, HOY);
      expect(r.desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.desde <= r.hasta).toBe(true);
    }
  });
});
