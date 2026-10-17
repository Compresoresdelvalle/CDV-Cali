import { describe, it, expect } from "vitest";
import {
  netoAPagarCompra,
  resumenPagosCompra,
  validarPagosCompra,
  pagosParaRpc,
  fraseResultadoPagos,
} from "../../src/lib/pagos-compra";
import { calcularRetenciones } from "../../src/lib/retenciones";

/**
 * Pagos al registrar una compra a Crédito (Bloque 3.1).
 *
 * Las reglas tienen que ser las de fn_registrar_compra: si la pantalla dice
 * "todo bien" y el servidor rechaza, la vendedora queda en el celular con un
 * error que no entiende.
 */
const ef = (monto) => ({ metodo_pago: "Efectivo", cuenta_bancaria: "", monto });
const tr = (monto, cuenta = "Bancolombia Ahorros 123") => ({
  metodo_pago: "Transferencia",
  cuenta_bancaria: cuenta,
  monto,
});

describe("netoAPagarCompra", () => {
  it("sin retenciones el neto es el total con IVA redondeado", () => {
    const r = netoAPagarCompra({ subtotal: 100003, ivaPct: 19 });
    // IVA 19.000,57 → 19.001; total 119.004 (así lo calcula el servidor).
    expect(r.total).toBe(119004);
    expect(r.retenciones).toBe(0);
    expect(r.neto).toBe(119004);
  });

  it("resta descuento antes del IVA y las retenciones al final", () => {
    const r = netoAPagarCompra({
      subtotal: 1100000,
      descuento: 100000,
      ivaPct: 19,
      retefuentePct: 2.5,
      reteicaPct: 0.69,
      reteivaPct: 15,
    });
    expect(r.total).toBe(1190000);
    expect(r.retenciones).toBe(60400);
    expect(r.neto).toBe(1129600);
  });

  it("coincide con calcularRetenciones (lo que muestra el resumen) en pesos enteros", () => {
    const casos = [
      [250000, 0, 19, 2.5, 0, 0],
      [987654, 12345, 19, 3.5, 1.1, 15],
      [5000, 0, 0, 0, 0, 0],
    ];
    for (const [sub, desc, ivaPct, rf, ri, riva] of casos) {
      const base = sub - desc;
      const iva = base * (ivaPct / 100);
      const pantalla = calcularRetenciones({
        base,
        iva,
        total: base + iva,
        retefuentePct: rf,
        reteicaPct: ri,
        reteivaPct: riva,
      });
      const servidor = netoAPagarCompra({
        subtotal: sub,
        descuento: desc,
        ivaPct,
        retefuentePct: rf,
        reteicaPct: ri,
        reteivaPct: riva,
      });
      expect(servidor.neto).toBe(pantalla.neto);
    }
  });

  it("el descuento no puede pasar del subtotal", () => {
    expect(netoAPagarCompra({ subtotal: 1000, descuento: 5000 }).neto).toBe(0);
  });
});

describe("resumenPagosCompra", () => {
  it("sin pagos queda debiendo todo", () => {
    const r = resumenPagosCompra({ neto: 100000, pagos: [] });
    expect(r).toMatchObject({
      pagado: 0,
      saldo: 100000,
      nPagos: 0,
      completa: false,
      excedido: false,
    });
  });

  it("pago en dos formas que cubre todo queda completa", () => {
    const r = resumenPagosCompra({
      neto: 100000,
      pagos: [ef("60000"), tr("40000")],
    });
    expect(r.pagado).toBe(100000);
    expect(r.saldo).toBe(0);
    expect(r.nPagos).toBe(2);
    expect(r.completa).toBe(true);
  });

  it("un anticipo deja el resto como saldo", () => {
    const r = resumenPagosCompra({ neto: 100000, pagos: [ef("30000")] });
    expect(r.saldo).toBe(70000);
    expect(r.completa).toBe(false);
  });

  it("marca excedido cuando los pagos pasan del neto", () => {
    const r = resumenPagosCompra({ neto: 100000, pagos: [ef("100001")] });
    expect(r.excedido).toBe(true);
    expect(r.saldo).toBe(0);
  });

  it("no cuenta renglones vacíos como pagos", () => {
    const r = resumenPagosCompra({ neto: 100000, pagos: [ef(""), ef("10")] });
    expect(r.nPagos).toBe(1);
  });
});

describe("validarPagosCompra", () => {
  it("sin renglones es válido (crédito completo)", () => {
    expect(validarPagosCompra({ neto: 100000, pagos: [] })).toBeNull();
  });

  it("acepta pagos que suman exactamente el neto", () => {
    expect(
      validarPagosCompra({ neto: 100000, pagos: [ef("60000"), tr("40000")] }),
    ).toBeNull();
  });

  it("rechaza un renglón sin monto y dice cuál y qué hacer", () => {
    const msg = validarPagosCompra({
      neto: 100000,
      pagos: [ef("1000"), ef("")],
    });
    expect(msg).toMatch(/pago 2/);
    expect(msg).toMatch(/quita ese renglón/);
  });

  it("exige la cuenta en transferencia o tarjeta", () => {
    const msg = validarPagosCompra({ neto: 100000, pagos: [tr("1000", "")] });
    expect(msg).toMatch(/cuenta bancaria/);
  });

  it("rechaza Crédito como forma de un pago", () => {
    const msg = validarPagosCompra({
      neto: 100000,
      pagos: [{ metodo_pago: "Crédito", cuenta_bancaria: "", monto: "10" }],
    });
    expect(msg).toMatch(/Efectivo, Transferencia o Tarjeta/);
  });

  it("rechaza si la suma pasa del neto", () => {
    const msg = validarPagosCompra({
      neto: 100000,
      pagos: [ef("60000"), tr("50000")],
    });
    expect(msg).toMatch(/solo se le deben/);
  });
});

describe("pagosParaRpc", () => {
  it("devuelve null sin pagos, para registrar la compra como antes", () => {
    expect(pagosParaRpc([])).toBeNull();
    expect(pagosParaRpc(undefined)).toBeNull();
  });

  it("manda montos numéricos y quita la cuenta del efectivo", () => {
    expect(
      pagosParaRpc([
        { ...ef("60000"), cuenta_bancaria: "sobra", key: 1 },
        { ...tr("40000"), key: 2 },
      ]),
    ).toEqual([
      { metodo_pago: "Efectivo", cuenta_bancaria: null, monto: 60000 },
      {
        metodo_pago: "Transferencia",
        cuenta_bancaria: "Bancolombia Ahorros 123",
        monto: 40000,
      },
    ]);
  });
});

describe("fraseResultadoPagos", () => {
  it("dice en cuántas partes quedó pagada", () => {
    expect(fraseResultadoPagos({ nPagos: 2, completa: true, saldo: 0 })).toBe(
      "Queda pagada completa, en 2 partes.",
    );
    expect(fraseResultadoPagos({ nPagos: 1, completa: true, saldo: 0 })).toBe(
      "Queda pagada completa, en un solo pago.",
    );
  });

  it("dice cuánto queda debiendo", () => {
    expect(
      fraseResultadoPagos({ nPagos: 1, completa: false, saldo: 70000 }),
    ).toMatch(/Queda debiendo \$\s?70\.000/);
  });

  it("sin pagos avisa que toda la compra queda por pagar", () => {
    expect(fraseResultadoPagos({ nPagos: 0 })).toMatch(/toda la compra/);
  });
});
