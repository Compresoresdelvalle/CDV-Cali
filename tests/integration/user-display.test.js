import { describe, expect, it } from "vitest";
import { usuarioDisplayName } from "../../src/lib/user-display";

describe("usuarioDisplayName", () => {
  it("muestra Admin para usuarios con rol Admin", () => {
    expect(usuarioDisplayName({ nombre: "Carlos Dueño", rol: "Admin" })).toBe(
      "Admin",
    );
    expect(usuarioDisplayName({ nombre: "Admin", rol: "Admin" })).toBe(
      "Admin",
    );
  });

  it("conserva el nombre de usuarios que no son Admin", () => {
    expect(usuarioDisplayName({ nombre: "Sofia", rol: "Vendedor" })).toBe(
      "Sofia",
    );
  });
});
