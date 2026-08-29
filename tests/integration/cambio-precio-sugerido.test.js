import { describe, it, expect } from "vitest";
import { precioSugeridoCambio } from "../../src/lib/ventas-ui";

describe("precioSugeridoCambio", () => {
  it("misma lista: sugiere lo que el cliente pagó (cambio par)", () => {
    // El caso real: pagó 60.000 de una lista de 65.000 y cambia por otro de 65.000.
    expect(
      precioSugeridoCambio({
        precioPagadoUnitario: 60000,
        listaDevuelto: 65000,
        listaNuevo: 65000,
      }),
    ).toBe(60000);
  });

  it("el nuevo es más caro: conserva el mismo descuento en pesos", () => {
    expect(
      precioSugeridoCambio({
        precioPagadoUnitario: 60000,
        listaDevuelto: 65000,
        listaNuevo: 100000,
      }),
    ).toBe(95000);
  });

  it("subió la lista de las dos referencias: sigue siendo par", () => {
    expect(
      precioSugeridoCambio({
        precioPagadoUnitario: 65000,
        listaDevuelto: 70000,
        listaNuevo: 70000,
      }),
    ).toBe(65000);
  });

  it("sin descuento de por medio: cae en el precio de lista del nuevo", () => {
    expect(
      precioSugeridoCambio({
        precioPagadoUnitario: 65000,
        listaDevuelto: 65000,
        listaNuevo: 100000,
      }),
    ).toBe(100000);
  });

  it("sin lista del devuelto: cae en el precio de lista del nuevo", () => {
    expect(
      precioSugeridoCambio({
        precioPagadoUnitario: 60000,
        listaDevuelto: 0,
        listaNuevo: 100000,
      }),
    ).toBe(100000);
  });

  it("nunca sugiere un precio negativo", () => {
    expect(
      precioSugeridoCambio({
        precioPagadoUnitario: 10000,
        listaDevuelto: 65000,
        listaNuevo: 20000,
      }),
    ).toBe(0);
  });

  it("redondea a pesos", () => {
    expect(
      precioSugeridoCambio({
        precioPagadoUnitario: 59999.6,
        listaDevuelto: 65000,
        listaNuevo: 65000,
      }),
    ).toBe(60000);
  });
});
