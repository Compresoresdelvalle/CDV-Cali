import { describe, it, expect } from "vitest";
import { safeError } from "../../src/lib/utils";

/**
 * safeError decide qué ve el usuario de un error del servidor. Los mensajes de
 * regla de negocio (RAISE EXCEPTION, SQLSTATE P0001) ya vienen redactados para
 * el operario y deben pasar tal cual, aunque nombren palabras que otras reglas
 * usan para dar un genérico.
 */
describe("safeError", () => {
  it("un P0001 que dice 'entregada' pasa tal cual (no el genérico)", () => {
    const msg =
      "La OT vinculada ya está cerrada (entregada, anulada o abandonada): no admite abonos.";
    expect(safeError({ code: "P0001", message: msg })).toBe(msg);
  });

  it("sin P0001, la regla de 'entregada' sigue dando su texto", () => {
    expect(safeError({ message: "orden entregada" })).toBe(
      "No se puede modificar una orden entregada",
    );
  });

  it("los permisos siguen ganando a todo", () => {
    expect(
      safeError({ code: "42501", message: "permission denied for table x" }),
    ).toBe("No tienes permisos para esta acción");
  });

  it("sin error devuelve el texto de respaldo", () => {
    expect(safeError(null, "respaldo")).toBe("respaldo");
    expect(safeError({ message: "algo raro" }, "respaldo")).toBe("respaldo");
  });
});
