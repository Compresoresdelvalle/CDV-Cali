/**
 * Helpers de presentación del módulo Garantías (diseño Lovable).
 *
 * Convierte los valores REALES de la base de datos a las clases del sistema
 * de diseño portado (`.s-pill`). NO contiene lógica de datos ni fetching —
 * solo presentación.
 */

/** Tabs reales del listado de garantías. */
export const GARANTIAS_TABS = [
  { v: "compra", label: "De compras", sub: "Devolución al proveedor" },
  { v: "venta", label: "De ventas", sub: "Reclamo del cliente" },
];

/** Estados reales de una garantía de compra (columna garantias_compra.estado). */
export const ESTADOS_GARANTIA_COMPRA = [
  "abierta",
  "nota_credito_emitida",
  "reposicion_pendiente",
  "reposicion_recibida",
  "cerrada",
];

/** Estados reales de una garantía de venta (columna garantias_venta.estado). */
export const ESTADOS_GARANTIA_VENTA = ["abierta", "cerrada"];

/** Etiquetas legibles de los estados internos. */
const ESTADO_LABELS = {
  abierta: "Abierta",
  nota_credito_emitida: "Nota crédito emitida",
  reposicion_pendiente: "Reposición pendiente",
  reposicion_recibida: "Reposición recibida",
  cerrada: "Cerrada",
};

/**
 * Etiqueta legible de un estado de garantía.
 * @param {string|null|undefined} estado
 * @returns {string}
 */
export function garantiaEstadoLabel(estado) {
  return ESTADO_LABELS[estado] ?? estado ?? "—";
}

/**
 * Estado real de garantía → clase `.s-pill` del diseño.
 * - cerrada / reposicion_recibida → aprobada (verde)
 * - nota_credito_emitida → en proceso (azul)
 * - abierta / reposicion_pendiente → pendiente cálido (warning, con pulse)
 * @param {string|null|undefined} estado
 * @returns {string}
 */
export function garantiaEstadoPillClass(estado) {
  switch (estado) {
    case "cerrada":
    case "reposicion_recibida":
      return "s-pill s-apr";
    case "nota_credito_emitida":
      return "s-pill s-env";
    case "abierta":
    case "reposicion_pendiente":
      return "s-pill s-ven";
    default:
      return "s-pill s-borr";
  }
}

/**
 * Resolución real de garantía → tono de pill `RESOL` (clases utilitarias del
 * diseño Lovable). Devuelve directamente la clase `.s-pill` semántica más
 * cercana, evitando colores hardcodeados.
 * @param {string|null|undefined} resolucion
 * @returns {string}
 */
export function resolucionPillClass(resolucion) {
  const r = (resolucion ?? "").toLowerCase();
  if (r.includes("reembolso") || r.includes("devolver") || r.includes("dinero"))
    return "s-pill s-ven";
  if (r.includes("nota")) return "s-pill s-env";
  if (r.includes("cambio") || r.includes("cambiar") || r.includes("reposicion"))
    return "s-pill s-conv";
  if (r.includes("reparacion") || r.includes("arreglar")) return "s-pill s-env";
  return "s-pill s-borr";
}

/* ────────────────────── Etiquetas de resolución ───────────────────────── */

/** Resoluciones reales de garantía de venta (enum resolucion_garantia_venta). */
const RESOL_VENTA_LABELS = {
  arreglar_producto: "Reparación del producto",
  cambiar_pieza: "Cambio de pieza",
  devolver_dinero: "Reembolso",
};

/** Resoluciones reales de garantía de compra (enum resolucion_garantia_compra). */
const RESOL_COMPRA_LABELS = {
  nota_credito: "Nota crédito",
  reposicion_fisica: "Reposición física",
  // S6-09: valor válido del enum ofrecido en el modal; sin etiqueta se
  // mostraba el string crudo "pendiente".
  pendiente: "Sin resolución definida",
};

/**
 * Etiqueta legible de una resolución de garantía (venta o compra).
 * @param {string|null|undefined} resolucion
 * @returns {string}
 */
export function resolucionLabel(resolucion) {
  if (!resolucion) return "—";
  return (
    RESOL_VENTA_LABELS[resolucion] ??
    RESOL_COMPRA_LABELS[resolucion] ??
    resolucion
  );
}

/* ───────────────────── Vigencia de garantía de venta ───────────────────── */

const MS_POR_DIA = 86_400_000;

/**
 * Calcula la vigencia de una garantía de venta a partir de datos REALES:
 * fecha ancla (venta.fecha u orden.fecha_entrega) + días de garantía
 * (parámetro `dias_garantia_venta`, default 90). Reproduce el bloque
 * "Vence / días restantes" del diseño Lovable SIN inventar columnas: todo se
 * deriva de la fecha origen y el parámetro de sistema.
 *
 * @param {string|Date|null|undefined} anchorFecha - fecha de venta/entrega
 * @param {number} diasGarantia - vigencia en días (parámetro de sistema)
 * @returns {{ vence: Date|null, diasRestantes: number|null, tone: 'ok'|'warn'|'danger'|'expired' }}
 */
