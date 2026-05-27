/**
 * Helpers de presentación para las páginas de analítica del Panel Admin
 * (diseño Lovable "cockpit", tema oscuro de `.admin-shell`).
 *
 * Solo presentación: formateo y mapeos de tokens. NO contiene lógica de datos
 * ni fetching. Las páginas siguen consumiendo sus queries/RPC reales.
 */

/**
 * Token semántico para una clasificación ABC.
 * A → success, B → warning, C → destructive (cola larga). Otro → muted.
 * @param {string|null|undefined} clase
 * @returns {string} nombre de variable CSS sin `hsl(var(...))`
 */
export function clasificacionToken(clase) {
  switch (clase) {
    case "A":
      return "--success";
    case "B":
      return "--warning";
    case "C":
      return "--destructive";
    default:
      return "--muted-foreground";
  }
}

/**
 * Estilos inline (fondo translúcido + texto + borde) para un badge de
 * clasificación ABC, respetando el tema oscuro vía tokens semánticos.
 * @param {string|null|undefined} clase
 * @returns {{ backgroundColor: string, color: string, borderColor: string }}
 */
export function abcBadgeStyle(clase) {
  const token = clasificacionToken(clase);
  return {
    backgroundColor: `hsl(var(${token}) / 0.15)`,
    color: `hsl(var(${token}))`,
    borderColor: `hsl(var(${token}) / 0.4)`,
  };
}

/**
 * Severidad de una alerta de stock → token semántico del punto/indicador.
 * 'Agotado' es crítico (destructive); el resto es advertencia (warning).
 * @param {string|null|undefined} estadoStock
 * @returns {{ token: string, label: string }}
 */
export function severidadStock(estadoStock) {
  if (estadoStock === "Agotado")
    return { token: "--destructive", label: "Urgente" };
  return { token: "--warning", label: "Alta" };
}

/**
 * Días transcurridos desde una fecha ISO hasta ahora (entero, mínimo 0).
 * @param {string|number|Date|null|undefined} fecha
 * @returns {number}
 */
export function diasDesde(fecha) {
  if (!fecha) return 0;
  const ms = Date.now() - new Date(fecha).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Severidad de una alerta como token + etiqueta, derivada del modelo de
 * "danger | warn | info" del diseño Lovable. Mapea a tokens semánticos
 * (dark-safe) del `.admin-shell`.
 * @param {"danger"|"warn"|"info"} sev
 * @returns {{ token: string, label: string }}
 */
export function severidadAlerta(sev) {
  if (sev === "danger") return { token: "--destructive", label: "Urgente" };
  if (sev === "warn") return { token: "--warning", label: "Alta" };
  return { token: "--info", label: "Media" };
}

/**
 * Variación porcentual entre un valor actual y uno previo.
 * Devuelve `null` cuando no hay base de comparación (previo = 0) para evitar
 * porcentajes engañosos (división por cero). Nunca inventa una referencia.
 * @param {number} actual
 * @param {number} previo
 * @returns {number|null}
 */
export function variacionPct(actual, previo) {
  const a = Number(actual) || 0;
  const p = Number(previo) || 0;
  if (p === 0) return null;
  return ((a - p) / p) * 100;
}

/**
 * Token semántico para una variación: positiva → success, negativa →
 * destructive, sin referencia → muted.
 * @param {number|null} pct
 * @returns {string}
 */
export function variacionToken(pct) {
  if (pct == null) return "--muted-foreground";
  return pct >= 0 ? "--success" : "--destructive";
}

/** Opciones de periodo para los rankings (mapea a `p_dias`). */
export const PERIODOS_RANKING = [
  { dias: 30, label: "Último mes" },
  { dias: 90, label: "Último trimestre" },
  { dias: 365, label: "Último año" },
];

/** Etiqueta legible de un periodo de ranking a partir de los días. */
export function labelPeriodoRanking(dias) {
  return PERIODOS_RANKING.find((p) => p.dias === dias)?.label ?? `${dias} días`;
}

/** Medalla (emoji) para las primeras tres posiciones de un ranking. */
export function medallaRanking(pos) {
  if (pos === 1) return "🥇";
  if (pos === 2) return "🥈";
  if (pos === 3) return "🥉";
  return null;
}

/**
 * Estilos inline (fondo translúcido + texto + borde) para un badge con tono
 * semántico arbitrario, respetando el tema oscuro vía tokens.
 * @param {string} token  nombre de variable CSS sin `hsl(var(...))`
 * @returns {{ backgroundColor: string, color: string, borderColor: string }}
 */
export function tonoBadgeStyle(token) {
  return {
    backgroundColor: `hsl(var(${token}) / 0.12)`,
    color: `hsl(var(${token}))`,
    borderColor: `hsl(var(${token}) / 0.4)`,
  };
}
