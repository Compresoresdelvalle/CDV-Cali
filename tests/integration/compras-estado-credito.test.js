import { describe, it, expect } from "vitest";
import {
  compraEstadoPill,
  construirTimelineCompra,
} from "../../src/lib/compras-ui";

/**
 * Caja menor a Crédito (Bloque 3.2): antes una caja menor era siempre
 * "Pagado". Ahora puede deberse, y decir "Pagado" de algo que se debe es
 * exactamente el error que hace que nadie la pague.
 */
const cm = (extra) => ({ es_caja_menor: true, recibida: true, ...extra });

describe("compraEstadoPill · caja menor", () => {
  it("contado sigue siendo Pagado", () => {
    expect(compraEstadoPill(cm({ metodo_pago: "Efectivo" })).label).toBe(
      "Pagado",
    );
  });

  it("a crédito con saldo es Por pagar", () => {
    expect(
      compraEstadoPill(cm({ metodo_pago: "Crédito", saldo: 50000 })).label,
    ).toBe("Por pagar");
  });

  it("a crédito saldada es Pagado", () => {
    expect(
      compraEstadoPill(cm({ metodo_pago: "Crédito", saldo: 0 })).label,
    ).toBe("Pagado");
  });

  it("a crédito sin saldo conocido no inventa: A crédito", () => {
    expect(compraEstadoPill(cm({ metodo_pago: "Crédito" })).label).toBe(
      "A crédito",
    );
  });

  it("cancelada manda sobre el crédito", () => {
    expect(
      compraEstadoPill(
        cm({ metodo_pago: "Crédito", saldo: 100, estado: "cancelada" }),
      ).label,
    ).toBe("Cancelada");
  });
});

describe("construirTimelineCompra · caja menor a crédito", () => {
  const base = {
    proveedor: "Caja menor",
    fecha: "2026-10-17T15:00:00Z",
    sede_destino_id: "CV",
  };
  const fmt = (d) => d;

  it("mientras debe, el hito es Gasto por pagar con el saldo", () => {
    const t = construirTimelineCompra(
      cm({ ...base, metodo_pago: "Crédito", saldo: 30000 }),
      [],
      fmt,
    );
    expect(t[1].act).toBe("Gasto por pagar");
    expect(t[1].meta).toMatch(/30\.000/);
  });

  it("saldada, el hito es Gasto pagado", () => {
    const t = construirTimelineCompra(
      cm({ ...base, metodo_pago: "Crédito", saldo: 0 }),
      [],
      fmt,
    );
    expect(t[1].act).toBe("Gasto pagado");
    expect(t[1].meta).toMatch(/ya saldado/);
  });

  it("de contado no cambia", () => {
    const t = construirTimelineCompra(
      cm({ ...base, metodo_pago: "Efectivo" }),
      [],
      fmt,
    );
    expect(t[1].act).toBe("Gasto pagado");
    expect(t[1].meta).toMatch(/^Efectivo/);
  });
});
