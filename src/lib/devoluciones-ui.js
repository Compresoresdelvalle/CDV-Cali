/**
 * Helpers de presentación del módulo Devoluciones (diseño Lovable).
 *
 * Convierte valores REALES de la base de datos a las clases del sistema
 * de diseño portado (`.s-pill`). NO contiene lógica de datos ni fetching —
 * solo presentación.
 *
 * Modelo real (tabla `devoluciones`): `reingresa_stock` BOOLEAN
 * (true = devolución de cliente, suma stock; false = a proveedor, resta) y
 * `estado` enum `estado_devolucion` ('pendiente' | 'aprobada' | 'rechazada'
 * | 'procesada'). No existen columnas de valor, cliente, teléfono ni
 * resolución: esas features del diseño Lovable no tienen respaldo en BD.
 */

/** Pestañas de tipo (mapeadas a la query por `reingresa_stock`). */
export const DEVOLUCIONES_TABS = ["Todas", "Cliente", "Proveedor"];

/**
 * Sub-filtros por estado real, dependientes de la pestaña de tipo.
 * El diseño Lovable usa nomenclatura de cliente/proveedor; aquí mapeamos a
 * los 4 estados reales del enum `estado_devolucion`.
 */
export const DEVOLUCIONES_SUBFILTROS = [
  "Todas",
  "Pendiente",
  "Aprobada",
  "Rechazada",
  "Procesada",
];

/** Sub-filtro (label de UI) → valor real de la columna `estado`. */
export function subfiltroToEstado(label) {
  switch (label) {
    case "Pendiente":
      return "pendiente";
    case "Aprobada":
      return "aprobada";
    case "Rechazada":
      return "rechazada";
    case "Procesada":
      return "procesada";
    default:
      return null;
  }
}

/**
 * reingresa_stock → tipo de devolución (clase de pill de tono + etiqueta).
 * @param {boolean} reingresa
 * @returns {{ cls: string, label: string }}
 */
export function devolucionTipoPill(reingresa) {
  return reingresa
    ? { cls: "s-pill s-env", label: "De cliente" }
    : { cls: "s-pill s-conv", label: "A proveedor" };
}

/**
 * Signo del ajuste de stock que produce la devolución.
 * Cliente (reingresa=true) suma, proveedor (false) resta.
 * @param {boolean} reingresa
 * @returns {'+'|'−'}
 */
export function devolucionSigno(reingresa) {
  return reingresa ? "+" : "−";
}

/**
 * Estado real de la devolución → clase `.s-pill`.
 * @param {string|null|undefined} estado
 * @returns {string}
 */
export function devolucionEstadoClass(estado) {
  switch (estado) {
    case "procesada":
      return "s-pill s-comp";
    case "rechazada":
      return "s-pill s-rec";
    case "aprobada":
      return "s-pill s-apr";
    case "pendiente":
      return "s-pill s-ven";
    default:
      return "s-pill s-ven";
  }
}

/**
 * Etiqueta legible del estado (capitaliza el valor del enum).
 * @param {string|null|undefined} estado
 * @returns {string}
 */
export function devolucionEstadoLabel(estado) {
  switch (estado) {
    case "pendiente":
      return "Pend. validación";
    case "aprobada":
      return "Aprobada";
    case "rechazada":
      return "Rechazada";
    case "procesada":
      return "Procesada";
    default:
      return estado ?? "—";
  }
}

/** El estado 'pendiente' anima su dot (espera de validación). */
export function devolucionPulse(estado) {
  return estado === "pendiente";
}
