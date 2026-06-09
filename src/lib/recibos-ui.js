/**
 * Helpers de presentación del módulo Recibos (diseño Lovable).
 *
 * Convierte los valores REALES de la base de datos a las clases del sistema
 * de diseño portado (`.s-pill`, `.link-pill`). NO contiene lógica de datos ni
 * fetching — solo presentación.
 */

/** Tabs reales del historial de recibos (mapeados al filtro `anulado`). */
export const RECIBOS_TABS = [
  { v: "Todos", anulado: null },
  { v: "Vigentes", anulado: false },
  { v: "Anulados", anulado: true },
];

/**
 * Métodos de pago reales del recibo (columna recibos.metodo_pago) para el
 * <select> del formulario. Reales: 'efectivo' | 'transferencia' | 'tarjeta' |
 * 'otro'.
 */
export const RECIBO_METODOS_PAGO = [
  { v: "efectivo", label: "Efectivo" },
  { v: "transferencia", label: "Transferencia" },
  { v: "tarjeta", label: "Tarjeta" },
  { v: "otro", label: "Otro" },
];

/**
 * Etiqueta legible de una cuenta bancaria real (tabla cuentas_bancarias).
 * @param {{banco?:string, tipo?:string, numero?:string, titular?:string}|null} c
 * @returns {string}
 */
export function cuentaBancariaLabel(c) {
  if (!c) return "—";
  const base = [c.banco, c.tipo, c.numero].filter(Boolean).join(" ");
  return c.titular ? `${base} · ${c.titular}` : base || "—";
}

/**
 * Estado real de un recibo (columna recibos.anulado) → clase `.s-pill`.
 * @param {boolean} anulado
 * @returns {string}
 */
export function reciboEstadoPillClass(anulado) {
  return anulado ? "s-pill s-rec" : "s-pill s-apr";
}

/** Etiqueta legible del estado del recibo. */
export function reciboEstadoLabel(anulado) {
  return anulado ? "Anulado" : "Activo";
}

/**
 * Método de pago real (columna recibos.metodo_pago) → etiqueta legible.
 * Reales: 'efectivo' | 'transferencia' | 'tarjeta' | 'otro'.
 * @param {string|null|undefined} metodo
 * @returns {string}
 */
export function metodoPagoLabel(metodo) {
  const m = (metodo ?? "").toLowerCase();
  if (m === "efectivo") return "Efectivo";
  if (m === "transferencia") return "Transferencia";
  if (m === "tarjeta") return "Tarjeta";
  return metodo ? metodo[0].toUpperCase() + metodo.slice(1) : "—";
}

/**
 * Método de pago real → clase `.pay-pill` del sistema de diseño portado.
 * 'otro' cae al estilo de efectivo (gris neutro), igual que en el diseño.
 * @param {string|null|undefined} metodo
 * @returns {string}
 */
export function metodoPagoPillClass(metodo) {
  const m = (metodo ?? "").toLowerCase();
  if (m === "transferencia") return "pay-pill transferencia";
  if (m === "tarjeta") return "pay-pill tarjeta";
  return "pay-pill efectivo";
}

/**
 * Tipo REAL del recibo, derivado de sus vínculos en BD.
 * - 'cot' → tiene cotizacion_id (recibo desde cotización).
 * - 'ot'  → tiene orden_id sin cotización (abono/anticipo a OT).
 * - 'manual' → sin vínculos.
 * Las clases de tono usan los tokens del sistema de diseño (info / primario /
 * neutro), igual que el pill de tipo del diseño Lovable.
 * @param {{cotizacion_id?:string|null, orden_id?:string|null}} r
 * @returns {{key:"cot"|"ot"|"manual", label:string, tone:"info"|"prog"|"neut"}}
 */
export function reciboTipo(r) {
  if (r?.cotizacion_id) {
    return { key: "cot", label: "Por cotización", tone: "info" };
  }
  if (r?.orden_id) {
    return { key: "ot", label: "Vinculado a OT", tone: "prog" };
  }
  return { key: "manual", label: "Manual", tone: "neut" };
}

