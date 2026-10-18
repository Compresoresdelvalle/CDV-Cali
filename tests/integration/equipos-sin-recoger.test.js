import { describe, it, expect } from "vitest";
import {
  severidadSinRecoger,
  sedeDelEquipo,
  telHref,
  ordenarSinRecoger,
  diasLabel,
} from "../../src/lib/equipos-sin-recoger";

describe("Alertas: equipos sin recoger", () => {
  it("con el parámetro por defecto (30) pasa a urgente después de 45 días", () => {
    expect(severidadSinRecoger(31)).toBe("--warning");
    expect(severidadSinRecoger(45)).toBe("--warning");
    expect(severidadSinRecoger(46)).toBe("--destructive");
    expect(severidadSinRecoger(null)).toBe("--warning");
  });

  it("urgente es relativo al parámetro: parámetro + 15", () => {
    expect(severidadSinRecoger(61, 60)).toBe("--warning");
    expect(severidadSinRecoger(75, 60)).toBe("--warning");
    expect(severidadSinRecoger(76, 60)).toBe("--destructive");
    expect(severidadSinRecoger(26, 10)).toBe("--destructive");
    // parámetro inválido: se usa el de por defecto
    expect(severidadSinRecoger(46, 0)).toBe("--destructive");
  });

  it("la sede que cuenta es donde está el equipo", () => {
    expect(sedeDelEquipo({ sede_id: "CV", sede_equipo: "BODEGA" })).toBe(
      "BODEGA",
    );
    expect(sedeDelEquipo({ sede_id: "CV", sede_equipo: null })).toBe("CV");
    expect(sedeDelEquipo(null)).toBeNull();
  });

  it("arma el enlace para llamar limpiando el número", () => {
    expect(telHref("315 456 7890")).toBe("tel:3154567890");
    expect(telHref("(602) 555-1234")).toBe("tel:6025551234");
    expect(telHref("+57 315.456.7890")).toBe("tel:+573154567890");
  });

  it("no ofrece llamar si no hay un número usable", () => {
    expect(telHref("")).toBeNull();
    expect(telHref(null)).toBeNull();
    expect(telHref("no tiene")).toBeNull();
    expect(telHref("123")).toBeNull();
  });

  it("ordena por días sin movimiento, luego por número de OT", () => {
    const filas = [
      { numero: 5, dias_sin_movimiento: 40 },
      { numero: 2, dias_sin_movimiento: 90 },
      { numero: 1, dias_sin_movimiento: 40 },
    ];
    expect(ordenarSinRecoger(filas).map((f) => f.numero)).toEqual([2, 1, 5]);
    // No muta la entrada.
    expect(filas[0].numero).toBe(5);
  });

  it("etiqueta de días en singular y plural", () => {
    expect(diasLabel(1)).toBe("1 día");
    expect(diasLabel(33)).toBe("33 días");
  });
});
