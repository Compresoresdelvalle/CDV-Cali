/**
 * Helpers de presentación del módulo Cuentas por cobrar / por pagar (B10).
 *
 * CxC = ventas a crédito (`metodo_pago='Crédito'`), CxP = compras a crédito.
 * El saldo de una CxC ya viene neto de los abonos de cotización vinculados
 * (vista `v_cuentas_por_cobrar`). Solo presentación: sin lógica de datos.
 */

/** Métodos con los que se recibe un cobro o se hace un pago (NO incluye Crédito). */
export const METODOS_PAGO_CUENTA = ["Efectivo", "Transferencia", "Tarjeta"];

/** Métodos electrónicos que exigen indicar la cuenta bancaria. */
export const METODOS_ELECTRONICOS = ["Transferencia", "Tarjeta"];

/** Etiqueta legible por sede (IDs TEXT reales). */
export const SEDE_LABELS_CUENTAS = {
  BODEGA: "Bodega Principal",
  CV: "Almacén CV",
  L3: "Almacén L3",
  CHV: "Almacén CHV",
};

/** ID de sede → etiqueta legible (fallback al ID). */
export const sedeLabelCuenta = (id) => SEDE_LABELS_CUENTAS[id] ?? id ?? "—";

/**
 * Etiqueta de una cuenta bancaria con el MISMO formato que guarda CompraNueva,
 * para que el texto en `pagos_cuenta.cuenta_bancaria` sea consistente.
 * @param {{ banco: string, tipo: string, numero: string, titular?: string|null }} c
 */
export const cuentaBancariaLabel = (c) =>
  `${c.banco} ${c.tipo} ${c.numero}${c.titular ? " · " + c.titular : ""}`;

/**
 * Estado de una cuenta según su saldo pendiente vs el total del documento.
 * @returns {{ label: string, token: string }} token = variable CSS de color.
 */
export function estadoCuenta(saldo, total) {
  const s = Number(saldo ?? 0);
  const t = Number(total ?? 0);
  if (s <= 0.01) return { label: "Saldada", token: "--success" };
  if (s < t - 0.01) return { label: "Parcial", token: "--warning" };
  return { label: "Pendiente", token: "--destructive" };
}
