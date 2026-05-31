/**
 * Mapeos de presentación para el módulo Inventario (diseño Lovable).
 *
 * Convierte los valores REALES de la base de datos a las clases del sistema
 * de diseño portado (`.bdg`, `.dot-cat`, `.stk-pill`, `.dot-stk`).
 *
 * NO contiene lógica de datos — solo presentación.
 */

/**
 * Estado de stock real → clase de pill / dot del diseño.
 * Real: 'OK' | 'Bajo' | 'Agotado' (estado_stock de la tabla inventario).
 * Diseño: s (success) | w (warning) | d (danger) | n (neutral).
 * @param {string|null|undefined} estado
 * @returns {'s'|'w'|'d'|'n'}
 */
export function estadoStockClass(estado) {
  switch (estado) {
    case "OK":
      return "s";
    case "Bajo":
      return "w";
    case "Agotado":
      return "d";
    default:
      return "n";
  }
}

/**
 * Categoría real (texto libre) → clase de badge/dot de categoría.
 * Diseño: cmp | rpt | hrm | lbr | acc. Hace match por palabra clave;
 * si no reconoce la categoría devuelve `rpt` (repuestos, el más genérico).
 * @param {string|null|undefined} categoria
 * @returns {'cmp'|'rpt'|'hrm'|'lbr'|'acc'}
 */
export function categoriaClass(categoria) {
  const c = (categoria ?? "").toLowerCase();
  if (c.includes("compres")) return "cmp";
  if (c.includes("herramient")) return "hrm";
  if (c.includes("lubric") || c.includes("aceite") || c.includes("grasa"))
    return "lbr";
  if (c.includes("accesor")) return "acc";
  return "rpt";
}

/**
 * Etiqueta de ubicación física en BODEGA a partir de los campos del producto.
 * - en_piso → "Stand piso" (zona central, sin posición).
 * - stand (1-9) → "Stand N" o "Stand N · Pos P" si hay posición.
 * - sin datos → el fallback (por defecto "—").
 * @param {{stand?: number|null, posicion?: number|null, en_piso?: boolean}|null|undefined} p
 * @param {string} [fallback]
 * @returns {string}
 */
export function ubicacionLabel(p, fallback = "—") {
  if (!p) return fallback;
  if (p.en_piso) return "Stand piso";
  if (p.stand != null && p.stand !== "") {
    return `Stand ${p.stand}${p.posicion != null && p.posicion !== "" ? ` · Pos ${p.posicion}` : ""}`;
  }
  return fallback;
}
