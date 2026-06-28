/**
 * Interpreta un término de la barra de búsqueda como FECHA y devuelve un rango
 * { desde, hasta } en ISO con límites de día/mes en zona America/Bogota
 * (UTC-5, sin horario de verano), listo para filtrar una columna `timestamptz`
 * con `.gte(desde)` / `.lte(hasta)`. Devuelve `null` si el término no es una
 * fecha (entonces el listado se comporta como siempre con su búsqueda de texto).
 *
 * Formatos aceptados (separador `/` o `-`):
 *   - `dd/mm/aaaa`  → ese día
 *   - `mm/aaaa`     → ese mes completo
 *   - `dd/mm`       → ese día del año actual
 *
 * Se omite a propósito el año suelto (`aaaa`) para no chocar con la búsqueda
 * por número de documento.
 */

const TZ = "-05:00"; // America/Bogota (sin DST)

const pad = (n) => String(n).padStart(2, "0");

// Último día del mes (mo es 1-based).
const ultimoDia = (anio, mo) => new Date(anio, mo, 0).getDate();

const rango = (desdeLocal, hastaLocal) => ({
  desde: `${desdeLocal}${TZ}`,
  hasta: `${hastaLocal}${TZ}`,
});

const dia = (anio, mo, d) =>
  rango(
    `${anio}-${pad(mo)}-${pad(d)}T00:00:00.000`,
    `${anio}-${pad(mo)}-${pad(d)}T23:59:59.999`,
  );

export function parseRangoFecha(term) {
  const t = (term ?? "").trim();
  if (!t) return null;

  const anioValido = (a) => a >= 2000 && a <= 2100;
  const mesValido = (m) => m >= 1 && m <= 12;

  // dd/mm/aaaa
  let m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const d = +m[1],
      mo = +m[2],
      anio = +m[3];
    if (!mesValido(mo) || !anioValido(anio) || d < 1 || d > ultimoDia(anio, mo))
      return null;
    return dia(anio, mo, d);
  }

  // mm/aaaa
  m = t.match(/^(\d{1,2})[/-](\d{4})$/);
  if (m) {
    const mo = +m[1],
      anio = +m[2];
    if (!mesValido(mo) || !anioValido(anio)) return null;
    return rango(
      `${anio}-${pad(mo)}-01T00:00:00.000`,
      `${anio}-${pad(mo)}-${pad(ultimoDia(anio, mo))}T23:59:59.999`,
    );
  }

  // dd/mm (año actual)
  m = t.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (m) {
    const d = +m[1],
      mo = +m[2],
      anio = new Date().getFullYear();
    if (!mesValido(mo) || d < 1 || d > ultimoDia(anio, mo)) return null;
    return dia(anio, mo, d);
  }

  return null;
}

/**
 * ¿La fecha (ISO/timestamptz) cae dentro del rango? Compara por instante
 * (`Date`) para ser correcto aunque las zonas/offsets difieran. Para filtrado
 * en memoria cuando el listado ya cargó todos los registros.
 */
export function coincideRangoFecha(fecha, rango) {
  if (!rango || !fecha) return false;
  const t = new Date(fecha).getTime();
  return (
    t >= new Date(rango.desde).getTime() && t <= new Date(rango.hasta).getTime()
  );
}
