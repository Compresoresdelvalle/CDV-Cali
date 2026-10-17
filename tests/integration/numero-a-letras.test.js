import { describe, it, expect } from "vitest";
import { montoEnLetras, enteroEnLetras } from "../../src/lib/numero-a-letras";

/**
 * El monto en letras va impreso en el comprobante de egreso de caja menor y
 * lo firma quien recibe la plata. Un "un mil" o un "veintiuno pesos" se ve
 * como un documento hecho a la carrera; un número mal leído es peor.
 */
describe("montoEnLetras", () => {
  it("el caso que pidió la clienta", () => {
    expect(montoEnLetras(647185)).toBe(
      "Seiscientos cuarenta y siete mil ciento ochenta y cinco pesos",
    );
  });

  it("ceros", () => {
    expect(montoEnLetras(0)).toBe("Cero pesos");
    expect(montoEnLetras(1000)).toBe("Mil pesos");
    expect(montoEnLetras(100000)).toBe("Cien mil pesos");
    expect(montoEnLetras(200005)).toBe("Doscientos mil cinco pesos");
    expect(montoEnLetras(1000001)).toBe("Un millón un pesos");
  });

  it("mil sin 'uno'", () => {
    expect(montoEnLetras(1500)).toBe("Mil quinientos pesos");
    expect(montoEnLetras(1001000)).toBe("Un millón mil pesos");
    expect(montoEnLetras(1000)).not.toMatch(/un mil/i);
  });

  it("millones: 'un millón' y 'de pesos' en millones redondos", () => {
    expect(montoEnLetras(1000000)).toBe("Un millón de pesos");
    expect(montoEnLetras(2000000)).toBe("Dos millones de pesos");
    expect(montoEnLetras(21000000)).toBe("Veintiún millones de pesos");
    expect(montoEnLetras(1250000)).toBe(
      "Un millón doscientos cincuenta mil pesos",
    );
    expect(montoEnLetras(1000000000)).toBe("Mil millones de pesos");
    expect(montoEnLetras(3456789012)).toBe(
      "Tres mil cuatrocientos cincuenta y seis millones setecientos ochenta y nueve mil doce pesos",
    );
  });

  it("apócope de 'uno' delante de mil, millones y pesos", () => {
    expect(montoEnLetras(1)).toBe("Un peso");
    expect(montoEnLetras(21)).toBe("Veintiún pesos");
    expect(montoEnLetras(31)).toBe("Treinta y un pesos");
    expect(montoEnLetras(21000)).toBe("Veintiún mil pesos");
    expect(montoEnLetras(31000)).toBe("Treinta y un mil pesos");
    expect(montoEnLetras(101000)).toBe("Ciento un mil pesos");
  });

  it("cien vs ciento, decenas y especiales", () => {
    expect(montoEnLetras(100)).toBe("Cien pesos");
    expect(montoEnLetras(101)).toBe("Ciento un pesos");
    expect(montoEnLetras(16)).toBe("Dieciséis pesos");
    expect(montoEnLetras(22)).toBe("Veintidós pesos");
    expect(montoEnLetras(90)).toBe("Noventa pesos");
    expect(montoEnLetras(555)).toBe("Quinientos cincuenta y cinco pesos");
    expect(montoEnLetras(999999)).toBe(
      "Novecientos noventa y nueve mil novecientos noventa y nueve pesos",
    );
  });

  it("redondea a pesos y acepta texto numérico de la base", () => {
    expect(montoEnLetras("13000.00")).toBe("Trece mil pesos");
    expect(montoEnLetras(44900.4)).toBe(
      "Cuarenta y cuatro mil novecientos pesos",
    );
  });

  it("valores vacíos no inventan un monto", () => {
    expect(montoEnLetras(null)).toBe("");
    expect(montoEnLetras(undefined)).toBe("");
    expect(montoEnLetras("")).toBe("");
    expect(montoEnLetras("abc")).toBe("");
  });

  it("enteroEnLetras sin sustantivo conserva 'uno'", () => {
    expect(enteroEnLetras(1)).toBe("uno");
    expect(enteroEnLetras(21)).toBe("veintiuno");
    expect(enteroEnLetras(1000000000000)).toBe("un billón");
  });
});
