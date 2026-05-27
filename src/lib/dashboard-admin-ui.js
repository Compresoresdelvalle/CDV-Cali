/**
 * Helpers de presentación del Dashboard Admin (diseño Lovable "cockpit").
 *
 * Solo presentación: selección de ventana de ventas según el control de
 * periodo y formateo de hora. NO contiene lógica de datos ni fetching.
 */

/** Opciones del control segmentado "Periodo". */
export const PERIODOS = ["Hoy", "Semana", "Mes"];

/**
 * Devuelve el total de ventas reales correspondiente al periodo elegido.
 * Mapea el control de UI a los campos que ya entrega `fn_dashboard_kpis`.
 * @param {Record<string, unknown>} kpis
 * @param {"Hoy"|"Semana"|"Mes"} periodo
 * @returns {number}
 */
export function periodoVentas(kpis, periodo) {
  const k = kpis ?? {};
  switch (periodo) {
    case "Semana":
      return Number(k.ventas_semana ?? 0);
    case "Mes":
      return Number(k.ventas_mes ?? 0);
    case "Hoy":
    default:
      return Number(k.ventas_hoy ?? 0);
  }
}

/**
 * Hora local (America/Bogota) HH:mm de un timestamp ISO.
 * @param {string|number|Date|null|undefined} ts
 * @returns {string}
 */
export function formatHora(ts) {
  if (!ts) return "";
  try {
    return new Intl.DateTimeFormat("es-CO", {
      timeZone: "America/Bogota",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ts));
  } catch {
    return "";
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Helpers de los bloques estratégicos 2x2 (diseño Lovable "cockpit").
 *
 * Reproducen las FILAS de detalle del diseño fuente (productos en alerta, OTs
 * en proceso, cotizaciones por vencer) a partir de SELECTs de SOLO LECTURA que
 * la propia página hace sobre tablas que ya existen. Solo presentación:
 * mapeos de severidad a tokens semánticos y derivación de antigüedad/vencimiento
 * a partir de timestamps reales. NO contiene fetching ni lógica de escritura.
 * ────────────────────────────────────────────────────────────────────────── */

const MS_POR_DIA = 86_400_000;

/** Umbral (días) bajo el cual una cotización activa se considera "por vencer". */
export const COT_DIAS_POR_VENCER = 7;
/** Umbral (días) tras el que una OT en taller se marca como vencida en el cockpit. */
export const OT_DIAS_DASHBOARD_VENCIDA = 5;

/**
 * Días enteros transcurridos desde una fecha ISO hasta ahora (mínimo 0).
 * @param {string|number|Date|null|undefined} fecha
 * @returns {number|null} null si la fecha no es válida
 */
export function diasDesde(fecha) {
  if (!fecha) return null;
  const t = new Date(fecha).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / MS_POR_DIA));
}

/**
 * Severidad de stock (columna real `estado_stock`) → token + etiqueta.
 * 'Agotado' es crítico (destructive); 'Bajo' es advertencia (warning).
 * @param {string|null|undefined} estadoStock
 * @returns {{ token: string, label: string }}
 */
export function severidadStock(estadoStock) {
  if (estadoStock === "Agotado")
    return { token: "--destructive", label: "agotado" };
  return { token: "--warning", label: "stock bajo" };
}

/**
 * Antigüedad de una OT (desde `fecha` de recepción) → etiqueta corta + token.
 * Reproduce la columna derecha "5d / vencida" del cockpit Lovable.
 * @param {string|null|undefined} fecha
 * @returns {{ label: string, status: string, token: string }}
 */
export function antiguedadOT(fecha) {
  const dias = diasDesde(fecha);
  if (dias == null)
    return { label: "—", status: "", token: "--muted-foreground" };
  const label = dias === 0 ? "hoy" : dias === 1 ? "1d" : `${dias}d`;
  if (dias >= OT_DIAS_DASHBOARD_VENCIDA)
    return { label, status: "vencida", token: "--destructive" };
  if (dias >= 2) return { label, status: "en plazo", token: "--warning" };
  return {
    label,
    status: dias === 0 ? "hoy" : "reciente",
    token: "--muted-foreground",
  };
}

/**
 * Días restantes de vigencia de una cotización (fecha + vigencia_dias).
 * @param {string|null|undefined} fecha
 * @param {number|null|undefined} vigenciaDias
 * @returns {number|null} días hasta el vencimiento (puede ser negativo si venció)
 */
export function diasRestantesCotizacion(fecha, vigenciaDias) {
  if (!fecha) return null;
  const base = new Date(fecha).getTime();
  if (Number.isNaN(base)) return null;
  const vence = base + Number(vigenciaDias ?? 0) * MS_POR_DIA;
  return Math.ceil((vence - Date.now()) / MS_POR_DIA);
}

/**
 * Etiqueta de vencimiento de cotización a partir de los días restantes.
 * @param {number|null} dias
 * @returns {{ label: string, token: string }}
 */
export function vencimientoCotizacion(dias) {
  if (dias == null) return { label: "—", token: "--muted-foreground" };
  if (dias < 0)
    return { label: `vencida hace ${Math.abs(dias)}d`, token: "--destructive" };
  if (dias === 0) return { label: "vence hoy", token: "--destructive" };
  return { label: `${dias}d`, token: "--warning" };
}
