import { describe, expect, it } from "vitest";
import {
  agregarDestinoConversion,
  avisoDetalleRecortado,
  idsDestinoConversion,
  quitarDestinosProducto,
  puedeConvertirAInsumo,
  etiquetaEnsamble,
  etiquetaOT,
  etiquetaPrestamo,
  lineasDetalleConversion,
  rutaDestino,
  textoConversionDestino,
  validarDestinoInsumo,
} from "../../src/lib/insumo-destino";

describe("validarDestinoInsumo", () => {
  it("sin escoger nada no deja confirmar y explica por qué", () => {
    const r = validarDestinoInsumo({ tipo: "" });
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/para qué es el insumo/);
  });

  it("'Sin destino' solo vale para el Admin", () => {
    expect(
      validarDestinoInsumo({ tipo: "ninguno" }, { esAdmin: true }),
    ).toEqual({ ok: true, motivo: "", payload: null });
    const r = validarDestinoInsumo({ tipo: "ninguno" }, { esAdmin: false });
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/Solo el Admin/);
  });

  it("OT exige el id", () => {
    expect(validarDestinoInsumo({ tipo: "orden", id: "" }).ok).toBe(false);
    expect(validarDestinoInsumo({ tipo: "orden", id: "abc" })).toEqual({
      ok: true,
      motivo: "",
      payload: { tipo: "orden", id: "abc" },
    });
  });

  it("ensamble y préstamo aceptan id o nota", () => {
    expect(
      validarDestinoInsumo({ tipo: "ensamble", id: "e1" }).payload,
    ).toEqual({ tipo: "ensamble", id: "e1" });
    expect(
      validarDestinoInsumo({ tipo: "ensamble", nota: "  Compresor 2HP " })
        .payload,
    ).toEqual({ tipo: "ensamble", nota: "Compresor 2HP" });
    expect(validarDestinoInsumo({ tipo: "prestamo", nota: "Luis" }).ok).toBe(
      true,
    );
    expect(validarDestinoInsumo({ tipo: "prestamo", nota: "  " }).ok).toBe(
      false,
    );
  });

  it("'Otro' pide nota de al menos 3 letras", () => {
    expect(validarDestinoInsumo({ tipo: "otro", nota: "ab" }).ok).toBe(false);
    expect(validarDestinoInsumo({ tipo: "otro", nota: "abc" }).payload).toEqual(
      { tipo: "otro", nota: "abc" },
    );
  });
});

describe("etiquetas de documentos", () => {
  it("OT con cliente y equipo, omitiendo vacíos", () => {
    expect(
      etiquetaOT({
        numero: 285,
        cliente_nombre: "Juan",
        equipo_descripcion: "Compresor",
      }),
    ).toBe("OT #285 · Juan · Compresor");
    expect(etiquetaOT({ numero: 3, cliente_nombre: " " })).toBe("OT #3");
  });

  it("ensamble y préstamo", () => {
    expect(etiquetaEnsamble({ numero: 7, producto: { nombre: "Kit" } })).toBe(
      "Ensamble #7 · Kit",
    );
    expect(
      etiquetaPrestamo({
        herramienta_nombre: "Taladro",
        usuario: { nombre: "Luis" },
      }),
    ).toBe("Taladro · prestada a Luis");
  });
});

describe("lineasDetalleConversion", () => {
  it("arma las líneas con la ruta del destino", () => {
    const l = lineasDetalleConversion({
      detalle: [
        {
          hora: "08:15",
          usuario: "Sofía",
          producto: "FILTRO",
          cantidad: 2,
          destino: "OT #285 · Juan",
          destino_tipo: "orden",
          destino_id: "o1",
        },
        { hora: "07:00", usuario: "Edna", producto: "X", cantidad: 1 },
      ],
    });
    expect(l[0]).toMatchObject({
      quien: "08:15 · Sofía",
      que: "2 × FILTRO",
      destino: "OT #285 · Juan",
      ruta: "/ops/ordenes/o1",
    });
    expect(l[1]).toMatchObject({ destino: "Sin destino", ruta: null });
  });
  it("notificación vieja sin detalle → []", () => {
    expect(lineasDetalleConversion({ sede_id: "CV" })).toEqual([]);
    expect(lineasDetalleConversion(undefined)).toEqual([]);
  });
});

