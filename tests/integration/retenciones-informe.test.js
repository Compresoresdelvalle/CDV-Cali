import { describe, it, expect } from "vitest";
import {
  baseVenta,
  ivaVenta,
  baseOT,
  ivaOT,
  baseCompra,
  normalizarDoc,
  resumirRetenciones,
  agruparPorTercero,
  filasCSV,
  rangoMesBogota,
  etiquetaMes,
} from "../../src/lib/retenciones-informe";
import { calcularRetenciones } from "../../src/lib/retenciones";

/**
 * Retenciones a la vista: las bases son espejo de las funciones del servidor
 * (_fn_base_retencion_venta, _fn_base_retencion_ot y la expresión de compras),
 * y las sumas leen los valores guardados, nunca los recalculan.
 */

const venta = (over = {}) => ({
  id: "v1",
  numero: 100,
  fecha: "2026-10-05T15:00:00+00:00",
  cliente_nombre: "Ingenio XYZ",
  sede_id: "CV",
  subtotal: 1000000,
  descuento_valor: 100000,
  descuento_pct: null,
  iva_pct: 19,
  total: 1071000,
  retefuente_pct: 2.5,
  reteica_pct: 0.69,
  reteiva_pct: 15,
  retefuente_valor: 22500,
  reteica_valor: 6210,
  reteiva_valor: 25650,
  retenciones_total: 54360,
  ...over,
});

describe("bases (espejo del servidor)", () => {
  it("venta: subtotal menos descuento en $, o el % legado", () => {
    expect(baseVenta(venta())).toBe(900000);
    expect(baseVenta(venta({ descuento_valor: null, descuento_pct: 10 }))).toBe(
      900000,
    );
    // El descuento nunca deja la base negativa.
    expect(baseVenta(venta({ descuento_valor: 5000000 }))).toBe(0);
    expect(ivaVenta(venta())).toBe(171000);
  });

  it("la base coincide con la que usa calcularRetenciones", () => {
    const v = venta();
    const r = calcularRetenciones({
      base: baseVenta(v),
      iva: ivaVenta(v),
      total: v.total,
      retefuentePct: v.retefuente_pct,
      reteicaPct: v.reteica_pct,
      reteivaPct: v.reteiva_pct,
    });
    expect(r.retefuente).toBe(v.retefuente_valor);
    expect(r.reteica).toBe(v.reteica_valor);
    expect(r.reteiva).toBe(v.reteiva_valor);
    expect(r.total).toBe(v.retenciones_total);
  });

  it("OT: sin autorización solo cuenta la revisión", () => {
    const ot = {
      costo_mano_obra: 300000,
      valor_repuestos: 200000,
      valor_revision: 50000,
      descuento_valor: 50000,
      iva_pct: 19,
    };
    expect(baseOT(ot)).toBe(500000);
    expect(ivaOT(ot)).toBe(95000);
    expect(baseOT({ ...ot, estado_autorizacion: "no_autorizado" })).toBe(50000);
    expect(baseOT({ ...ot, descuento_valor: 9e9 })).toBe(0);
  });

  it("compra: subtotal menos descuento, nunca negativa", () => {
    expect(baseCompra({ subtotal: 400000, descuento_valor: 40000 })).toBe(
      360000,
    );
    expect(baseCompra({ subtotal: 100, descuento_valor: 500 })).toBe(0);
  });
});

describe("normalizarDoc", () => {
  it("deja solo las retenciones con valor y pone el IVA como base del reteIVA", () => {
    const d = normalizarDoc(
      venta({ reteica_pct: 0, reteica_valor: 0, retenciones_total: 48150 }),
      "venta",
    );
    expect(d.retenciones.map((r) => r.tipo)).toEqual(["retefuente", "reteiva"]);
    expect(d.retenciones[0].base).toBe(900000);
    expect(d.retenciones[1].base).toBe(171000);
    expect(d.neto).toBe(1071000 - 48150);
    expect(d.tercero).toBe("Ingenio XYZ");
  });

  it("OT usa la fecha de entrega y compra el proveedor y su sede destino", () => {
    const ot = normalizarDoc(
      {
        numero: 5,
        fecha: "2026-08-01T00:00:00Z",
        fecha_entrega: "2026-10-02T00:00:00Z",
        cliente_nombre: null,
        total: 10,
        retenciones_total: 0,
      },
      "ot",
    );
    expect(ot.fecha).toBe("2026-10-02T00:00:00Z");
    expect(ot.tercero).toBe("Cliente mostrador");
    const c = normalizarDoc(
      {
        numero: 9,
        proveedor: " Prov SAS ",
        sede_destino_id: "BODEGA",
        iva: 1900,
        total: 11900,
      },
      "compra",
    );
    expect(c.tercero).toBe("Prov SAS");
    expect(c.sedeId).toBe("BODEGA");
    expect(c.iva).toBe(1900);
  });
});

