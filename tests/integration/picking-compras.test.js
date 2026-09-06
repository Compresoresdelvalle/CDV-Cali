import { describe, it, expect } from "vitest";
import {
  lineaNueva,
  derivar,
  resumen,
  construirPayload,
  metodoReal,
  METODO,
  BADGE,
} from "../../src/lib/picking-compras";

const det = (over = {}) => ({
  id: "d1",
  producto_id: "p1",
  cantidad: 10,
  destino: "venta",
  producto: { referencia: "MAT6", nombre: "MANGUERA 6MM" },
  ...over,
});

describe("lineaNueva", () => {
  it("arranca en cero y sin contar, que es lo que hace de esto un conteo", () => {
    const l = lineaNueva(det());
    expect(l.llegaron).toBe(0);
    expect(l.danadas).toBe(0);
    expect(l.contada).toBe(false);
    expect(l.pedido).toBe(10);
  });
});

describe("derivar", () => {
  it("sin contar no afirma nada: el cero no significa que no llegó", () => {
    const d = derivar(lineaNueva(det()));
    expect(d.estado).toBe("sin_contar");
  });

  it("llegó todo", () => {
    const d = derivar({ ...lineaNueva(det()), llegaron: 10, contada: true });
    expect(d).toMatchObject({ buenas: 10, faltan: 0, sobran: 0, estado: "completo" });
  });

  it("faltaron", () => {
    const d = derivar({ ...lineaNueva(det()), llegaron: 8, contada: true });
    expect(d).toMatchObject({ buenas: 8, faltan: 2, sobran: 0, estado: "faltan" });
  });

  it("sobraron", () => {
    const d = derivar({ ...lineaNueva(det()), llegaron: 12, contada: true });
    expect(d).toMatchObject({ buenas: 12, faltan: 0, sobran: 2, estado: "sobran" });
  });

  it("dañadas mandan sobre el resto en el semáforo", () => {
    const d = derivar({ ...lineaNueva(det()), llegaron: 8, danadas: 2, contada: true });
    expect(d).toMatchObject({ buenas: 6, faltan: 2, estado: "danadas" });
  });

  it("una línea contada en cero no es lo mismo que una sin contar", () => {
    const d = derivar({ ...lineaNueva(det()), llegaron: 0, contada: true });
    expect(d.estado).toBe("faltan");
    expect(d.faltan).toBe(10);
  });
});

describe("resumen", () => {
  const base = lineaNueva(det());

  it("no deja confirmar mientras falten líneas por contar", () => {
    const r = resumen([base, { ...base, detalle_id: "d2", llegaron: 5, contada: true }]);
    expect(r.contadas).toBe(1);
    expect(r.total).toBe(2);
    expect(r.listo).toBe(false);
    expect(r.motivoBloqueo).toMatch(/1 línea/);
  });

  it("no deja confirmar si hay faltante sin decidir qué hacer", () => {
    const r = resumen([{ ...base, llegaron: 8, contada: true, faltante_accion: null }]);
    expect(r.listo).toBe(false);
    expect(r.motivoBloqueo).toMatch(/faltante/i);
  });

  it("no deja confirmar si hay sobrante sin decidir", () => {
    const r = resumen([{ ...base, llegaron: 12, contada: true, sobrante_accion: null }]);
    expect(r.listo).toBe(false);
    expect(r.motivoBloqueo).toMatch(/sobrante/i);
  });

  it("suma lo que se reclama: faltante reclamado más dañadas", () => {
    const r = resumen([
      { ...base, llegaron: 8, danadas: 1, contada: true, faltante_accion: "reclamar" },
    ]);
    expect(r.aReclamar).toBe(3);
    expect(r.aAjustar).toBe(0);
    expect(r.listo).toBe(true);
  });

  it("el faltante ajustado no se reclama, baja la factura", () => {
    const r = resumen([
      { ...base, llegaron: 8, contada: true, faltante_accion: "ajustar" },
    ]);
    expect(r.aAjustar).toBe(2);
    expect(r.aReclamar).toBe(0);
  });

  it("cuenta el sobrante", () => {
    const r = resumen([
      { ...base, llegaron: 12, contada: true, sobrante_accion: "entra" },
    ]);
    expect(r.deMas).toBe(2);
    expect(r.listo).toBe(true);
  });
});

