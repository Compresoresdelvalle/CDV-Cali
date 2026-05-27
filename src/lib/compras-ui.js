/**
 * Helpers de presentación del módulo Compras (diseño Lovable).
 *
 * Convierte valores REALES de la base de datos a las clases del sistema
 * de diseño portado (`.s-pill`). NO contiene lógica de datos ni fetching —
 * solo presentación.
 *
 * NOTA DE RECONCILIACIÓN (diseño Lovable vs. backend real):
 *   El diseño Lovable contempla estados `borrador`, `transito`, `parcial`,
 *   etc. y recepción línea-a-línea (parcial / faltante / excedente). El
 *   backend REAL solo modela la compra con un booleano `recibida` + un
 *   `estado` ('completada' | 'devolucion_garantia'). Aquí mapeamos al
 *   lenguaje visual Lovable SIN inventar estados que el backend no soporta.
 */

/** Pestañas de filtro reales (mapeadas a la query de CompraHistorial). */
export const COMPRAS_TABS = ["Todas", "Registrada", "Recibida", "Garantía"];

/**
 * Estado real de una compra → clase `.s-pill` + etiqueta.
 * El estado real se deriva de dos campos:
 *   - `recibida` (bool): false → registrada, true → recibida
 *   - `estado` ('completada' | 'devolucion_garantia')
 * @param {{ recibida: boolean, estado?: string|null }} compra
 * @returns {{ cls: string, label: string }}
 */
export function compraEstadoPill({ recibida, estado }) {
  if (estado === "devolucion_garantia") {
    return { cls: "s-pill s-conv", label: "Dev. garantía" };
  }
  return recibida
    ? { cls: "s-pill s-apr", label: "Recibida" }
    : { cls: "s-pill s-ven", label: "Registrada" };
}

/**
 * Estado de una garantía de compra → tono semántico para el pill.
 * Real: 'abierta' | 'cerrada' | otros.
 * @param {string|null|undefined} estado
 * @returns {{ cls: string }}
 */
export function garantiaEstadoPill(estado) {
  return estado === "cerrada"
    ? { cls: "s-pill s-apr" }
    : { cls: "s-pill s-ven" };
}

/**
 * Construye los KPIs del encabezado de la lista (diseño Lovable: "N este
 * mes · $X comprado · M en tránsito") a partir de las filas REALES cargadas.
 * Como el backend no distingue "en tránsito" (solo recibida sí/no),
 * "pendientes" reemplaza honestamente a "en tránsito".
 *
 * @param {Array<{ total?: number, recibida?: boolean }>} compras
 * @returns {{ count: number, comprado: number, pendientes: number }}
 */
export function comprasHeaderStats(compras) {
  const list = Array.isArray(compras) ? compras : [];
  return list.reduce(
    (acc, c) => {
      acc.count += 1;
      acc.comprado += Number(c.total ?? 0);
      if (c.recibida !== true) acc.pendientes += 1;
      return acc;
    },
    { count: 0, comprado: 0, pendientes: 0 },
  );
}

/**
 * Línea de tiempo de una compra derivada de timestamps REALES.
 * Cada hito existe solo si su dato real está presente. Reproduce el
 * "Timeline detallado" de Lovable adaptado a los campos disponibles.
 *
 * @param {object} compra - fila de compras (fecha, fecha_recepcion, estado,
 *   recibida, registrador, proveedor)
 * @param {Array} garantias - garantias_compra asociadas
 * @param {(d: string) => string} fmtDate
 * @returns {Array<{ tone: string, act: string, meta: string, time: string|null }>}
 */
export function construirTimelineCompra(compra, garantias, fmtDate) {
  const eventos = [];
  eventos.push({
    tone: "info",
    act: "Orden de compra registrada",
    meta: `${compra.proveedor}${
      compra.registrador?.nombre ? ` · ${compra.registrador.nombre}` : ""
    }`,
    time: compra.fecha ? fmtDate(compra.fecha) : null,
  });

  if (compra.recibida && compra.fecha_recepcion) {
    eventos.push({
      tone: "succ",
      act: "Mercancía recibida en bodega",
      meta: `Ingreso a inventario · ${compra.sede_destino_id ?? ""}`.trim(),
      time: fmtDate(compra.fecha_recepcion),
    });
  } else {
    eventos.push({
      tone: "prog",
      act: "Pendiente de recepción",
      meta: "Esperando llegada de la mercancía",
      time: null,
    });
  }

  (garantias ?? []).forEach((g) => {
    eventos.push({
      tone: "warn",
      act: `Garantía #${g.numero} · ${g.resolucion ?? ""}`.trim(),
      meta: g.motivo ?? "Devolución al proveedor",
      time: g.fecha ? fmtDate(g.fecha) : null,
    });
  });

  return eventos;
}
