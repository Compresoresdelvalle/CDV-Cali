/**
 * Pagos al registrar una compra (Bloque 3.1).
 *
 * Una compra a Crédito puede llevar pagos hechos el mismo día: así se paga una
 * compra en dos formas (parte en efectivo, parte por transferencia) o se deja
 * un anticipo. Cada pago queda en `pagos_cuenta`, que es lo que el cierre y
 * Cuentas por Pagar ya saben contar.
 *
 * Funciones puras, sin React ni Supabase, para poder probarlas. Las reglas son
 * las mismas que aplica `fn_registrar_compra`: si la pantalla y el servidor no
 * coinciden, la vendedora ve un "todo bien" que después el servidor rechaza.
 */

/** Formas en que se puede pagar una parte (Crédito no: eso es lo que se debe). */
export const METODOS_PAGO_PARTE = ["Efectivo", "Transferencia", "Tarjeta"];

const ELECTRONICOS = ["Transferencia", "Tarjeta"];

const num = (v) => {
  const n = Number(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Renglón vacío para el formulario. `key` solo sirve para React. */
export function nuevoPagoParte(key) {
  return { key, metodo_pago: "Efectivo", cuenta_bancaria: "", monto: "" };
}

/**
 * Neto a pagar al proveedor (total − retenciones) con el MISMO redondeo de
 * `fn_registrar_compra`: IVA redondeado, total redondeado y cada retención
 * redondeada por separado. Es contra este número que el servidor compara la
 * suma de los pagos.
 */
export function netoAPagarCompra({
  subtotal = 0,
  descuento = 0,
  ivaPct = 0,
  retefuentePct = 0,
  reteicaPct = 0,
  reteivaPct = 0,
} = {}) {
  const sub = Math.max(0, Number(subtotal) || 0);
  const desc = Math.min(Math.max(0, Number(descuento) || 0), sub);
  const base = sub - desc;
  const iva = Math.round((base * (Number(ivaPct) || 0)) / 100);
  const total = Math.round(base + iva);
  const ret =
    Math.round((base * (Number(retefuentePct) || 0)) / 100) +
    Math.round((base * (Number(reteicaPct) || 0)) / 100) +
    Math.round((iva * (Number(reteivaPct) || 0)) / 100);
  return { total, retenciones: ret, neto: total - ret };
}

/**
 * Neto, pagado hoy y lo que queda debiendo.
 * @param {{ neto: number, pagos: Array<{monto: string|number}> }} p
 */
export function resumenPagosCompra({ neto = 0, pagos = [] } = {}) {
  const lista = Array.isArray(pagos) ? pagos : [];
  const pagado = lista.reduce((s, p) => s + num(p.monto), 0);
  const n = Number(neto) || 0;
  const conMonto = lista.filter((p) => num(p.monto) > 0).length;
  return {
    neto: n,
    pagado,
    saldo: Math.max(0, n - pagado),
    nPagos: conMonto,
    completa: conMonto > 0 && Math.abs(n - pagado) <= 0.01,
    excedido: pagado > n + 0.01,
  };
}

/**
 * Valida los renglones igual que el servidor. Devuelve el mensaje para la
 * pantalla (qué pasa y qué hacer) o null si todo está bien.
 * Sin renglones es válido: la compra queda a crédito completa.
 */
export function validarPagosCompra({ neto = 0, pagos = [] } = {}) {
  const lista = Array.isArray(pagos) ? pagos : [];
  for (let i = 0; i < lista.length; i++) {
    const p = lista[i];
    const cual = lista.length > 1 ? `El pago ${i + 1}` : "El pago";
    if (!(num(p.monto) > 0)) {
      return `${cual} no tiene monto. Escríbelo o quita ese renglón con la X.`;
    }
    if (!METODOS_PAGO_PARTE.includes(p.metodo_pago)) {
      return `${cual} tiene que ser en Efectivo, Transferencia o Tarjeta.`;
    }
    if (ELECTRONICOS.includes(p.metodo_pago) && !p.cuenta_bancaria) {
      return `${cual} es por ${p.metodo_pago}: elige la cuenta bancaria de donde salió la plata.`;
    }
  }
  const r = resumenPagosCompra({ neto, pagos: lista });
  if (r.excedido) {
    return `Los pagos suman ${fmt(r.pagado)} y a esta compra solo se le deben ${fmt(r.neto)}. Baja algún monto: lo que se pagó de más no es un pago de esta compra.`;
  }
  return null;
}

/**
 * Lista para `p_pagos` de la RPC, o null si no hay pagos (así la compra se
 * registra igual que antes de esta función).
 */
export function pagosParaRpc(pagos) {
  const lista = Array.isArray(pagos) ? pagos : [];
  if (lista.length === 0) return null;
  return lista.map((p) => ({
    metodo_pago: p.metodo_pago,
    cuenta_bancaria: ELECTRONICOS.includes(p.metodo_pago)
      ? p.cuenta_bancaria || null
      : null,
    monto: num(p.monto),
  }));
}

/**
 * Frase del resultado, para que quede claro qué va a pasar al guardar.
 * @returns {string}
 */
export function fraseResultadoPagos({ nPagos, completa, saldo }) {
  if (nPagos === 0) {
    return "No pagaste nada hoy: toda la compra queda por pagar.";
  }
  if (completa) {
    return nPagos === 1
      ? "Queda pagada completa, en un solo pago."
      : `Queda pagada completa, en ${nPagos} partes.`;
  }
  return `Queda debiendo ${fmt(saldo)} al proveedor.`;
}

function fmt(v) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(v) || 0);
}
