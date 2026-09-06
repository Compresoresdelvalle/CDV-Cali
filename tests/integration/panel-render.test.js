import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import BarraRango from "../../src/components/panel/BarraRango";

vi.mock("../../src/lib/supabase", () => {
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    then: (r) => Promise.resolve({ data: [], error: null }).then(r),
  };
  return {
    supabase: {
      from: () => q,
      rpc: () => Promise.resolve({ data: null, error: null }),
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

/**
 * Prueba de humo del panel.
 *
 * Ni el build ni eslint ejecutan un componente: un error de render pasa las dos
 * y llega a producción con la pantalla inservible. Ya ocurrió dos veces en este
 * proyecto. `renderToStaticMarkup` sí corre el cuerpo y sus hooks.
 *
 * No comprueba cómo se ve nada: responde si abre y si dice lo que debe decir.
 */

const montar = (props) =>
  renderToStaticMarkup(
    createElement(BarraRango, {
      rango: { desde: "2026-09-01", hasta: "2026-09-15" },
      atajo: "mes",
      onCambio() {},
      sede: "",
      sedes: [{ id: "CV", nombre: "Cali Valle" }],
      onSede() {},
      actualizado: new Date("2026-09-15T10:00:00Z"),
      cargando: false,
      onRefrescar() {},
      ...props,
    }),
  );

describe("BarraRango", () => {
  it("monta sin reventar", () => {
    expect(() => montar()).not.toThrow();
  });

  it("dice el rango en español, no solo las fechas", () => {
    // Es la frase que quita el tener que adivinar qué periodo está aplicado.
    expect(montar()).toContain("Del 1 al 15 de septiembre de 2026");
  });

  it("dice contra qué se compara", () => {
    expect(montar()).toContain("comparando contra");
  });

  it("avisa cuando no hay con qué comparar, en vez de callarse", () => {
    // Junio es el primer mes con datos: no hay mayo contra el cual comparar, y
    // pintar un −100% sería mentir.
    const html = montar({
      rango: { desde: "2026-06-01", hasta: "2026-06-30" },
      atajo: "mes_pasado",
    });
    expect(html).toContain("sin datos para comparar");
    expect(html).not.toContain("comparando contra");
  });

  it("trae los ocho atajos", () => {
    const html = montar();
    for (const t of [
      "Hoy",
      "Ayer",
      "Esta semana",
      "Este mes",
      "Mes pasado",
      "Este año",
      "Últimos 30",
      "Últimos 90",
    ]) {
      expect(html).toContain(t);
    }
  });

  it("muestra hace cuánto se actualizó", () => {
    // El botón del panel viejo parecía roto porque no daba ninguna señal.
    expect(montar()).toContain("Actualizado");
  });

  it("mientras carga lo dice y no deja pulsar de nuevo", () => {
    const html = montar({ cargando: true });
    expect(html).toContain("disabled");
    expect(html).toContain("Actualizando");
  });

  it("aguanta que no haya sedes ni fecha de actualización", () => {
    expect(() => montar({ sedes: [], actualizado: null })).not.toThrow();
  });
});

describe("Panel", () => {
  const montar = async () => {
    const Panel = (await import("../../src/pages/admin/Panel")).default;
    return renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(Panel)),
    );
  };

  it("monta como Admin", async () => {
    perfilActual = { rol: "Admin", sede_id: "BODEGA", nombre: "Admin Maritza" };
    await expect(montar()).resolves.toBeTruthy();
  });

  it("el rango manda desde el primer render", async () => {
    perfilActual = { rol: "Admin", sede_id: "BODEGA", nombre: "Admin Maritza" };
    const html = await montar();
    // La barra tiene que estar montada con su frase, no un placeholder.
    expect(html).toContain("Actualizado");
    expect(html).toContain("Este mes");
  });

  it("a una vendedora le explica por que no ve el margen, no le da error", async () => {
    // Un error de permisos parece una falla; una explicacion no.
    perfilActual = { rol: "Vendedor", sede_id: "CV", nombre: "Deyanira" };
    const html = await montar();
    expect(html).toContain("información de administración");
    expect(html).not.toContain("Reintentar");
  });
});

describe("Seccion", () => {
  const montar = async (props) => {
    const S = (await import("../../src/components/panel/Seccion")).default;
    return renderToStaticMarkup(createElement(S, { titulo: "Prueba", ...props }));
  };

  it("cargando pinta un esqueleto con la forma del contenido", async () => {
    const html = await montar({ cargando: true, filasEsqueleto: 3 });
    expect(html).toContain('aria-busy="true"');
    expect((html.match(/animate-pulse/g) ?? []).length).toBe(3);
  });

  it("vacio explica, no deja la tarjeta en blanco", async () => {
    const html = await montar({
      vacio: true,
      mensajeVacio: "Ningún producto se vendió bajo costo.",
    });
    expect(html).toContain("Ningún producto se vendió bajo costo.");
  });

  it("el error se queda dentro de la seccion y ofrece reintentar solo esa", async () => {
    const html = await montar({ error: "No se pudo cargar", onReintentar() {} });
    expect(html).toContain("No se pudo cargar");
    expect(html).toContain("Reintentar esta sección");
  });

  it("sin permiso explica en vez de parecer una falla", async () => {
    const html = await montar({ sinPermiso: true });
    expect(html).toContain("información de administración");
    expect(html).not.toContain("Reintentar");
  });
});
