import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import BloqueRetenciones from "../../src/components/ventas/BloqueRetenciones";

vi.mock("../../src/lib/supabase", () => {
  const q = {
    select: () => q,
    eq: () => q,
    gt: () => q,
    in: () => q,
    or: () => q,
    order: () => q,
    limit: () => q,
    range: () => Promise.resolve({ data: [], error: null, count: 0 }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (r) => Promise.resolve({ data: [], error: null }).then(r),
  };
  return {
    supabase: {
      from: () => q,
      rpc: () => Promise.resolve({ data: [], error: null }),
    },
  };
});

let perfilActual = { rol: "Vendedor", sede_id: "CV", nombre: "Deyanira" };
vi.mock("../../src/stores/authStore", () => ({
  get useAuthStore() {
    const usar = (sel) =>
      typeof sel === "function"
        ? sel({ perfil: perfilActual })
        : { perfil: perfilActual };
    usar.getState = () => ({ perfil: perfilActual });
    usar.setState = () => {};
    usar.subscribe = () => () => {};
    return usar;
  },
}));

/**
 * Prueba de humo del bloque de retenciones.
 *
 * Ni el build ni eslint ejecutan un componente, así que un error de render pasa
 * las dos verificaciones y llega a producción con la pantalla inservible. Ya
 * ocurrió dos veces en este proyecto; la última, una variable usada antes de
 * declararse en ModalCambioProducto, con build, eslint y 31 pruebas en verde.
 *
 * No comprueba cómo se ve nada: responde si abre y si dice lo que debe decir.
 */

const montar = (props) =>
  renderToStaticMarkup(createElement(BloqueRetenciones, props));

const BASE = {
  base: 1000000,
  iva: 190000,
  total: 1190000,
  valores: { retefuentePct: 0, reteicaPct: 0, reteivaPct: 0 },
  onChange() {},
};

describe("BloqueRetenciones", () => {
  it("no revienta al montarse apagado", () => {
    expect(() => montar(BASE)).not.toThrow();
  });

  it("apagado no muestra ningun campo de porcentaje ni el neto", () => {
    const html = montar(BASE);
    expect(html).toContain("Retenciones");
    expect(html).not.toContain("Neto a recibir");
    expect(html).not.toContain("Retefuente");
  });

  it("abierto muestra las tres retenciones y el neto", () => {
    const html = montar({
      ...BASE,
      abierto: true,
      valores: { retefuentePct: 2.5, reteicaPct: 0.69, reteivaPct: 15 },
    });
    expect(html).toContain("Retefuente");
    expect(html).toContain("ReteICA");
    expect(html).toContain("ReteIVA");
    expect(html).toContain("Neto a recibir");
  });

  it("solo lectura no pinta inputs editables", () => {
    const html = montar({ ...BASE, abierto: true, soloLectura: true });
    expect(html).not.toContain("<input");
  });

  it("aguanta valores nulos sin romperse", () => {
    expect(() =>
      montar({
        base: null,
        iva: null,
        total: null,
        valores: {},
        onChange() {},
      }),
    ).not.toThrow();
  });

  it("monta con tarifas sugeridas sin aplicarlas todavia", () => {
    // Las sugeridas NO se aplican solas en ningun momento, ni al montar ni al
    // abrir el bloque: hay que pulsar "Aplicar las tarifas de siempre". Si se
    // pusieran solas, abrir el bloque por curiosidad y cerrarlo dejaria la
    // venta con una retencion que nadie quiso y la caja descuadrada.
    const html = montar({
      ...BASE,
      sugeridas: { retefuentePct: 2.5, reteicaPct: 0.69, reteivaPct: 15 },
    });
    expect(html).toContain("Retenciones");
    expect(html).not.toContain("Neto a recibir");
    // Ningun porcentaje sugerido pintado como valor aplicado.
    expect(html).not.toContain("2,5");
  });
});

describe("Nueva Venta con el bloque de retenciones", () => {
  const montarVenta = async () => {
    const VentaNueva = (await import("../../src/pages/ops/VentaNueva")).default;
    return renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(VentaNueva)),
    );
  };

  it("la pantalla monta y trae el bloque", async () => {
    perfilActual = { rol: "Vendedor", sede_id: "CV", nombre: "Deyanira" };
    const html = await montarVenta();
    expect(html).toContain("Retenciones");
  });

  it("apagado sigue diciendo Total, no 'A recibir'", async () => {
    // Con las retenciones apagadas la pantalla no puede cambiar en nada: ese es
    // el criterio de aceptacion mas importante de toda la funcionalidad.
    const html = await montarVenta();
    expect(html).toContain("Retenciones");
    expect(html).not.toContain("A recibir");
  });

  it("como Admin tambien monta", async () => {
    perfilActual = { rol: "Admin", sede_id: "BODEGA", nombre: "Admin Maritza" };
    await expect(montarVenta()).resolves.toBeTruthy();
  });
});

describe("OrdenDetalle con retenciones", () => {
  it("monta sin reventar", async () => {
    perfilActual = { rol: "Vendedor", sede_id: "CV", nombre: "Deyanira" };
    const OrdenDetalle = (await import("../../src/pages/ops/OrdenDetalle"))
      .default;
    expect(() =>
      renderToStaticMarkup(
        createElement(MemoryRouter, null, createElement(OrdenDetalle)),
      ),
    ).not.toThrow();
  });
});

/**
 * El campo de porcentaje tiene que dejar escribir decimales.
 *
 * Con `value` atado al número ya parseado, `Number("2.")` da 2, el input se
 * revierte a "2" y el dígito siguiente se concatena: escribir "2,5" dejaba 25%
 * y "0,69" dejaba 69%. En una venta de un millón eso convierte $25.000 de
 * retefuente en $250.000, en silencio.
 *
 * Misma familia que el bug del separador de miles en ModalCambioProducto.
 *
 * El arreglo es separar lo que se MUESTRA (texto crudo, para poder escribir un
 * decimal a medias) de lo que se GUARDA (el número ya normalizado). Aquí se
 * prueba la normalización, que es la parte que decide plata.
 */
describe("normalizarPct", () => {
  it("acepta la coma, que es como se escribe en Colombia", async () => {
    const { normalizarPct } = await import("../../src/lib/retenciones");
    expect(normalizarPct("2,5")).toBe(2.5);
    expect(normalizarPct("0,69")).toBe(0.69);
    expect(normalizarPct("2.5")).toBe(2.5);
  });

  it("un decimal a medias no se convierte en otro numero", async () => {
    const { normalizarPct } = await import("../../src/lib/retenciones");
    // Mientras se escribe "2,5" pasa por "2," — que vale 2, no 25.
    expect(normalizarPct("2,")).toBe(2);
    expect(normalizarPct("0,")).toBe(0);
  });

  it("recorta a [0, 100] y nunca devuelve NaN", async () => {
    const { normalizarPct } = await import("../../src/lib/retenciones");
    expect(normalizarPct("")).toBe(0);
    expect(normalizarPct("abc")).toBe(0);
    expect(normalizarPct("-5")).toBe(0);
    expect(normalizarPct("500")).toBe(100);
    expect(normalizarPct(null)).toBe(0);
  });
});
