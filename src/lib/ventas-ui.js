/**
 * Helpers de presentación del módulo Ventas (diseño Lovable).
 *
 * Convierte valores REALES de la base de datos a las clases del sistema
 * de diseño portado (`.pay-pill`, `.av-mini`, `.s-pill`). NO contiene
 * lógica de datos ni fetching — solo presentación.
 */

/** Métodos de pago reales (columna ventas.metodo_pago). */
export const METODOS_PAGO_VENTA = [
  "Todos",
  "Efectivo",
  "Transferencia",
  "Tarjeta",
  "Crédito",
];

/**
 * Método de pago real → clase de `.pay-pill` del diseño.
 * Reales: 'Efectivo' | 'Transferencia' | 'Tarjeta' | 'Crédito' | 'Mixto'.
 * El diseño define efectivo | transferencia | tarjeta | mixto; 'Crédito'
 * cae en `mixto` (el visual neutro-cálido más cercano disponible).
 * @param {string|null|undefined} metodo
 * @returns {'efectivo'|'transferencia'|'tarjeta'|'mixto'}
 */
export function metodoPagoClass(metodo) {
  const m = (metodo ?? "").toLowerCase();
  if (m.includes("efectivo")) return "efectivo";
  if (m.includes("transfer")) return "transferencia";
  if (m.includes("tarjeta")) return "tarjeta";
  return "mixto";
}

/**
 * Estado de venta real → clase de `.s-pill`.
 * Real: una venta está `anulada` (bool) o completada por defecto.
 * @param {boolean} anulada
 * @returns {'s-anul'|'s-comp'}
 */
export function ventaEstadoClass(anulada) {
  return anulada ? "s-anul" : "s-comp";
}

/** Etiqueta legible del estado de venta. */
export function ventaEstadoLabel(anulada) {
  return anulada ? "Anulada" : "Completada";
}

/**
 * Iniciales (máx. 2) de un nombre para el avatar `.av-mini`.
 * @param {string|null|undefined} nombre
 * @returns {string}
 */
export function inicialesNombre(nombre = "") {
  return (nombre || "")
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Variante de gradiente del avatar `.av-mini` (ml | am | cr).
 * Determinística por nombre para que un mismo vendedor mantenga su color.
 * @param {string|null|undefined} nombre
 * @returns {'ml'|'am'|'cr'}
 */
export function avatarVariant(nombre = "") {
  const variants = ["ml", "am", "cr"];
  const str = nombre || "";
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return variants[hash % variants.length];
}

/* ──────────────────── Resumen de productos (lista) ──────────────────── */

/**
 * Resumen textual de los productos de una venta para la columna "Productos"
 * de la lista (estilo Lovable: "Filtro GA-22 + Aceite + 1 más").
 *
 * Recibe el join `detalle_venta(producto:producto_id(nombre))`. Si no hay
 * detalle disponible (el listado no lo trae por rendimiento), devuelve `null`
 * y el caller muestra un guion honesto.
 *
 * @param {Array<{ producto?: { nombre?: string }|null }>|null|undefined} detalle
 * @param {number} [maxNombres=2] cuántos nombres mostrar antes del "+N más"
 * @returns {string|null}
 */
export function resumenProductos(detalle, maxNombres = 2) {
  if (!Array.isArray(detalle) || detalle.length === 0) return null;
  const nombres = detalle
    .map((d) => d?.producto?.nombre)
    .filter((n) => typeof n === "string" && n.trim().length > 0);
  if (nombres.length === 0) return null;
  const visibles = nombres.slice(0, maxNombres);
  const resto = nombres.length - visibles.length;
  return resto > 0
    ? `${visibles.join(" + ")} + ${resto} más`
    : visibles.join(" + ");
}

/* ──────────────────── Vinculaciones del ciclo (detalle) ──────────────── */

/**
 * Estado de una devolución → etiqueta legible para la pill de vinculación.
 * Real (enum estado_devolucion): 'pendiente' | 'aprobada' | 'rechazada' | 'procesada'.
 * @param {string|null|undefined} estado
 * @returns {string}
 */
export function devolucionEstadoLabel(estado) {
  const labels = {
    pendiente: "Pendiente",
    aprobada: "Aprobada",
    rechazada: "Rechazada",
    procesada: "Procesada",
  };
  return labels[estado] ?? estado ?? "—";
}

/**
 * Estado de una garantía de venta → etiqueta legible.
 * Real (garantias_venta.estado): 'abierta' | 'cerrada' | 'anulada'.
 * @param {string|null|undefined} estado
 * @returns {string}
 */
export function garantiaVentaEstadoLabel(estado) {
  const labels = { abierta: "Abierta", cerrada: "Cerrada", anulada: "Anulada" };
  return labels[estado] ?? estado ?? "—";
}

/* ──────────────────── Historial / timeline (detalle) ─────────────────── */

/**
 * Construye los eventos del historial (`.timeline`) a partir de datos REALES
 * de la venta y sus vinculaciones. Cada hito existe solo si su dato real está
 * presente — sin pasos inventados. Reproduce el `tone` de Lovable
 * (info | succ) con un `dang` adicional para la anulación.
 *
 * @param {{ numero?: number|string, fecha?: string, anulada?: boolean,
 *           metodo_pago?: string, vendedor?: { nombre?: string }|null }} venta
 * @param {{ devoluciones?: Array<{ numero: number|string, fecha?: string }>,
 *           garantias?: Array<{ numero: number|string, fecha?: string }> }} [vinculos]
 * @param {(d: string) => string} fmtDate formateador de fecha (se inyecta para no acoplar utils)
 * @returns {Array<{ tone: 'info'|'succ'|'dang', act: string, meta: string, time: string|null }>}
 */
export function construirHistorialVenta(
  venta,
  vinculos = {},
  fmtDate = (d) => d,
) {
  const eventos = [];
  const vendedor = venta?.vendedor?.nombre ?? "—";

  eventos.push({
    tone: "info",
    act: `Venta #${venta?.numero ?? "—"} registrada`,
    meta: `Vendida por ${vendedor}`,
    time: venta?.fecha ? fmtDate(venta.fecha) : null,
  });

  if (!venta?.anulada) {
    eventos.push({
      tone: "succ",
      act: `Pago confirmado · ${venta?.metodo_pago ?? "—"}`,
      meta: "Stock descontado del inventario",
      time: venta?.fecha ? fmtDate(venta.fecha) : null,
    });
  }

  for (const d of vinculos.devoluciones ?? []) {
    eventos.push({
      tone: "info",
      act: `Devolución #${d.numero} asociada`,
      meta: "Reingreso parcial al inventario",
      time: d.fecha ? fmtDate(d.fecha) : null,
    });
  }

  for (const g of vinculos.garantias ?? []) {
    eventos.push({
      tone: "info",
      act: `Garantía #${g.numero} abierta`,
      meta: "Reclamo de garantía del cliente",
      time: g.fecha ? fmtDate(g.fecha) : null,
    });
  }

  if (venta?.anulada) {
    eventos.push({
      tone: "dang",
      act: `Venta #${venta?.numero ?? "—"} anulada`,
      meta: "Stock devuelto automáticamente",
      time: null,
    });
  }

  return eventos;
}
