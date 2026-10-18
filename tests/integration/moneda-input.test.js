import { describe, it, expect } from "vitest";
import { digitosDeMonto } from "../../src/lib/moneda";

describe("digitosDeMonto", () => {
  it("deja solo los dígitos de los pesos", () => {
    expect(digitosDeMonto("$ 647.185")).toBe("647185");
  });
  it("corta los centavos escritos con coma", () => {
    expect(digitosDeMonto("150.000,50")).toBe("150000");
    expect(digitosDeMonto("$ 1.200,5")).toBe("1200");
  });
  it("quita ceros a la izquierda y respeta el máximo de dígitos", () => {
    expect(digitosDeMonto("000123")).toBe("123");
    expect(digitosDeMonto("1234567890123456", 12)).toBe("123456789012");
  });
  it("vacío se queda vacío", () => {
    expect(digitosDeMonto("")).toBe("");
    expect(digitosDeMonto(null)).toBe("");
  });
});
