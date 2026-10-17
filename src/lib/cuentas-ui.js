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

/* ── Fecha real del pago o cobro (Bloque 3.3) ─────────────────────────────
 * fn_registrar_pago_cuenta acepta una `fecha` 'YYYY-MM-DD': no futura y como
 * mucho 30 días atrás, contados en hora de Colombia. Sin fecha = ahora. Estas
 * funciones espejan esa regla para que la pantalla no ofrezca un día que el
 * servidor va a rechazar. */

/** Días hacia atrás que acepta el servidor. */
export const DIAS_ATRAS_PAGO = 30;

/** Hoy en Colombia, 'YYYY-MM-DD' (en-CA da el formato ISO). */
export function hoyBogota(ahora = new Date()) {
  return ahora.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

/** Resta días a un 'YYYY-MM-DD' sin pasar por la zona horaria del equipo. */
export function restarDias(dia, n) {
  const [y, m, d] = String(dia).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

/** min/max del input date. */
export function rangoFechaPago(hoy) {
  return { min: restarDias(hoy, DIAS_ATRAS_PAGO), max: hoy };
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY', como lo dice el servidor en sus mensajes. */
export function diaLegible(dia) {
  const [y, m, d] = String(dia ?? "").split("-");
  return y && m && d ? `${d}/${m}/${y}` : String(dia ?? "");
}

/**
 * Valida la fecha elegida igual que el servidor.
 * @returns {string|null} mensaje con la salida, o null si sirve.
 */
export function validarFechaPago(dia, hoy, esCobro = false) {
  const que = esCobro ? "cobro" : "pago";
  if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    return `Elige la fecha del ${que} en el calendario.`;
  }
  if (dia > hoy) {
    return `La fecha del ${que} no puede ser futura. Si la plata todavía no ha ${
      esCobro ? "entrado" : "salido"
    }, regístralo el día que pase.`;
  }
  const { min } = rangoFechaPago(hoy);
  if (dia < min) {
    return `Solo se pueden registrar ${que}s de hasta ${DIAS_ATRAS_PAGO} días atrás (desde el ${diaLegible(
      min,
    )}). Para algo más viejo habla con el administrador.`;
  }
  return null;
}

/** La fecha va en el payload solo si no es hoy (sin fecha = ahora). */
export function fechaParaPayload(dia, hoy) {
  return dia && dia !== hoy ? dia : undefined;
}

/**
 * Periodo del cierre que ya cubre el día del pago (fn_dia_tiene_cierre trae
 * `fecha_desde` y `fecha_hasta`). El complementario se genera con ESE mismo
 * rango: si el cierre era de varios días, poner solo el día no sirve.
 * @returns {{ varios: boolean, desde: string, hasta: string }}
 */
export function periodoCierre(cierre, dia) {
  const desde = cierre?.fecha_desde || dia;
  const hasta = cierre?.fecha_hasta || dia;
  return { varios: desde !== hasta, desde, hasta };
}

/**
 * ¿De qué caja sale el pago a proveedor? Espeja fn_registrar_pago_cuenta: el
 * Admin la escoge (por defecto la sede de la compra); cualquier otro rol paga
 * de su propia sede.
 */
export function sedeCajaPago({ esAdmin, elegida, sedeCompra, sedeUsuario }) {
  if (esAdmin) return elegida || sedeCompra || null;
  return sedeUsuario || null;
}
