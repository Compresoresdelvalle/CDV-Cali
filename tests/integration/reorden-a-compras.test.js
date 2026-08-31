/**
 * Reorden → Compras: la precarga del carrito.
 *
 * Cubre las dos trampas reales del traspaso, que no son hipotéticas:
 *  · la selección de Reorden es por producto Y sede (`producto_id-sede_id`),
 *    así que el mismo producto puede llegar dos veces y el carrito lo indexa
 *    por `producto_id`;
 *  · el destino tiene que salir de `vendible`, o los insumos entran como
 *    stock de venta y hay que convertirlos a mano después.
 */
import { describe, it, expect } from "vitest";
import {
  carritoDesdeReorden,
  sedesDeSugerencias,
} from "../../src/lib/compras-ui";

const sug = (over = {}) => ({
  producto_id: "p1",
  referencia: "FIL-1020",
  nombre: "Filtro 1020",
  sede_id: "CHV",
  cantidad_sugerida: 4,
  costo_unitario: 12000,
  vendible: true,
  ...over,
});

describe("carritoDesdeReorden", () => {
  it("consolida el mismo producto sugerido en dos sedes en UNA línea", () => {
    const carrito = carritoDesdeReorden([
      sug({ sede_id: "CHV", cantidad_sugerida: 4 }),
      sug({ sede_id: "CV", cantidad_sugerida: 6 }),
    ]);

    expect(carrito).toHaveLength(1);
    expect(carrito[0].producto_id).toBe("p1");
    expect(carrito[0].cantidad).toBe(10);
  });

  it("guarda de qué sedes salió cada cantidad consolidada", () => {
    // La migración copió el mín/máx global a las cuatro sedes, así que un
    // producto puede generar cuatro sugerencias y sumar mucho más que el techo
    // de una sede. El desglose evita que ese número aparezca sin explicación.
    const [linea] = carritoDesdeReorden([
      sug({ sede_id: "CHV", cantidad_sugerida: 15000 }),
      sug({ sede_id: "CV", cantidad_sugerida: 13555 }),
    ]);
    expect(linea.cantidad).toBe(28555);
    expect(linea.desglose).toEqual([
      { sede_id: "CHV", cantidad: 15000 },
      { sede_id: "CV", cantidad: 13555 },
    ]);
  });

  it("una sola sede deja un desglose de un elemento, y la interfaz no lo pinta", () => {
    const [linea] = carritoDesdeReorden([sug({ sede_id: "L3" })]);
    expect(linea.desglose).toHaveLength(1);
  });

  it("no consolida productos distintos", () => {
    const carrito = carritoDesdeReorden([
      sug({ producto_id: "p1" }),
      sug({ producto_id: "p2" }),
    ]);
    expect(carrito).toHaveLength(2);
  });

  it("manda los insumos con destino insumo, no venta", () => {
    const [linea] = carritoDesdeReorden([sug({ vendible: false })]);
    expect(linea.destino).toBe("insumo");
  });

  it("manda los vendibles con destino venta", () => {
    const [linea] = carritoDesdeReorden([sug({ vendible: true })]);
    expect(linea.destino).toBe("venta");
  });

  it("cae en venta si la vista no trajo `vendible`", () => {
    // Degradación segura: sin el dato se comporta como antes del cambio.
    const [linea] = carritoDesdeReorden([sug({ vendible: undefined })]);
    expect(linea.destino).toBe("venta");
  });

  it("nunca precarga el costo histórico al Vendedor", () => {
    const [linea] = carritoDesdeReorden([sug({ costo_unitario: 99000 })], {
      esVendedor: true,
    });
    expect(linea.costo_unitario).toBe(0);
  });

  it("sí precarga el costo a quien no es Vendedor", () => {
    const [linea] = carritoDesdeReorden([sug({ costo_unitario: 99000 })]);
    expect(linea.costo_unitario).toBe(99000);
  });

  it("levanta a 1 las cantidades sugeridas en cero o inválidas", () => {
    expect(
      carritoDesdeReorden([sug({ cantidad_sugerida: 0 })])[0].cantidad,
    ).toBe(1);
    expect(
      carritoDesdeReorden([sug({ cantidad_sugerida: null })])[0].cantidad,
    ).toBe(1);
    expect(
      carritoDesdeReorden([sug({ cantidad_sugerida: "x" })])[0].cantidad,
    ).toBe(1);
  });

  it("suma correctamente cuando una de las dos sedes viene inválida", () => {
    const carrito = carritoDesdeReorden([
      sug({ sede_id: "CHV", cantidad_sugerida: 5 }),
      sug({ sede_id: "CV", cantidad_sugerida: 0 }),
    ]);
    expect(carrito[0].cantidad).toBe(6); // 5 + el mínimo de 1
  });

  it("devuelve vacío sin sugerencias, sin reventar", () => {
    expect(carritoDesdeReorden(undefined)).toEqual([]);
    expect(carritoDesdeReorden(null)).toEqual([]);
    expect(carritoDesdeReorden([])).toEqual([]);
    expect(carritoDesdeReorden("no soy un arreglo")).toEqual([]);
  });

  it("descarta filas sin producto_id en vez de crear una línea rota", () => {
    const carrito = carritoDesdeReorden([sug(), { nombre: "basura" }]);
    expect(carrito).toHaveLength(1);
  });
});

describe("sedesDeSugerencias", () => {
  it("devuelve las sedes sin repetir", () => {
    expect(
      sedesDeSugerencias([
        sug({ sede_id: "CHV" }),
        sug({ sede_id: "CV" }),
        sug({ sede_id: "CHV" }),
      ]),
    ).toEqual(["CHV", "CV"]);
  });

  it("ignora sedes vacías y entradas inválidas", () => {
    expect(
      sedesDeSugerencias([sug({ sede_id: null }), sug({ sede_id: "L3" })]),
    ).toEqual(["L3"]);
    expect(sedesDeSugerencias(undefined)).toEqual([]);
  });
});
