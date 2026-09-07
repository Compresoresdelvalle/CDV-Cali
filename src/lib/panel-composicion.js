/**
 * El filtro de "peso en la venta", en un solo sitio.
 *
 * Vive aquí y no dentro del componente porque lo usan DOS cosas: la tabla que
 * se pinta y el botón que exporta. Si cada una tuviera su copia, el día que una
 * cambie el CSV dejaría de ser lo que se ve en pantalla sin que nadie lo note.
 */

/**
 * Umbrales de participación. El piso es 1% A PROPÓSITO: el servidor devuelve
 * los 100 grupos más grandes y, como mucho, 100 grupos pueden pesar 1% o más
 * cada uno, así que con ese umbral la tabla ya trae con seguridad todos los que
 * pasan el filtro. Con 0,5% podría haber hasta 200 candidatos y algunos se
 * quedarían afuera sin que nadie se entere.
 */
export const UMBRALES = [
  { id: 0, rotulo: "Todos" },
  { id: 0.01, rotulo: "≥ 1%" },
  { id: 0.03, rotulo: "≥ 3%" },
  { id: 0.05, rotulo: "≥ 5%" },
];

/** La venta total de todas las filas, incluida la del resto. */
export function ventaTotal(filas = []) {
  return filas.reduce((s, f) => s + Number(f.venta ?? 0), 0);
}

/**
 * Deja solo los grupos que pesan `minParte` o más de la venta.
 *
 * La fila "Otros N" sale siempre que haya filtro: es una bolsa de grupos que
 * justamente NO pasan el umbral, así que dejarla dentro contradiría el filtro
 * aunque su suma sí lo supere.
 */
export function filtrarPorPeso(filas = [], minParte = 0) {
  if (!minParte) return filas;
  const total = ventaTotal(filas);
  if (total <= 0) return [];
  return filas.filter(
    (f) => !f.es_resto && Number(f.venta ?? 0) / total >= minParte,
  );
}
