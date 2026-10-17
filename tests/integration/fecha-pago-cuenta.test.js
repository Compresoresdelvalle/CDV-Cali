import { describe, it, expect } from "vitest";
import {
  hoyBogota,
  restarDias,
  rangoFechaPago,
  validarFechaPago,
  fechaParaPayload,
  cierreQueCubre,
  diaLegible,
} from "../../src/lib/cuentas-ui";

/**
 * Pago o cobro con la fecha real (Bloque 3.3). Mismas reglas que
 * fn_registrar_pago_cuenta: no futura, máximo 30 días atrás, hora Colombia.
 */
describe("hoyBogota", () => {
  it("usa la hora de Colombia, no la UTC", () => {
    // 03:00 UTC del 18 = 22:00 del 17 en Bogotá.
    expect(hoyBogota(new Date("2026-10-18T03:00:00Z"))).toBe("2026-10-17");
    expect(hoyBogota(new Date("2026-10-18T06:00:00Z"))).toBe("2026-10-18");
  });
});

describe("rango y validación", () => {
  const hoy = "2026-10-17";

  it("resta días cruzando meses", () => {
    expect(restarDias("2026-03-01", 1)).toBe("2026-02-28");
    expect(rangoFechaPago(hoy)).toEqual({ min: "2026-09-17", max: hoy });
  });

  it("acepta hoy y el límite de 30 días", () => {
    expect(validarFechaPago(hoy, hoy)).toBeNull();
    expect(validarFechaPago("2026-09-17", hoy)).toBeNull();
  });

  it("rechaza fecha futura y explica qué hacer", () => {
    expect(validarFechaPago("2026-10-18", hoy)).toMatch(/no puede ser futura/);
    expect(validarFechaPago("2026-10-18", hoy, true)).toMatch(/cobro/);
  });

  it("rechaza más de 30 días atrás y dice desde cuándo", () => {
    const msg = validarFechaPago("2026-09-16", hoy);
    expect(msg).toMatch(/30 días/);
    expect(msg).toMatch(/17\/09\/2026/);
  });

  it("rechaza vacío", () => {
    expect(validarFechaPago("", hoy)).toMatch(/Elige la fecha/);
  });
});

describe("fechaParaPayload", () => {
  it("no manda fecha si es hoy (el servidor usa ahora)", () => {
    expect(fechaParaPayload("2026-10-17", "2026-10-17")).toBeUndefined();
  });
  it("manda la fecha si es otro día", () => {
    expect(fechaParaPayload("2026-10-10", "2026-10-17")).toBe("2026-10-10");
  });
});

describe("cierreQueCubre", () => {
  const cierres = [
    {
      numero: 10,
      fecha_desde: "2026-10-01",
      fecha_hasta: "2026-10-05",
      sede_id: "CV",
    },
    {
      numero: 11,
      fecha_desde: "2026-10-08",
      fecha_hasta: "2026-10-08",
      sede_id: null,
    },
  ];

  it("encuentra el cierre de la misma sede", () => {
    expect(cierreQueCubre(cierres, "2026-10-03", "CV")?.numero).toBe(10);
  });
  it("ignora el cierre de otra sede", () => {
    expect(cierreQueCubre(cierres, "2026-10-03", "BODEGA")).toBeNull();
  });
  it("un cierre sin sede vale para todas", () => {
    expect(cierreQueCubre(cierres, "2026-10-08", "L3")?.numero).toBe(11);
  });
  it("fuera de rango no hay cierre", () => {
    expect(cierreQueCubre(cierres, "2026-10-06", "CV")).toBeNull();
    expect(cierreQueCubre(null, "2026-10-06", "CV")).toBeNull();
  });
});

describe("diaLegible", () => {
  it("formatea como el servidor", () => {
    expect(diaLegible("2026-10-07")).toBe("07/10/2026");
  });
});
