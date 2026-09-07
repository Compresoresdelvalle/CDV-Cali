/**
 * Exportar a CSV lo que se ve en pantalla.
 *
 * Sin dependencias nuevas: `Blob` + `<a download>`. Un CSV se abre en Excel, en
 * Google Sheets y en el correo del contador; agregar una librería de xlsx a la
 * build por esto no se paga.
 *
 * El separador es `;` a propósito. Excel en español interpreta la coma como
 * separador decimal, así que un CSV separado por comas le cae todo en una sola
 * columna. Con `;` abre bien de doble clic, que es como lo va a abrir quien lo
 * descargue.
 */

/** Necesitan comillas los campos con el separador, coma, comilla o salto. */
const NECESITA_COMILLAS = /[;,"\n\r]/;

function campo(v) {
  if (v == null) return "";
  const s = String(v);
  // Los nombres de esta empresa traen comillas y comas de verdad
  // (FILTRO 1/2", ROSCA), que es justo lo que rompe un CSV mal escapado: la
  // comilla se duplica y el campo entero va entre comillas.
  return NECESITA_COMILLAS.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Arma el CSV. `columnas` es [{ clave, titulo }] en el orden en que se quieren.
 */
export function aCSV(filas, columnas) {
  const lineas = [columnas.map((c) => campo(c.titulo)).join(";")];
  for (const f of filas) {
    lineas.push(columnas.map((c) => campo(f[c.clave])).join(";"));
  }
  return lineas.join("\n");
}

/**
 * Nombre de archivo que dice qué es y de cuándo:
 * `panel-perdidas-2026-09-01-a-2026-09-30.csv`.
 */
export function nombreArchivo(base, rango) {
  return rango?.desde && rango?.hasta
    ? `${base}-${rango.desde}-a-${rango.hasta}.csv`
    : `${base}.csv`;
}

/**
 * Dispara la descarga. El BOM va aquí y no en `aCSV` para que la función que
 * arma el texto siga siendo comparable en las pruebas; sin BOM, Excel abre el
 * archivo en la codificación del sistema y "Categoría" sale rota.
 */
export function descargarCSV(nombre, csv) {
  // Se construye con fromCharCode y no como carácter literal: un BOM escrito
  // dentro del fuente es invisible al leer el archivo y el linter lo reporta
  // como espacio irregular, con razón.
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom + csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Sin esto el blob queda en memoria hasta que se recargue la pestaña.
  URL.revokeObjectURL(url);
}