describe("todo en cero", () => {
  it("no deja recibir una compra en la que no llego nada: manda a cancelar", () => {
    const l = { ...lineaNueva(det()), llegaron: 0, contada: true, faltante_accion: "ajustar" };
    const r = resumen([l, { ...l, detalle_id: "d2" }]);
    expect(r.todoEnCero).toBe(true);
    expect(r.listo).toBe(false);
    expect(r.motivoBloqueo).toMatch(/cancelarla/i);
  });

  it("si al menos una linea trae algo, no es el caso de todo en cero", () => {
    const cero = { ...lineaNueva(det()), llegaron: 0, contada: true, faltante_accion: "ajustar" };
    const algo = { ...lineaNueva(det({ id: "d2" })), llegaron: 10, contada: true };
    const r = resumen([cero, algo]);
    expect(r.todoEnCero).toBe(false);
    expect(r.listo).toBe(true);
  });
});

describe("metodoReal", () => {
  it("'completo' que despues se corrige a mano deja de ser 'completo'", () => {
    const l = { ...lineaNueva(det()), llegaron: 8, contada: true, metodo: METODO.COMPLETO };
    expect(metodoReal(l)).toBe(METODO.MANUAL);
  });

  it("'completo' que sigue cuadrando con el pedido se conserva", () => {
    const l = { ...lineaNueva(det()), llegaron: 10, contada: true, metodo: METODO.COMPLETO };
    expect(metodoReal(l)).toBe(METODO.COMPLETO);
  });

  it("'nada' al que despues le suman unidades deja de ser 'nada'", () => {
    const l = { ...lineaNueva(det()), llegaron: 2, contada: true, metodo: METODO.NADA };
    expect(metodoReal(l)).toBe(METODO.MANUAL);
  });

  it("el escaner se respeta tal cual", () => {
    const l = { ...lineaNueva(det()), llegaron: 7, contada: true, metodo: METODO.ESCANER };
    expect(metodoReal(l)).toBe(METODO.ESCANER);
  });

  it("'completo' con dañadas marcadas después también deja de ser 'completo', aunque llegaron siga cuadrando con el pedido", () => {
    const l = {
      ...lineaNueva(det()),
      llegaron: 10,
      danadas: 2,
      contada: true,
      metodo: METODO.COMPLETO,
    };
    expect(metodoReal(l)).toBe(METODO.MANUAL);
  });
});

describe("BADGE", () => {
  it("cubre todos los estados que puede devolver derivar", () => {
    const estados = ["sin_contar", "completo", "faltan", "danadas", "sobran"];
    for (const e of estados) {
      expect(BADGE[e]).toBeDefined();
      // StatusBadge solo entiende estos cinco: cualquier otro se pinta mal.
      expect(["success", "warning", "danger", "info", "neutral"]).toContain(
        BADGE[e].status,
      );
      expect(BADGE[e].texto.length).toBeGreaterThan(0);
    }
  });
});

describe("construirPayload", () => {
  it("manda los conteos y las decisiones, no los derivados", () => {
    const p = construirPayload([
      {
        ...lineaNueva(det()),
        llegaron: 8,
        danadas: 1,
        contada: true,
        metodo: METODO.ESCANER,
        faltante_accion: "reclamar",
      },
    ]);
    expect(p).toEqual([
      {
        detalle_id: "d1",
        llegaron: 8,
        danadas: 1,
        faltante_accion: "reclamar",
        sobrante_accion: null,
        metodo_conteo: "escaner",
      },
    ]);
  });

  it("el servidor deriva: el payload no lleva buenas ni faltan", () => {
    const p = construirPayload([{ ...lineaNueva(det()), llegaron: 10, contada: true }]);
    expect(p[0]).not.toHaveProperty("buenas");
    expect(p[0]).not.toHaveProperty("faltan");
  });
});
