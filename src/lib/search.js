import { sanitizeSearch } from "./utils";

// #32 — Búsqueda por palabras clave.
//
// El problema: un solo `col.ilike.%texto%` exige que el texto aparezca como
// substring CONTIGUO. Buscar "compresor 5hp" no encuentra "Compresor
// industrial 5HP". La solución: partir el texto en palabras y exigir que CADA
// palabra aparezca en alguna de las columnas (AND entre palabras, OR entre
// columnas).
//
// Tope de palabras para no generar una URL gigante con muchos `or=(...)`.
const MAX_TERMINOS = 6;

/**
 * Parte el texto en palabras de búsqueda ya saneadas (sin comas ni
 * metacaracteres de PostgREST). Reusa `sanitizeSearch`, que escapa `% _ \` y
 * elimina `, . * ( ) :` — por eso las palabras resultantes son seguras dentro
 * de un filtro `.or()`.
 *
 * @param {string} raw  Texto crudo escrito por el usuario.
 * @param {number} [max]  Tope de palabras (por defecto 6).
 * @returns {string[]}
 */
export function keywordTerms(raw, max = MAX_TERMINOS) {
  return sanitizeSearch(raw).split(/\s+/).filter(Boolean).slice(0, max);
}

/**
 * Aplica búsqueda por palabras clave a un query builder de supabase-js.
 *
 * Para cada palabra encadena un `.or(col1.ilike.%palabra%,col2.ilike.…)`.
 * PostgREST une los distintos `or=(...)` con AND, logrando "todas las palabras
 * deben aparecer (cada una en alguna columna)". Si no hay palabras, devuelve el
 * query sin tocar.
 *
 * IMPORTANTE: pasar el texto CRUDO (sin `sanitizeSearch` previo). El helper
 * sanea internamente; sanear dos veces dobla el escape de los wildcards.
 *
 * @template Q
 * @param {Q} query  Query builder de supabase-js.
 * @param {string} raw  Texto crudo de búsqueda.
 * @param {string[]} columns  Columnas donde buscar cada palabra.
 * @returns {Q}
 */
export function applyKeywordSearch(query, raw, columns) {
  const terms = keywordTerms(raw);
  let q = query;
  for (const term of terms) {
    q = q.or(columns.map((c) => `${c}.ilike.%${term}%`).join(","));
  }
  return q;
}
