import { describe, expect, it } from "vitest";
import {
  ORIGEN_FUENTES,
  etiquetaOrigen,
  formatPesos,
  precioUnicoDeLineas,
  rutaOrigen,
  textoValorMovimiento,
  valorMovimiento,
} from "../../src/lib/admin-ops-ui";

// Intl separa "$" y el número con un espacio duro; se normaliza para comparar.
const plano = (s) => s.replace(/\s/g, " ");

describe("etiquetaOrigen", () => {
  it("documento en palabras según referencia_tipo", () => {
    expect(
      etiquetaOrigen("orden_servicio", { numero: 285, cliente_nombre: "Ana" }),
    ).toBe("OT #285 · Ana");
    expect(etiquetaOrigen("venta", { numero: 12 })).toBe("Venta #12");
    expect(etiquetaOrigen("compra", { numero: 3 })).toBe("Compra #3");
    expect(etiquetaOrigen("ensamble", { numero: 7 })).toBe("Ensamble #7");
    expect(etiquetaOrigen("traspaso", { numero: 40 })).toBe("Traslado #40");
    expect(etiquetaOrigen("devolucion", { numero: 2 })).toBe("Devolución #2");
    expect(etiquetaOrigen("garantia_compra", { numero: 1 })).toBe(
      "Garantía de compra #1",
    );
    expect(etiquetaOrigen("garantia_venta", { numero: 5 })).toBe(
      "Garantía de venta #5",
    );
    expect(
      etiquetaOrigen("herramienta", { herramienta_nombre: "Taladro" }),
    ).toBe("Herramienta · Taladro");
    expect(etiquetaOrigen("conteo", null)).toBe("Conteo cíclico");
  });

  it("sin documento resuelto no inventa número", () => {
    expect(etiquetaOrigen("venta", null)).toBe("Venta");
    expect(etiquetaOrigen("orden_servicio", undefined)).toBe("OT");
    expect(etiquetaOrigen(null, null)).toBe("—");
  });

  it("cada fuente con tabla tiene ruta", () => {
    for (const ref of Object.keys(ORIGEN_FUENTES)) {
      expect(rutaOrigen(ref, "id-1")).toBeTruthy();
    }
  });
});

describe("rutaOrigen", () => {
  it("rutas reales de App.jsx", () => {
    expect(rutaOrigen("orden_servicio", "a")).toBe("/ops/ordenes/a");
    expect(rutaOrigen("venta", "a")).toBe("/ops/ventas/a");
    expect(rutaOrigen("traspaso", "a")).toBe("/ops/traspasos/a");
    expect(rutaOrigen("garantia_compra", "a")).toBe("/ops/garantias/compra/a");
    expect(rutaOrigen("venta", null)).toBeNull();
    expect(rutaOrigen("conversion", null)).toBeNull();
  });
});

describe("precioUnicoDeLineas", () => {
  it("un precio único → ese precio", () => {
    expect(precioUnicoDeLineas([{ precio: "45000" }])).toBe(45000);
    expect(precioUnicoDeLineas([{ precio: 10 }, { precio: 10 }])).toBe(10);
  });
  it("precios distintos o sin líneas → null (no promedia)", () => {
    expect(precioUnicoDeLineas([{ precio: 10 }, { precio: 12 }])).toBeNull();
    expect(precioUnicoDeLineas([])).toBeNull();
    expect(precioUnicoDeLineas([{ precio: null }])).toBeNull();
  });
});

describe("valorMovimiento", () => {
  it("unidades absolutas × precio", () => {
    expect(valorMovimiento(-2, 45000)).toEqual({
      unidades: 2,
      precio: 45000,
      total: 90000,
      aCosto: false,
    });
  });
  it("precio desconocido → null", () => {
    expect(valorMovimiento(3, null)).toBeNull();
    expect(valorMovimiento(0, 100)).toBeNull();
  });
  it("venta a $0 es un valor real; costo 0 es desconocido", () => {
    expect(valorMovimiento(1, 0)?.total).toBe(0);
    expect(valorMovimiento(1, 0, { aCosto: true })).toBeNull();
  });
});

describe("textoValorMovimiento", () => {
  it("formato con pesos sin decimales", () => {
    expect(plano(textoValorMovimiento(valorMovimiento(2, 45000)))).toBe(
      "2 uds × $ 45.000 = $ 90.000",
    );
    expect(plano(textoValorMovimiento(valorMovimiento(1, 1234.6)))).toBe(
      "1 ud × $ 1.235 = $ 1.235",
    );
    expect(textoValorMovimiento(null)).toBe("—");
    expect(plano(formatPesos(1500))).toBe("$ 1.500");
  });
});
