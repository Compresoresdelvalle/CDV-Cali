import { describe, it, expect } from "vitest";
import {
  resumenAbonos,
  metodoAbonoLabel,
  horaBogota,
} from "../../src/lib/abonos-ot";
import { rangoBogota } from "../../src/lib/filtros";

/**
 * "Pagadas el día…" y "Abonos de OT del día": la plata de una OT entra por la
 * fecha del ABONO. Aquí se prueba el resumen y que el día sea el de Bogotá.
 */
const abono = (over = {}) => ({
  id: 1,
  orden_id: "ot-1",
  fecha: "2026-10-16T15:00:00+00:00",
  monto: 100000,
  metodo_pago: "Efectivo",
  cuenta_bancaria: null,
  orden: {
    numero: 501,
    cliente_nombre: "Cliente A",
    sede_id: "CV",
    estado: "entregada",
  },
  registrador: { nombre: "Edna" },
  ...over,
});

describe("resumenAbonos", () => {
  it("suma, cuenta OT distintas y reparte por método", () => {
    const r = resumenAbonos([
      abono(),
      abono({
        id: 2,
        monto: 50000,
        metodo_pago: "transferencia",
        cuenta_bancaria: " Bancolombia ",
      }),
      abono({
        id: 3,
        orden_id: "ot-2",
        monto: 25000,
        orden: {
          numero: 502,
          cliente_nombre: "B",
          sede_id: "CV",
          estado: "entregada",
        },
      }),
    ]);
    expect(r.total).toBe(175000);
    expect(r.totalCuentaCierre).toBe(175000);
    expect(r.nOrdenes).toBe(2);
    expect(r.filas).toHaveLength(3);
    expect(r.porMetodo).toEqual([
      { metodo: "Efectivo", total: 125000 },
      { metodo: "Transferencia", total: 50000 },
    ]);
    expect(r.filas[1].cuenta).toBe("Bancolombia");
    expect(r.filas[0].registradoPor).toBe("Edna");
  });

  it("una OT cancelada se muestra pero no cuenta para el cierre", () => {
    const r = resumenAbonos([
      abono(),
      abono({
        id: 2,
        orden_id: "ot-9",
        monto: 40000,
        orden: {
          numero: 9,
          cliente_nombre: "X",
          sede_id: "CV",
          estado: "cancelada",
        },
      }),
    ]);
    expect(r.total).toBe(140000);
    expect(r.totalCuentaCierre).toBe(100000);
    expect(r.filas.find((f) => f.numero === 9).cancelada).toBe(true);
  });

  it("ordena por hora y tolera datos incompletos", () => {
    const r = resumenAbonos([
      abono({
        id: 2,
        fecha: "2026-10-16T20:00:00+00:00",
        monto: "1000",
        registrador: null,
      }),
      abono({
        id: 1,
        fecha: "2026-10-16T13:00:00+00:00",
        metodo_pago: null,
        orden: { numero: 7, cliente_nombre: "  " },
      }),
    ]);
    expect(r.filas.map((f) => f.id)).toEqual([1, 2]);
    expect(r.filas[0].metodo).toBe("Sin método");
    expect(r.filas[0].cliente).toBe("Cliente sin nombre");
    expect(r.filas[1].registradoPor).toBe("—");
    expect(r.total).toBe(101000);
  });

  it("sin abonos devuelve ceros", () => {
    const r = resumenAbonos([]);
    expect(r).toMatchObject({
      total: 0,
      nOrdenes: 0,
      filas: [],
      porMetodo: [],
    });
  });
});

describe("día de Bogotá para filtrar abonos", () => {
  it("el día va de medianoche a medianoche de Colombia (UTC-5)", () => {
    const r = rangoBogota("2026-10-16", "2026-10-16");
    expect(r.desde).toBe("2026-10-16T00:00:00.000-05:00");
    expect(r.hasta).toBe("2026-10-16T23:59:59.999-05:00");
    // Un abono a las 11:30 p. m. de Bogotá ya es el 17 en UTC, pero es del 16.
    const tarde = Date.parse("2026-10-17T04:30:00Z");
    expect(tarde).toBeGreaterThanOrEqual(Date.parse(r.desde));
    expect(tarde).toBeLessThanOrEqual(Date.parse(r.hasta));
    // Y uno a las 12:10 a. m. del 17 en Bogotá ya no entra.
    expect(Date.parse("2026-10-17T05:10:00Z")).toBeGreaterThan(
      Date.parse(r.hasta),
    );
  });

  it("horaBogota muestra la hora de Colombia", () => {
    expect(horaBogota("2026-10-16T20:05:00Z")).toMatch(/03:05/);
  });

  it("metodoAbonoLabel normaliza mayúsculas", () => {
    expect(metodoAbonoLabel("EFECTIVO")).toBe("Efectivo");
  });
});