export function calcularVigencia(anchorFecha, diasGarantia = 90) {
  if (!anchorFecha) return { vence: null, diasRestantes: null, tone: "ok" };
  const ancla = new Date(anchorFecha);
  if (Number.isNaN(ancla.getTime()))
    return { vence: null, diasRestantes: null, tone: "ok" };
  const vence = new Date(ancla.getTime() + diasGarantia * MS_POR_DIA);
  const diasRestantes = Math.ceil((vence.getTime() - Date.now()) / MS_POR_DIA);
  let tone = "ok";
  if (diasRestantes < 0) tone = "expired";
  else if (diasRestantes <= 15) tone = "danger";
  else if (diasRestantes <= 30) tone = "warn";
  return { vence, diasRestantes, tone };
}

/* ───────────────────── Stepper de proceso (state machine) ──────────────── */

/**
 * Construye los pasos del "Proceso de la reclamación" para una garantía de
 * VENTA, derivados del estado real (`abierta` | `cerrada`) y su resolución.
 * Reproduce el stepper Lovable adaptándolo al ciclo real, sin inventar etapas
 * intermedias que el backend no registra.
 *
 * @param {{ estado: string, resolucion?: string, fecha?: string, ot_reparacion?: object }} g
 * @param {(d: string) => string} fmtDate
 * @returns {Array<{ label: string, meta: string, state: 'done'|'active'|'pending' }>}
 */
export function construirProcesoVenta(g, fmtDate = (d) => d) {
  const fecha = g?.fecha ? fmtDate(g.fecha) : "—";
  const cerrada = g?.estado === "cerrada";
  const conReparacion = g?.resolucion === "arreglar_producto";

  const reportada = { label: "Reportada", meta: fecha, state: "done" };
  const resolucion = {
    label: "Resolución definida",
    meta: resolucionLabel(g?.resolucion),
    state: "done",
  };

  if (conReparacion) {
    // arreglar_producto → genera OT; la garantía queda 'abierta' hasta que la
    // reparación cierra. El paso final depende del estado real.
    return [
      reportada,
      resolucion,
      {
        label: "Reparación en curso",
        meta: g?.ot_reparacion ? `OT #${g.ot_reparacion.numero}` : "OT interna",
        state: cerrada ? "done" : "active",
      },
      {
        label: "Resuelta",
        meta: cerrada ? "Garantía cerrada" : "—",
        state: cerrada ? "done" : "pending",
      },
    ];
  }

  // cambiar_pieza / devolver_dinero → se resuelven al abrir (estado 'cerrada').
  return [
    reportada,
    resolucion,
    {
      label: "Resuelta",
      meta: cerrada ? "Garantía cerrada" : "Pendiente",
      state: cerrada ? "done" : "active",
    },
  ];
}

/**
 * Construye los pasos del proceso para una garantía de COMPRA, derivados del
 * estado real (abierta → nota_credito_emitida / reposicion_pendiente →
 * reposicion_recibida → cerrada).
 *
 * @param {{ estado: string, resolucion?: string, fecha?: string, fecha_cierre?: string }} g
 * @param {(d: string) => string} fmtDate
 * @returns {Array<{ label: string, meta: string, state: 'done'|'active'|'pending' }>}
 */
export function construirProcesoCompra(g, fmtDate = (d) => d) {
  const fecha = g?.fecha ? fmtDate(g.fecha) : "—";
  const estado = g?.estado;
  const esNota = g?.resolucion === "nota_credito";

  const abierta = { label: "Abierta", meta: fecha, state: "done" };

  if (esNota) {
    const emitida = estado === "nota_credito_emitida" || estado === "cerrada";
    return [
      abierta,
      {
        label: "Nota crédito emitida",
        meta: resolucionLabel(g?.resolucion),
        state: emitida ? "done" : "active",
      },
      {
        label: "Cerrada",
        meta: g?.fecha_cierre ? fmtDate(g.fecha_cierre) : "—",
        state: estado === "cerrada" ? "done" : "pending",
      },
    ];
  }

  // S6-09: resolución aún no decidida — stepper neutro propio en vez de
  // enrutarla por la rama de reposición física (que mostraba pasos falsos).
  if (g?.resolucion === "pendiente" || !g?.resolucion) {
    return [
      abierta,
      {
        label: "Resolución pendiente",
        meta: "Por definir con el proveedor",
        state: estado === "cerrada" ? "done" : "active",
      },
      {
        label: "Cerrada",
        meta: g?.fecha_cierre ? fmtDate(g.fecha_cierre) : "—",
        state: estado === "cerrada" ? "done" : "pending",
      },
    ];
  }

  // reposicion_fisica → pendiente → recibida → cerrada
  const recibida = estado === "reposicion_recibida" || estado === "cerrada";
  return [
    abierta,
    {
      label: "Reposición pendiente",
      meta: "Esperando al proveedor",
      state:
        estado === "reposicion_pendiente"
          ? "active"
          : recibida
            ? "done"
            : "pending",
    },
    {
      label: "Reposición recibida",
      meta: recibida ? "Ingresada al inventario" : "—",
      state: recibida ? "done" : "pending",
    },
    {
      label: "Cerrada",
      meta: g?.fecha_cierre ? fmtDate(g.fecha_cierre) : "—",
      state: estado === "cerrada" ? "done" : "pending",
    },
  ];
}

