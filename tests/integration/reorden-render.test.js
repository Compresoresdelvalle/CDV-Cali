import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";

/**
 * Prueba de humo de Reorden, que incluye el asistente "Sugerir mínimos y
 * máximos".
 *
 * Ni el build ni eslint ejecutan un componente, así que un error de render pasa
 * las dos verificaciones y llega a producción con la pantalla inservible. Ya
 * ocurrió. `renderToStaticMarkup` sí corre el cuerpo y sus hooks de estado.
 *
 * No comprueba cómo se ve nada: responde si abre, y si el filtro por clase ABC
 * quedó pintado.
 */

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

let perfilActual = { rol: "Admin", sede_id: "BODEGA", nombre: "Admin Maritza" };
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

const modulo = await import("../../src/pages/admin/Reorden");
const Reorden = modulo.default;
const ModalMinMax = modulo.ModalMinMax;

const montar = () =>
  renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(Reorden)),
  );

describe("Reorden — no revienta al abrirse", () => {
  it("como Admin", () => {
    perfilActual = { rol: "Admin", sede_id: "BODEGA", nombre: "Admin Maritza" };
    expect(() => montar()).not.toThrow();
  });

  it("como vendedora", () => {
    perfilActual = { rol: "Vendedor", sede_id: "CV", nombre: "Deyanira" };
    expect(() => montar()).not.toThrow();
  });

  it("como bodeguero", () => {
    perfilActual = { rol: "Bodeguero", sede_id: "BODEGA", nombre: "Bodega" };
    expect(() => montar()).not.toThrow();
  });

  it("el asistente abre y trae el filtro por clase ABC", () => {
    // El asistente es un modal: la pagina no lo monta hasta que se pulsa
    // "Sugerir min/max", asi que se renderiza aparte.
    perfilActual = { rol: "Admin", sede_id: "BODEGA", nombre: "Admin Maritza" };
    const html = renderToStaticMarkup(
      createElement(ModalMinMax, {
        onClose() {},
        onAplicado() {},
        sedes: [{ id: "BODEGA", nombre: "Bodega Principal" }],
        sedeInicial: "BODEGA",
      }),
    );
    expect(html).toContain("Solo sin configurar");
    expect(html).toContain("ABC: todas");
  });
});
