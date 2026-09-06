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
    // La precarga ocurre al pulsar el encabezado, no al montar: apagado sigue
    // significando cero retencion.
    const html = montar({
      ...BASE,
      sugeridas: { retefuentePct: 2.5, reteicaPct: 0.69, reteivaPct: 15 },
    });
    expect(html).toContain("Sin retenciones");
    expect(html).not.toContain("Neto a recibir");
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
    expect(html).toContain("Sin retenciones");
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
