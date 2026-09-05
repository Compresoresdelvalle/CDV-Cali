import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";

/**
 * Prueba de humo de la pantalla de Mínimos y máximos.
 *
 * Existe por el mismo motivo que la del modal de cambio: `npm run build`,
 * `eslint` y los tests de lógica pasan en verde con un error que revienta el
 * componente en cada render, porque ninguno lo ejecuta. Ya pasó una vez y dejó
 * una pantalla inservible.
 *
 * `renderToStaticMarkup` sí corre el cuerpo del componente y sus hooks de
 * estado. No verifica cómo se ve nada: responde una sola pregunta, ¿abre?
 *
 * Se mockean Supabase y el store de sesión porque el import de ambos exige
 * variables de entorno y una sesión real que no existen en los tests.
 */

vi.mock("../../src/lib/supabase", () => {
  const q = {
    select: () => q,
    eq: () => q,
    gt: () => q,
    in: () => q,
    or: () => q,
    order: () => q,
    range: () => Promise.resolve({ data: [], error: null, count: 0 }),
    then: (r) => Promise.resolve({ data: [], error: null }).then(r),
  };
  return {
    supabase: {
      from: () => q,
      rpc: () => Promise.resolve({ data: [], error: null }),
    },
  };
});

const hacerStore = (perfil) => {
  const usar = (sel) =>
    typeof sel === "function" ? sel({ perfil }) : { perfil };
  usar.getState = () => ({ perfil });
  usar.setState = () => {};
  usar.subscribe = () => () => {};
  return usar;
};

let perfilActual = { rol: "Admin", sede_id: "BODEGA", nombre: "Admin Maritza" };
vi.mock("../../src/stores/authStore", () => ({
  get useAuthStore() {
    return hacerStore(perfilActual);
  },
}));

const Minimos = (await import("../../src/pages/ops/Minimos")).default;

const montar = () =>
  renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(Minimos)),
  );

describe("Mínimos y máximos — no revienta al abrirse", () => {
  it("como Admin, que puede elegir cualquier sede", () => {
    perfilActual = { rol: "Admin", sede_id: "BODEGA", nombre: "Admin Maritza" };
    expect(() => montar()).not.toThrow();
  });

  it("como vendedora, que queda fijada a su sede", () => {
    perfilActual = { rol: "Vendedor", sede_id: "CV", nombre: "Deyanira" };
    expect(() => montar()).not.toThrow();
  });

  it("como bodeguero", () => {
    perfilActual = { rol: "Bodeguero", sede_id: "BODEGA", nombre: "Bodega" };
    expect(() => montar()).not.toThrow();
  });

  it("con un perfil sin sede asignada (caso raro pero real)", () => {
    perfilActual = { rol: "Vendedor", sede_id: null, nombre: "Sin sede" };
    expect(() => montar()).not.toThrow();
  });

  it("pinta los cuatro filtros de configuración y las cuatro clases ABC", () => {
    perfilActual = { rol: "Admin", sede_id: "BODEGA", nombre: "Admin Maritza" };
    const html = montar();
    for (const t of ["Todos", "Sin configurar", "Configurados", "En alerta"]) {
      expect(html).toContain(t);
    }
    // El filtro ABC: la etiqueta de "todas" y las tres clases sueltas.
    expect(html).toContain("ABC: todas");
    expect(html).toContain(">A<");
    expect(html).toContain(">B<");
    expect(html).toContain(">C<");
  });
});
