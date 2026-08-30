import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

/**
 * Prueba de humo del modal de cambio de producto.
 *
 * Existe por un bug real: al reordenar unos derivados del precio, uno quedó por
 * encima de la declaración de la variable que usaba. Zona muerta temporal,
 * `ReferenceError` en cada render, y el modal de cambio inservible en todas las
 * ventas y para todos los roles. `npm run build`, `eslint` y los 31 tests
 * pasaron en verde con el bug puesto, porque ninguno ejecuta el componente.
 *
 * `renderToStaticMarkup` sí ejecuta el cuerpo del componente y sus hooks de
 * estado, que es donde vivía el fallo. No necesita jsdom ni testing-library:
 * `react-dom` ya es dependencia del proyecto. Los efectos no corren en SSR, así
 * que no toca la red; aun así se mockea el cliente de Supabase, porque su
 * import exige variables de entorno que no existen en los tests.
 *
 * No verifica cómo se ve nada. Solo responde una pregunta: ¿revienta al abrir?
 */

vi.mock("../../src/lib/supabase", () => {
  const q = {
    select: () => q,
    eq: () => q,
    in: () => q,
    order: () => q,
    limit: () => q,
    gt: () => q,
    is: () => q,
    maybeSingle: () => Promise.resolve({ data: null }),
    then: (r) => Promise.resolve({ data: [], error: null }).then(r),
  };
  return {
    supabase: {
      from: () => q,
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

const ModalCambioProducto = (
  await import("../../src/components/ventas/ModalCambioProducto")
).default;

const montar = (venta, items) =>
  renderToStaticMarkup(
    createElement(ModalCambioProducto, {
      venta,
      items,
      sedeId: "CV",
      onClose() {},
      onDone() {},
    }),
  );

const itemDe = (extra = {}) => ({
  producto_id: "p1",
  cantidad: 1,
  subtotal: 60000,
  precio_unitario: 60000,
  precio_catalogo: 65000,
  producto: { nombre: "AUTOMATICO", referencia: "A1VP", precio_venta: 65000 },
  ...extra,
});

describe("ModalCambioProducto — no revienta al abrirse", () => {
  it("venta con descuento en la línea", () => {
    const venta = {
      id: "v1",
      numero: 1789,
      subtotal: 60000,
      descuento_valor: 0,
      iva_pct: 0,
    };
    expect(() => montar(venta, [itemDe()])).not.toThrow();
  });

  it("venta con descuento global y con IVA", () => {
    const venta = {
      id: "v2",
      numero: 1790,
      subtotal: 100000,
      descuento_valor: 20000,
      iva_pct: 19,
    };
    expect(() => montar(venta, [itemDe({ subtotal: 100000 })])).not.toThrow();
  });

  it("venta que a su vez es un CAMBIO (la rama de ratio = 1)", () => {
    const venta = {
      id: "v3",
      numero: 1677,
      subtotal: 30000,
      descuento_valor: 25000,
      iva_pct: 0,
      cambio_de_venta_id: "v-original",
    };
    expect(() => montar(venta, [itemDe({ subtotal: 30000 })])).not.toThrow();
  });

  it("venta vieja, sin precio_catalogo guardado", () => {
    const venta = {
      id: "v4",
      numero: 500,
      subtotal: 60000,
      descuento_valor: 0,
      iva_pct: 0,
    };
    expect(() =>
      montar(venta, [itemDe({ precio_catalogo: null })]),
    ).not.toThrow();
  });

  it("venta sin productos devolubles (solo servicios)", () => {
    const venta = {
      id: "v5",
      numero: 501,
      subtotal: 50000,
      descuento_valor: 0,
      iva_pct: 0,
    };
    expect(() =>
      montar(venta, [
        { producto_id: null, descripcion: "Mano de obra", cantidad: 1 },
      ]),
    ).not.toThrow();
  });
});
