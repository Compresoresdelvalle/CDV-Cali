import { describe, it, expect } from "vitest";
import { calcularMontos } from "../../src/lib/ot-flujo";

/**
 * El saldo de la OT con retenciones.
 *
 * La OT se mide contra lo COBRABLE, no contra el total facturado. Si se midiera
 * contra el total, una OT con retención nunca se podría entregar: el cliente
 * abona el neto y las compuertas del servidor la darían por impaga para siempre.
 */
describe("calcularMontos con retenciones", () => {
  const ot = {
    costo_mano_obra: 900000,
    valor_revision: 100000,
    valor_repuestos: 0,
    descuento_valor: 0,
    iva_pct: 19,
    estado_autorizacion: "autorizado",
  };

  it("sin retencion se comporta exactamente como antes", () => {
    const m = calcularMontos(ot, null, []);
    expect(m.total).toBe(1190000);
    expect(m.retenciones).toBe(0);
    expect(m.cobrable).toBe(1190000);
    expect(m.saldo).toBe(1190000);
  });

  it("el saldo se mide contra lo cobrable, no contra el total", () => {
    const m = calcularMontos({ ...ot, retefuente_pct: 4 }, null, []);
    expect(m.total).toBe(1190000);
    expect(m.retenciones).toBe(40000);
    expect(m.cobrable).toBe(1150000);
    expect(m.saldo).toBe(1150000);
  });

  it("al abonar el neto el saldo cierra en cero", () => {
    const m = calcularMontos({ ...ot, retefuente_pct: 4 }, null, [
      { monto: 1150000 },
    ]);
    expect(m.saldo).toBe(0);
  });

  it("la OT no autorizada retiene solo sobre la revision", () => {
    const m = calcularMontos(
      { ...ot, estado_autorizacion: "no_autorizado", retefuente_pct: 4 },
      null,
      [],
    );
    expect(m.total).toBe(119000);
    expect(m.retenciones).toBe(4000);
    expect(m.cobrable).toBe(115000);
  });

  it("reteIVA va sobre el IVA de la OT, no sobre la base", () => {
    const m = calcularMontos({ ...ot, reteiva_pct: 15 }, null, []);
    expect(m.retenciones).toBe(28500);
    expect(m.cobrable).toBe(1161500);
  });

  it("coincide con lo que devolvio fn_generar_venta_ot en produccion", () => {
    // Caso verificado contra produccion: la RPC respondio cobrable 1.150.000
    // y retenciones 40.000 sobre un total de 1.190.000.
    const m = calcularMontos({ ...ot, retefuente_pct: 4 }, null, []);
    expect(m.cobrable).toBe(1150000);
    expect(m.retenciones).toBe(40000);
  });
});