/* ──────────────────────────── Timeline (historial) ─────────────────────── */

/**
 * Línea de tiempo (sidebar "Historial") de una garantía de VENTA, derivada de
 * timestamps REALES. Cada hito existe solo si su dato real está presente.
 *
 * @param {object} g - fila garantias_venta + relaciones
 * @param {(d: string) => string} fmtDate
 * @returns {Array<{ tone: string, act: string, meta: string, time: string|null }>}
 */
export function construirHistorialVentaGarantia(g, fmtDate = (d) => d) {
  const eventos = [];
  const origen = g?.venta
    ? `Venta #${g.venta.numero}`
    : g?.orden
      ? `OT #${g.orden.numero}`
      : "origen";

  eventos.push({
    tone: "info",
    act: "Reclamación de garantía registrada",
    meta: `Origen: ${origen}`,
    time: g?.fecha ? fmtDate(g.fecha) : null,
  });

  eventos.push({
    tone: "info",
    act: `Resolución: ${resolucionLabel(g?.resolucion)}`,
    meta:
      g?.resolucion === "devolver_dinero"
        ? "Reembolso al cliente"
        : g?.resolucion === "cambiar_pieza"
          ? "Cambio de pieza desde stock"
          : "Reparación del producto",
    time: g?.fecha ? fmtDate(g.fecha) : null,
  });

  if (g?.ot_reparacion) {
    eventos.push({
      tone: "warn",
      act: `OT de reparación #${g.ot_reparacion.numero} generada`,
      meta: `Estado: ${g.ot_reparacion.estado ?? "—"}`,
      time: null,
    });
  }

  eventos.push(
    g?.estado === "cerrada"
      ? {
          tone: "succ",
          act: "Garantía cerrada",
          meta: "Reclamación resuelta",
          time: null,
        }
      : {
          tone: "prog",
          act: "Garantía abierta",
          meta: "Reclamación en curso",
          time: null,
        },
  );

  return eventos;
}

/**
 * Línea de tiempo (sidebar "Historial") de una garantía de COMPRA, derivada de
 * timestamps REALES.
 *
 * @param {object} g - fila garantias_compra + relaciones
 * @param {object|null} notaCredito - nota de crédito asociada (o null)
 * @param {(d: string) => string} fmtDate
 * @returns {Array<{ tone: string, act: string, meta: string, time: string|null }>}
 */
export function construirHistorialCompraGarantia(
  g,
  notaCredito,
  fmtDate = (d) => d,
) {
  const eventos = [];

  eventos.push({
    tone: "info",
    act: "Garantía abierta al proveedor",
    meta: g?.compra
      ? `Compra #${g.compra.numero} · ${g.compra.proveedor ?? ""}`.trim()
      : "Devolución al proveedor",
    time: g?.fecha ? fmtDate(g.fecha) : null,
  });

  if (notaCredito) {
    eventos.push({
      tone: "succ",
      act: `Nota crédito #${notaCredito.numero} emitida`,
      meta: "Aplicable en compras al mismo proveedor",
      time: notaCredito.fecha ? fmtDate(notaCredito.fecha) : null,
    });
  }

  if (
    g?.estado === "reposicion_pendiente" ||
    g?.estado === "reposicion_recibida"
  ) {
    eventos.push({
      tone: g.estado === "reposicion_recibida" ? "succ" : "prog",
      act:
        g.estado === "reposicion_recibida"
          ? "Reposición recibida"
          : "Reposición pendiente",
      meta:
        g.estado === "reposicion_recibida"
          ? "Reingresada al inventario"
          : "Esperando al proveedor",
      time: null,
    });
  }

  if (g?.estado === "cerrada") {
    eventos.push({
      tone: "succ",
      act: "Garantía cerrada",
      meta: "Proceso finalizado",
      time: g?.fecha_cierre ? fmtDate(g.fecha_cierre) : null,
    });
  }

  return eventos;
}
