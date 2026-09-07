import { describe, it, expect } from "vitest";
import {
  UMBRALES,
  ventaTotal,
  filtrarPorPeso,
} from "../../src/lib/panel-composicion";

const FILAS = [
  { clave: "a", venta: 600, es_resto: false }, // 60%
  { clave: "b", venta: 300, es_resto: false }, // 30%
  { clave: "c", venta: 20, es_resto: false }, //  2%
  { clave: "d", venta: 5, es_resto: false }, // 0,5%
  { clave: "__resto__", venta: 75, es_resto: true }, // 7,5%
];

describe("filtrarPorPeso", () => {
  it("sin umbral no toca nada", () => {
    expect(filtrarPorPeso(FILAS, 0)).toHaveLength(5);
  });

  it("deja solo los que pesan el umbral o mas", () => {
    expect(filtrarPorPeso(FILAS, 0.03).map((f) => f.clave)).toEqual(["a", "b"]);
    expect(filtrarPorPeso(FILAS, 0.01).map((f) => f.clave)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("saca la fila del resto aunque su suma pase el umbral", () => {
    // Pesa 7,5%, mas que el umbral, pero es una bolsa de grupos que NO lo pasan:
    // dejarla dentro contradiria el filtro.
    expect(filtrarPorPeso(FILAS, 0.05).map((f) => f.clave)).toEqual(["a", "b"]);
  });

  it("con venta total en cero no revienta ni divide por cero", () => {
    expect(filtrarPorPeso([{ clave: "x", venta: 0 }], 0.01)).toEqual([]);
    expect(filtrarPorPeso([], 0.05)).toEqual([]);
    expect(ventaTotal([])).toBe(0);
  });

  it("el umbral mas bajo es 1%: con 100 grupos es el unico piso sin huecos", () => {
    const minimo = Math.min(...UMBRALES.map((u) => u.id).filter((x) => x > 0));
    expect(minimo).toBe(0.01);
  });

  it("tolera montos que llegan como texto desde PostgREST", () => {
    const filas = [
      { clave: "a", venta: "900", es_resto: false },
      { clave: "b", venta: "100", es_resto: false },
    ];
    expect(filtrarPorPeso(filas, 0.5).map((f) => f.clave)).toEqual(["a"]);
  });
});
