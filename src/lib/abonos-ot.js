/**
 * Abonos de OT de un periodo: lógica pura (sin React ni Supabase).
 *
 * Lo usan el historial de OT ("Pagadas el día…") y los dos cierres ("Abonos de
 * OT del día"). La plata de una OT entra al cierre por la FECHA DEL ABONO, no
 * por la fecha de la orden: una OT abierta en agosto y pagada hoy cuenta hoy.
 * Por eso esto se arma sobre la tabla `abonos` y no sobre `ordenes_servicio`.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Etiqueta legible del método, sin importar cómo quedó escrito en la base. */
export function metodoAbonoLabel(m) {
  const t = String(m ?? "").trim();
  if (!t) return "Sin método";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/**
 * @param {Array<{id, fecha, monto, metodo_pago, cuenta_bancaria, orden_id,
 *   orden?: {numero, cliente_nombre, sede_id, estado},
 *   registrador?: {nombre}}>} abonos
 * @returns {{filas: object[], total: number, porMetodo: {metodo:string,total:number}[], nOrdenes: number, totalCuentaCierre: number}}
 */
export function resumenAbonos(abonos = []) {
  const filas = abonos
    .map((a) => ({
      id: a.id,
      ordenId: a.orden_id,
      numero: a.orden?.numero ?? null,
      cliente: a.orden?.cliente_nombre?.trim() || "Cliente sin nombre",
      sedeId: a.orden?.sede_id ?? null,
      cancelada: a.orden?.estado === "cancelada",
      fecha: a.fecha,
      monto: num(a.monto),
      metodo: metodoAbonoLabel(a.metodo_pago),
      cuenta: a.cuenta_bancaria?.trim() || null,
      registradoPor: a.registrador?.nombre?.trim() || "—",
    }))
    .sort(
      (x, y) =>
        String(x.fecha).localeCompare(String(y.fecha)) ||
        num(x.numero) - num(y.numero),
    );

  const metodos = new Map();
  let total = 0;
  let totalCuentaCierre = 0;
  for (const f of filas) {
    total += f.monto;
    // El cierre ignora los abonos de OT canceladas; se muestran igual (es plata
    // que se recibió) pero no se suman a lo que el cierre cuenta.
    if (!f.cancelada) totalCuentaCierre += f.monto;
    metodos.set(f.metodo, (metodos.get(f.metodo) ?? 0) + f.monto);
  }

  return {
    filas,
    total,
    totalCuentaCierre,
    porMetodo: [...metodos.entries()]
      .map(([metodo, t]) => ({ metodo, total: t }))
      .sort((a, b) => b.total - a.total),
    nOrdenes: new Set(filas.map((f) => f.ordenId)).size,
  };
}

/** Hora 'hh:mm a. m.' en Bogotá de un timestamptz. */
export function horaBogota(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("es-CO", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    minute: "2-digit",
  });
}