/**
 * Estilo inline (tokens, salvo borde tenue del diseño) para el pill de tipo,
 * según el tono devuelto por {@link reciboTipo}. Replica el TIPO_CLS del diseño
 * Lovable usando variables CSS del design system.
 * @param {"info"|"prog"|"neut"} tone
 * @returns {{backgroundColor:string, color:string, borderColor:string}}
 */
export function reciboTipoPillStyle(tone) {
  if (tone === "prog") {
    return {
      backgroundColor: "var(--p-50)",
      color: "var(--p-700)",
      borderColor: "var(--p-200)",
    };
  }
  if (tone === "neut") {
    return {
      backgroundColor: "var(--n-100)",
      color: "var(--n-700)",
      borderColor: "var(--n-150)",
    };
  }
  return {
    backgroundColor: "var(--info-50)",
    color: "var(--info-700)",
    borderColor: "#C8DFFC",
  };
}

/**
 * Avatar mini de quien recibió el pago: iniciales + variante de gradiente.
 * Las variantes (ml/am/cr) son las del sistema de diseño portado; se asignan
 * de forma determinista por nombre para tener color estable sin inventar datos.
 * @param {string|null|undefined} nombre
 * @returns {{ini:string, variant:"ml"|"am"|"cr", nombre:string}}
 */
export function reciboAvatar(nombre) {
  const limpio = (nombre ?? "").trim();
  const partes = limpio.split(/\s+/).filter(Boolean);
  const ini =
    partes.length === 0
      ? "—"
      : (partes[0][0] + (partes[1]?.[0] ?? partes[0][1] ?? "")).toUpperCase();
  const variantes = ["ml", "am", "cr"];
  let suma = 0;
  for (let i = 0; i < limpio.length; i += 1) suma += limpio.charCodeAt(i);
  const variant = limpio ? variantes[suma % variantes.length] : "ml";
  return { ini, variant, nombre: limpio || "—" };
}

/**
 * Construye el timeline (Historial) de un recibo a partir de datos REALES.
 * No inventa eventos: se basa en columnas existentes (fecha, recibido_por,
 * vínculos, abono_id, anulado). `fmtDate` formatea timestamps reales.
 * @param {object} recibo
 * @param {(d:string)=>string} fmtDate
 * @returns {Array<{tone:"info"|"succ"|"warn", act:string, meta:string, time:string|null}>}
 */
export function construirHistorialRecibo(recibo, fmtDate = (d) => d) {
  if (!recibo) return [];
  const eventos = [];
  const por = recibo.recibidor?.nombre ?? "—";
  const tiempo = recibo.fecha ? fmtDate(recibo.fecha) : null;

  if (recibo.cotizacion_id) {
    eventos.push({
      tone: "info",
      act: "Recibo generado desde cotización",
      meta: `Por ${por} · datos pre-cargados`,
      time: tiempo,
    });
  } else {
    eventos.push({
      tone: "info",
      act: `Recibo #${recibo.numero} emitido`,
      meta: `Por ${por}`,
      time: tiempo,
    });
  }

  eventos.push({
    tone: "succ",
    act: `Consecutivo #${recibo.numero} asignado por BD`,
    meta: "Auto · sin saltos",
    time: tiempo,
  });

  if (recibo.abono_id && recibo.orden_id) {
    eventos.push({
      tone: "succ",
      act: "Abono registrado en la OT vinculada",
      meta: "Consolidado dentro de este recibo",
      time: tiempo,
    });
  }

  eventos.push(
    recibo.anulado
      ? {
          tone: "warn",
          act: "Recibo anulado",
          meta: "Sin efecto contable · abono revertido si existía",
          time: tiempo,
        }
      : {
          tone: "succ",
          act: "Recibo activo · listo para imprimir",
          meta: "PDF disponible para descargar o imprimir",
          time: tiempo,
        },
  );

  return eventos;
}
