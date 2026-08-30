/**
 * Helpers de presentación del módulo Ventas (diseño Lovable).
 *
 * Convierte valores REALES de la base de datos a las clases del sistema
 * de diseño portado (`.pay-pill`, `.av-mini`, `.s-pill`). NO contiene
 * lógica de datos ni fetching — solo presentación.
 */

/** Métodos de pago reales (columna ventas.metodo_pago). */
// Valores REALES en `ventas.metodo_pago` (verificado en producción):
// Efectivo, Transferencia, Abonos OT, Tarjeta, Mixto, Crédito.
// 'Abonos OT' y 'Mixto' faltaban aquí, así que 39 ventas no se podían filtrar
// por chip: solo aparecían dentro de "Todos".
export const METODOS_PAGO_VENTA = [
  "Todos",
  "Efectivo",
  "Transferencia",
  "Tarjeta",
  "Mixto",
  "Crédito",
  "Abonos OT",
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

/* ──────────────────── Cambio de producto (precio sugerido) ───────────── */

/**
 * Precio sugerido para el producto que el cliente se lleva en un CAMBIO.
 *
 * Conserva el trato relativo que se le hizo: parte de lo que realmente pagó y
 * le suma la diferencia de precio de lista entre los dos productos. Si las dos
 * referencias valen lo mismo, el resultado es lo que pagó — o sea, cambio par,
 * que es el caso que rompía antes (se le cobraba de vuelta el descuento).
 *
 * Usa a propósito los precios de lista de HOY y no `detalle_venta.precio_catalogo`:
 * esa columna está vacía en las ventas anteriores a que se empezara a guardar
 * (542 de 3.811 líneas), y una fórmula que dependa de ella fallaría justo en las
 * ventas viejas.
 *
 * @param {{precioPagadoUnitario:number, listaDevuelto:number, listaNuevo:number}} args
 * @returns {number} precio unitario sugerido, en pesos enteros, nunca negativo
 */
export function precioSugeridoCambio({
  precioPagadoUnitario,
  listaDevuelto,
  listaNuevo,
}) {
  const pagado = Number(precioPagadoUnitario) || 0;
  const lDev = Number(listaDevuelto) || 0;
  const lNue = Number(listaNuevo) || 0;
  // Sin lista del devuelto no hay con qué comparar: se cae al precio de lista
  // del nuevo, que es el comportamiento de siempre.
  if (lDev <= 0) return Math.round(lNue);
  const sugerido = Math.round(pagado + (lNue - lDev));
  // Un descuento en pesos arrastrado desde una venta mucho mas cara puede dejar
  // el sugerido en cero o en negativo: pago 500.000 de una lista de 600.000 y
  // cambia por uno de lista 80.000 daria -20.000. Ahi el trato original ya no
  // aplica, y acotarlo a 0 proponia REGALAR el producto con el mismo mensaje
  // tranquilizador de siempre. Se cae al precio de lista, que es la decision
  // segura, y la vendedora ajusta si acuerdan otra cosa.
  if (sugerido <= 0) return Math.round(lNue);
  return sugerido;
}

/**
 * Proporción del subtotal que el cliente realmente pagó en una venta, usada
 * para calcular el crédito cuando devuelve algo de ella.
 *
 * Es el espejo de `v_ratio` en `fn_registrar_cambio`. Vive aquí, y no suelta
 * dentro del modal, porque estaba duplicada a mano en los dos lados y se
 * desincronizó: al arreglar el backend para que una venta de cambio use ratio
 * = 1, la pantalla siguió aplicando el ratio viejo y mostraba un crédito
 * mucho menor del que la caja iba a mover (en la venta #1345, $0 contra
 * $18.000). Un solo lugar y un test que lo fije.
 *
 * @param {{subtotal?:number, descuento_valor?:number, descuento_pct?:number,
 *          cambio_de_venta_id?:string|null}} venta
 * @returns {number} factor entre 0 y 1
 */
export function ratioCreditoVenta(venta) {
  // En una venta que a su vez es un CAMBIO, `descuento_valor` guarda la
  // PERMUTA —lo que valía el producto que el cliente entregó—, no un descuento
  // comercial. Aplicarlo subvaloraría el crédito.
  if (venta?.cambio_de_venta_id != null) return 1;
  const sub = Number(venta?.subtotal) || 0;
  if (sub <= 0) return 1;
  const descRaw =
    venta?.descuento_valor != null
      ? Number(venta.descuento_valor)
      : (sub * (Number(venta?.descuento_pct) || 0)) / 100;
  const desc = Math.max(0, Math.min(descRaw, sub));
  return (sub - desc) / sub;
}