describe("sumas y agrupación", () => {
  const docs = [
    normalizarDoc(venta(), "venta"),
    normalizarDoc(
      venta({
        id: "v2",
        numero: 101,
        fecha: "2026-10-01T15:00:00+00:00",
        cliente_nombre: "ingenio xyz",
      }),
      "venta",
    ),
    normalizarDoc(
      venta({
        id: "v3",
        numero: 102,
        cliente_nombre: "Otro",
        total: 500000,
        retefuente_valor: 10000,
        reteica_valor: 0,
        reteiva_valor: 0,
        retenciones_total: 10000,
      }),
      "venta",
    ),
  ];

  it("resumirRetenciones suma por tipo, facturado, retenido y neto", () => {
    const r = resumirRetenciones(docs);
    expect(r.n).toBe(3);
    expect(r.porTipo).toEqual({
      retefuente: 22500 * 2 + 10000,
      reteica: 6210 * 2,
      reteiva: 25650 * 2,
    });
    expect(r.retenido).toBe(54360 * 2 + 10000);
    expect(r.facturado).toBe(1071000 * 2 + 500000);
    expect(r.neto).toBe(r.facturado - r.retenido);
    // La suma por tipo cuadra con el total retenido.
    expect(r.porTipo.retefuente + r.porTipo.reteica + r.porTipo.reteiva).toBe(
      r.retenido,
    );
  });

  it("sin documentos todo da cero", () => {
    expect(resumirRetenciones([])).toMatchObject({
      n: 0,
      retenido: 0,
      neto: 0,
    });
  });

  it("agruparPorTercero junta sin importar mayúsculas y ordena por retenido", () => {
    const g = agruparPorTercero(docs);
    expect(g).toHaveLength(2);
    expect(g[0].tercero).toBe("Ingenio XYZ");
    expect(g[0].docs.map((d) => d.numero)).toEqual([101, 100]);
    expect(g[0].retenido).toBe(54360 * 2);
    expect(g[1].retenido).toBe(10000);
  });

  it("filasCSV saca una fila por retención, con % de coma decimal", () => {
    const filas = filasCSV([docs[0]], "Nos retuvieron");
    expect(filas).toHaveLength(3);
    expect(filas[1]).toMatchObject({
      lado: "Nos retuvieron",
      documento: "Venta #100",
      tipo: "ReteICA",
      base: 900000,
      pct: "0,69",
      valor: 6210,
      fecha: "05/10/2026",
    });
  });
});

describe("rango del mes en Bogotá", () => {
  it("arma primer y último día con offset -05:00", () => {
    expect(rangoMesBogota("2026-02")).toEqual({
      desdeDia: "2026-02-01",
      hastaDia: "2026-02-28",
      desde: "2026-02-01T00:00:00.000-05:00",
      hasta: "2026-02-28T23:59:59.999-05:00",
    });
    expect(rangoMesBogota("2028-02").hastaDia).toBe("2028-02-29");
    expect(rangoMesBogota("2026-12").hastaDia).toBe("2026-12-31");
  });

  it("una venta a las 9 p. m. del 31 de octubre en Bogotá es de octubre", () => {
    const r = rangoMesBogota("2026-10");
    const t = Date.parse("2026-11-01T02:00:00Z");
    expect(t).toBeLessThanOrEqual(Date.parse(r.hasta));
    expect(Date.parse("2026-11-01T05:00:00Z")).toBeGreaterThan(
      Date.parse(r.hasta),
    );
  });

  it("rechaza meses inválidos y nombra el mes en español", () => {
    expect(rangoMesBogota("2026-13")).toBeNull();
    expect(rangoMesBogota("")).toBeNull();
    expect(etiquetaMes("2026-10")).toMatch(/octubre.*2026/);
  });
});
