import { describe, it, expect } from "vitest";
import { aCSV, nombreArchivo } from "../../src/lib/panel-exportar";

describe("aCSV", () => {
  it("escapa las comas y las comillas de los nombres", () => {
    const csv = aCSV(
      [{ nombre: 'FILTRO 1/2", ROSCA', total: 1000 }],
      [
        { clave: "nombre", titulo: "Producto" },
        { clave: "total", titulo: "Total" },
      ],
    );
    // La comilla se duplica y el campo entero va entre comillas. Los nombres de
    // esta empresa traen las dos cosas de verdad.
    expect(csv).toContain('"FILTRO 1/2"", ROSCA"');
  });

  it("pone los titulos en la primera fila", () => {
    const csv = aCSV([], [{ clave: "a", titulo: "Columna A" }]);
    expect(csv.split("\n")[0]).toBe("Columna A");
  });

  it("separa con punto y coma para que Excel en espanol lo abra en columnas", () => {
    const csv = aCSV(
      [{ a: 1, b: 2 }],
      [
        { clave: "a", titulo: "A" },
        { clave: "b", titulo: "B" },
      ],
    );
    expect(csv).toBe("A;B\n1;2");
  });

  it("un valor con punto y coma tambien se protege", () => {
    const csv = aCSV([{ a: "uno; dos" }], [{ clave: "a", titulo: "A" }]);
    expect(csv).toBe('A\n"uno; dos"');
  });

  it("los nulos salen vacios, no como la palabra null", () => {
    const csv = aCSV(
      [{ a: null, b: undefined }],
      [
        { clave: "a", titulo: "A" },
        { clave: "b", titulo: "B" },
      ],
    );
    expect(csv).toBe("A;B\n;");
  });

  it("un salto de linea dentro de un campo no parte la fila", () => {
    const csv = aCSV([{ a: "uno\ndos" }], [{ clave: "a", titulo: "A" }]);
    expect(csv).toBe('A\n"uno\ndos"');
  });
});

describe("nombreArchivo", () => {
  it("lleva el rango aplicado, para no confundir dos descargas", () => {
    expect(
      nombreArchivo("panel-perdidas", {
        desde: "2026-09-01",
        hasta: "2026-09-30",
      }),
    ).toBe("panel-perdidas-2026-09-01-a-2026-09-30.csv");
  });

  it("sin rango (las fotos de hoy) va solo el nombre", () => {
    expect(nombreArchivo("panel-cartera", null)).toBe("panel-cartera.csv");
  });
});
