import { describe, expect, it } from "vitest";
import {
  etiquetaEnsamble,
  etiquetaOT,
  etiquetaPrestamo,
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
