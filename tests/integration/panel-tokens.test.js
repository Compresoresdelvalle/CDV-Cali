import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Regla #1 del sistema de diseño: nunca hardcodear colores. Una librería de
 * gráficos o una barra de progreso es justo donde tienta romperla, así que
 * aquí se vuelve automático en vez de quedar en la revisión a ojo.
 */
describe("el panel no usa colores fijos", () => {
  const dir = "src/components/panel";
  const archivos = readdirSync(dir).filter((f) => f.endsWith(".jsx"));

  it("hay componentes que revisar (si no, la prueba pasaría por vacía)", () => {
    expect(archivos.length).toBeGreaterThan(5);
  });

  for (const f of archivos) {
    it(`${f} solo usa tokens`, () => {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src).not.toMatch(/className="[^"]*\bbg-(?!transparent)[a-z]+-\d/);
      expect(src).not.toMatch(
        /className="[^"]*\btext-(?:gray|red|green|blue|slate)-\d/,
      );
    });
  }
});
