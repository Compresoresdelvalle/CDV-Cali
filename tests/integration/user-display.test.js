import { describe, expect, it } from "vitest";
import { usuarioDisplayName } from "../../src/lib/user-display";

describe("usuarioDisplayName", () => {
  it("muestra el nombre real del Admin (ya no lo enmascara)", () => {
    expect(usuarioDisplayName({ nombre: "Admin Maritza", rol: "Admin" })).toBe(
      "Admin Maritza",
    );
  });

  it("conserva el nombre de usuarios que no son Admin", () => {
    expect(usuarioDisplayName({ nombre: "Sofia", rol: "Vendedor" })).toBe(
      "Sofia",
    );
  });

  it("recorta espacios y devuelve cadena vacía si no hay nombre", () => {
    expect(usuarioDisplayName({ nombre: "  Edna  ", rol: "Vendedor" })).toBe(
      "Edna",
    );
    expect(usuarioDisplayName({ rol: "Admin" })).toBe("");
    expect(usuarioDisplayName(null)).toBe("");
  });
});
