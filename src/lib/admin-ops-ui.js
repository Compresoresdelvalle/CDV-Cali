/**
 * Helpers de presentación para las páginas operativas del Panel Admin
 * (diseño Lovable "cockpit", tema oscuro de `.admin-shell`).
 *
 * Solo presentación: formateo, mapeos de tokens semánticos e iniciales.
 * NO contiene lógica de datos ni fetching. Las páginas siguen consumiendo
 * sus queries/RPC reales (movimientos, conteos, cierres, notas crédito).
 */

/**
 * Token semántico para un tipo de movimiento de inventario.
 * Salidas → destructive, entradas → success, ajustes → warning, otro → muted.
 * @param {string|null|undefined} tipo
 * @returns {string} nombre de variable CSS sin `hsl(var(...))`
 */
export function movimientoToken(tipo) {
  const salidas = [
    "venta",
    "traspaso_salida",
    "ensamble_consumo",
    "orden_consumo",
  ];
  const entradas = [
    "compra",
    "traspaso_entrada",
    "devolucion",
    "ensamble_produccion",
  ];
  if (salidas.includes(tipo)) return "--destructive";
  if (entradas.includes(tipo)) return "--success";
  if (tipo === "ajuste" || tipo === "conteo_ajuste") return "--warning";
  return "--muted-foreground";
}

/** Etiqueta legible (sin guiones bajos) de un tipo de movimiento. */
export function movimientoLabel(tipo) {
  if (!tipo) return "—";
  return tipo.replace(/_/g, " ");
}

/**
 * Iniciales (máx. 2) a partir de un nombre, para avatares de usuario.
 * @param {string|null|undefined} nombre
 * @returns {string}
 */
export function iniciales(nombre) {
  const partes = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "—";
  return partes
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Token semántico según el signo de una diferencia/delta de stock.
 * 0 → success (cuadrado), positivo → info (sobrante), negativo → destructive.
 * @param {number} diff
 * @returns {string} nombre de variable CSS sin `hsl(var(...))`
 */
export function diferenciaToken(diff) {
  if (diff === 0) return "--success";
  if (diff > 0) return "--info";
  return "--destructive";
}

/**
 * Estilos inline (fondo translúcido + texto + borde) para un badge/pill
 * a partir de un token semántico, respetando el tema oscuro.
 * @param {string} token nombre de variable CSS sin `hsl(var(...))`
 * @returns {{ backgroundColor: string, color: string, borderColor: string }}
 */
export function pillStyle(token) {
  return {
    backgroundColor: `hsl(var(${token}) / 0.12)`,
    color: `hsl(var(${token}))`,
    borderColor: `hsl(var(${token}) / 0.4)`,
  };
}

/**
 * Estilos inline para un input/select en superficie de card (tema oscuro).
 * @returns {{ backgroundColor: string, borderColor: string, color: string }}
 */
export const surfaceInputStyle = {
  backgroundColor: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
  color: "hsl(var(--foreground))",
};

/**
 * Módulo legible (origen funcional) de un tipo de movimiento de inventario.
 * Sirve para la columna "Módulo" del registro de actividad (diseño Lovable),
 * derivado del `tipo` real — no es un campo inventado.
 * @param {string|null|undefined} tipo
 * @returns {string}
 */
export function movimientoModulo(tipo) {
  const map = {
    venta: "Ventas",
    compra: "Compras",
    traspaso_salida: "Traspasos",
    traspaso_entrada: "Traspasos",
    ajuste: "Inventario",
    conteo_ajuste: "Conteo",
    ensamble_consumo: "Ensambles",
    ensamble_produccion: "Ensambles",
    devolucion: "Devoluciones",
    orden_consumo: "Órdenes de servicio",
  };
  return map[tipo] ?? "Sistema";
}

/**
 * Estilos inline (pill redondeada estilo Lovable) para la clasificación ABC.
 * A → destructive (alto valor), B → warning (medio), C → muted (cola larga).
 * @param {string|null|undefined} clase
 * @returns {{ backgroundColor: string, color: string, borderColor: string }}
 */
export function clasePillStyle(clase) {
  const token =
    clase === "A" ? "--destructive" : clase === "B" ? "--warning" : null;
  if (!token) {
    return {
      backgroundColor: "hsl(var(--muted) / 0.5)",
      color: "hsl(var(--muted-foreground))",
      borderColor: "hsl(var(--border))",
    };
  }
  return pillStyle(token);
}