describe("rutaDestino", () => {
  it("lleva a la OT, al ensamble o a Herramientas", () => {
    expect(rutaDestino("orden", "x")).toBe("/ops/ordenes/x");
    expect(rutaDestino("ensamble", "y")).toBe("/ops/ensambles/y");
    expect(rutaDestino("prestamo", "z")).toBe("/ops/herramientas");
    expect(rutaDestino("orden", null)).toBeNull();
    expect(rutaDestino("otro", "x")).toBeNull();
  });
});

describe("textoConversionDestino", () => {
  const docs = {
    orden: new Map([["o1", "OT #10 · Ana"]]),
    ensamble: new Map(),
    prestamo: new Map(),
  };
  it("usa la etiqueta resuelta del documento", () => {
    expect(
      textoConversionDestino({ tipo: "orden", orden_id: "o1" }, docs),
    ).toBe("OT #10 · Ana");
  });
  it("cae a la nota cuando el documento no existe todavía", () => {
    expect(
      textoConversionDestino({ tipo: "ensamble", nota: "Kit" }, docs),
    ).toBe("Ensamble nuevo · Kit");
    expect(textoConversionDestino({ tipo: "otro", nota: "Muestra" })).toBe(
      "Otro · Muestra",
    );
    expect(textoConversionDestino(null)).toBe("Sin destino");
  });
});

describe("destinos de conversión por producto (Nuevo ensamble)", () => {
  it("se guardan por producto y se juntan para vincular", () => {
    let m = {};
    m = agregarDestinoConversion(m, "p1", 10);
    m = agregarDestinoConversion(m, "p1", 11);
    m = agregarDestinoConversion(m, "p2", 20);
    expect(idsDestinoConversion(m).sort()).toEqual([10, 11, 20]);
  });

  it("quitar un componente suelta solo sus destinos", () => {
    const m = quitarDestinosProducto({ p1: [10, 11], p2: [20] }, "p1");
    expect(idsDestinoConversion(m)).toEqual([20]);
  });

  it("sin destino_id no agrega nada y no muta el original", () => {
    const orig = { p1: [10] };
    const m = agregarDestinoConversion(orig, "p1", null);
    expect(m).toEqual({ p1: [10] });
    expect(m).not.toBe(orig);
    expect(idsDestinoConversion(null)).toEqual([]);
  });
});

describe("puedeConvertirAInsumo (misma regla que fn_convertir_a_insumo)", () => {
  it("Admin y Técnico en cualquier sede", () => {
    expect(
      puedeConvertirAInsumo({ rol: "Admin", sede_id: "BODEGA" }, "CV"),
    ).toBe(true);
    expect(
      puedeConvertirAInsumo({ rol: "Tecnico", sede_id: "BODEGA" }, "L3"),
    ).toBe(true);
  });

  it("Vendedor y Bodeguero solo en su sede", () => {
    const vend = { rol: "Vendedor", sede_id: "CV" };
    expect(puedeConvertirAInsumo(vend, "CV")).toBe(true);
    expect(puedeConvertirAInsumo(vend, "BODEGA")).toBe(false);
    const bod = { rol: "Bodeguero", sede_id: "BODEGA" };
    expect(puedeConvertirAInsumo(bod, "BODEGA")).toBe(true);
    expect(puedeConvertirAInsumo(bod, "CHV")).toBe(false);
  });

  it("otro rol o sin perfil: no", () => {
    expect(puedeConvertirAInsumo({ rol: "Otro", sede_id: "CV" }, "CV")).toBe(
      false,
    );
    expect(puedeConvertirAInsumo(null, "CV")).toBe(false);
  });
});

describe("avisoDetalleRecortado (campana de conversiones)", () => {
  const det = (k) =>
    Array.from({ length: k }, (_, i) => ({ producto: `p${i}` }));
  it("si hubo más eventos que detalle guardado, lo dice", () => {
    expect(avisoDetalleRecortado({ eventos: 57, detalle: det(40) })).toBe(
      "Mostrando las últimas 40 de 57",
    );
  });
  it("si están todos, no hay aviso", () => {
    expect(avisoDetalleRecortado({ eventos: 12, detalle: det(12) })).toBe("");
    expect(avisoDetalleRecortado({ detalle: det(3) })).toBe("");
    expect(avisoDetalleRecortado(null)).toBe("");
  });
});
