/**
 * Min/max por sede: la regla de estado y quién puede configurar qué.
 *
 * Se replican aquí las dos reglas que deciden todo, porque son las que no
 * pueden equivocarse: si el estado se calcula mal, el inventario miente; si el
 * permiso se calcula mal, una vendedora apaga las alertas de otra sede.
 */
import { describe, it, expect } from "vitest";

/**
 * Espejo de `fn_actualizar_estado_stock`.
 * Existencias: para lo vendible cuenta `cantidad`; para lo no vendible, la suma
 * de los dos baldes (la chatarra vive en `cantidad` aunque no sea vendible).
 */
function estadoStock({ vendible, cantidad, cantidadInsumo, min, max }) {
  const exist = vendible ? cantidad : cantidad + cantidadInsumo;
  if (exist <= 0) return "Agotado";
  if (min > 0 && exist <= min) return "Bajo";
  if (max > 0 && exist > max) return "Sobrestock";
  return "OK";
}

/** Espejo de la comprobación de sede de `fn_definir_minmax`. */
function puedeConfigurar(rol, sedeUsuario, sedeObjetivo) {
  if (!["Admin", "Vendedor", "Bodeguero"].includes(rol)) return false;
  if (rol === "Admin") return true;
  return sedeUsuario === sedeObjetivo;
}

/** Una fila alerta sólo si tiene mínimo configurado. */
const alerta = (estado, min) => min > 0 && ["Bajo", "Agotado"].includes(estado);

const base = {
  vendible: true,
  cantidad: 10,
  cantidadInsumo: 0,
  min: 0,
  max: 0,
};

describe("estado de stock", () => {
  it("sin existencias es Agotado", () => {
    expect(estadoStock({ ...base, cantidad: 0 })).toBe("Agotado");
  });

  it("mínimo 0 no impide ver la verdad física", () => {
    // Ésta es la decisión clave: el estado sigue diciendo "Agotado" para que la
    // vendedora lo vea en el mostrador; lo que se apaga es la ALERTA.
    const e = estadoStock({ ...base, cantidad: 0, min: 0 });
    expect(e).toBe("Agotado");
    expect(alerta(e, 0)).toBe(false);
  });

  it("con mínimo configurado sí alerta", () => {
    const e = estadoStock({ ...base, cantidad: 0, min: 3 });
    expect(e).toBe("Agotado");
    expect(alerta(e, 3)).toBe(true);
  });

  it("la frontera del mínimo es inclusiva", () => {
    expect(estadoStock({ ...base, cantidad: 3, min: 3 })).toBe("Bajo");
    expect(estadoStock({ ...base, cantidad: 4, min: 3 })).toBe("OK");
  });

  it("máximo 0 significa sin techo", () => {
    expect(estadoStock({ ...base, cantidad: 9999, min: 2, max: 0 })).toBe("OK");
  });

  it("la frontera del máximo es estricta", () => {
    expect(estadoStock({ ...base, cantidad: 10, max: 10 })).toBe("OK");
    expect(estadoStock({ ...base, cantidad: 11, max: 10 })).toBe("Sobrestock");
  });

  it("un insumo con existencias deja de decir Agotado", () => {
    // Bug vivo que este cambio arregla: 28 filas decían "Agotado" teniendo
    // insumo disponible, porque sólo se miraba `cantidad`.
    expect(
      estadoStock({
        ...base,
        vendible: false,
        cantidad: 0,
        cantidadInsumo: 40,
        min: 5,
      }),
    ).toBe("OK");
  });

  it("la chatarra no pasa a Agotado teniendo la pieza", () => {
    // La chatarra es no vendible pero su unidad vive en `cantidad`. Mirar sólo
    // `cantidad_insumo` la habría marcado Agotado: una regresión.
    expect(
      estadoStock({
        ...base,
        vendible: false,
        cantidad: 1,
        cantidadInsumo: 0,
        min: 0,
      }),
    ).toBe("OK");
  });

  it("un insumo realmente agotado sigue alertando", () => {
    const e = estadoStock({
      ...base,
      vendible: false,
      cantidad: 0,
      cantidadInsumo: 0,
      min: 5,
    });
    expect(e).toBe("Agotado");
    expect(alerta(e, 5)).toBe(true);
  });

  it("un vendible con existencias sólo como insumo está agotado para vender", () => {
    expect(
      estadoStock({ ...base, vendible: true, cantidad: 0, cantidadInsumo: 50 }),
    ).toBe("Agotado");
  });
});

describe("quién puede configurar el mínimo de una sede", () => {
  it("Admin puede en todas", () => {
    for (const s of ["BODEGA", "CHV", "CV", "L3"]) {
      expect(puedeConfigurar("Admin", "BODEGA", s)).toBe(true);
    }
  });

  it("la vendedora sólo en la suya", () => {
    expect(puedeConfigurar("Vendedor", "CHV", "CHV")).toBe(true);
    expect(puedeConfigurar("Vendedor", "CHV", "CV")).toBe(false);
  });

  it("el bodeguero sólo en BODEGA", () => {
    expect(puedeConfigurar("Bodeguero", "BODEGA", "BODEGA")).toBe(true);
    expect(puedeConfigurar("Bodeguero", "BODEGA", "L3")).toBe(false);
  });

  it("el técnico no puede en ninguna", () => {
    expect(puedeConfigurar("Técnico", "BODEGA", "BODEGA")).toBe(false);
  });

  it("un rol desconocido no puede", () => {
    expect(puedeConfigurar(undefined, "CHV", "CHV")).toBe(false);
  });
});

describe("validación de mínimo y máximo", () => {
  // ESTRICTO: con max = min no existe ninguna cantidad que deje el producto en
  // "OK" (queda en Bajo o en Sobrestock), y Reorden lo excluye porque no hay
  // nada que pedir. Es la regla que ya tenía `productos` desde julio.
  const valido = (min, max) =>
    min >= 0 && max >= 0 && (max === 0 || max > min);

  it("acepta mínimo 0 (no controlar) y máximo 0 (sin techo)", () => {
    expect(valido(0, 0)).toBe(true);
    expect(valido(5, 0)).toBe(true);
  });

  it("rechaza el máximo por debajo del mínimo", () => {
    expect(valido(10, 3)).toBe(false);
  });

  it("con máximo igual al mínimo no hay cantidad que dé OK", () => {
    // La razón de fondo de que la regla sea estricta.
    const conMinMax = (cantidad) =>
      estadoStock({ ...base, cantidad, min: 10, max: 10 });
    expect(conMinMax(9)).toBe("Bajo");
    expect(conMinMax(10)).toBe("Bajo");
    expect(conMinMax(11)).toBe("Sobrestock");
  });

  it("rechaza el máximo IGUAL al mínimo, que sería una alerta sin salida", () => {
    expect(valido(5, 5)).toBe(false);
  });

  it("acepta el máximo una unidad por encima del mínimo", () => {
    expect(valido(5, 6)).toBe(true);
  });

  it("rechaza negativos", () => {
    expect(valido(-1, 0)).toBe(false);
    expect(valido(0, -1)).toBe(false);
  });
});
