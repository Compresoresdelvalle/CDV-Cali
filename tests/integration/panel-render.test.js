import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import BarraRango from "../../src/components/panel/BarraRango";

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
