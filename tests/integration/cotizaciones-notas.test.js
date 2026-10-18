import { describe, it, expect } from "vitest";
import { descomponerObservaciones } from "../../src/lib/cotizaciones-ui";

/**
 * Notas adicionales de la cotización: lo que queda de `observaciones` tras
 * separar contacto y dirección. Los saltos de párrafo que escribió el vendedor
 * se conservan (antes las líneas en blanco se botaban y en el PDF todo salía
 * pegado).
 */
describe("descomponerObservaciones · notas", () => {
  it("separa contacto y dirección y deja el resto como notas", () => {
    const r = descomponerObservaciones(
      "Contacto: Ana · Compras\nDirección: Cra 1 # 2-3\nEntregar en portería",
    );
    expect(r.contacto).toBe("Ana");
    expect(r.cargo).toBe("Compras");
    expect(r.direccion).toBe("Cra 1 # 2-3");
    expect(r.notas).toBe("Entregar en portería");
  });

  it("conserva el salto de párrafo entre notas", () => {
    const r = descomponerObservaciones(
      "Contacto: Ana\nPrimer párrafo.\n\nSegundo párrafo.",
    );
    expect(r.notas).toBe("Primer párrafo.\n\nSegundo párrafo.");
  });

  it("varios renglones vacíos seguidos quedan en uno, sin blancos en los bordes", () => {
    const r = descomponerObservaciones("\n\nUno\n\n\n\nDos\n\n");
    expect(r.notas).toBe("Uno\n\nDos");
  });

  it("solo contacto: sin notas", () => {
    expect(descomponerObservaciones("Contacto: Ana\n\n").notas).toBeNull();
    expect(descomponerObservaciones("").notas).toBeNull();
  });
});
