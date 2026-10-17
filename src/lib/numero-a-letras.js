/**
 * Monto en letras, en español de Colombia, para comprobantes impresos.
 *
 *   montoEnLetras(647185) → "Seiscientos cuarenta y siete mil ciento ochenta y cinco pesos"
 *   montoEnLetras(1000000) → "Un millón de pesos"
 *   montoEnLetras(21000) → "Veintiún mil pesos"
 *
 * Reglas que suelen salir mal y aquí se cuidan:
 *   - "mil", nunca "un mil"; pero "un millón" y "veintiún millones".
 *   - "uno" se acorta a "un" delante de un sustantivo (mil, millón, pesos):
 *     "treinta y un mil", "veintiún pesos", "un peso".
 *   - "cien" solo, "ciento" cuando sigue algo.
 *   - Cuando el número termina en millones redondos va "de pesos".
 *
 * El peso colombiano no se escribe con centavos en estos documentos: el monto
 * se redondea a pesos enteros. Es una función pura, sin dependencias.
 */

const UNIDADES = [
  "cero",
  "uno",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciséis",
  "diecisiete",
  "dieciocho",
  "diecinueve",
  "veinte",
  "veintiuno",
  "veintidós",
  "veintitrés",
  "veinticuatro",
  "veinticinco",
  "veintiséis",
  "veintisiete",
  "veintiocho",
  "veintinueve",
];

const DECENAS = [
  "",
  "",
  "",
  "treinta",
  "cuarenta",
  "cincuenta",
  "sesenta",
  "setenta",
  "ochenta",
  "noventa",
];

const CENTENAS = [
  "",
  "ciento",
  "doscientos",
  "trescientos",
  "cuatrocientos",
  "quinientos",
  "seiscientos",
  "setecientos",
  "ochocientos",
  "novecientos",
];

// 1..99. `corto` = va delante de un sustantivo ("un", "veintiún").
function decenas(n, corto) {
  if (n < 30) {
    if (corto && n === 1) return "un";
    if (corto && n === 21) return "veintiún";
    return UNIDADES[n];
  }
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (u === 0) return DECENAS[d];
  return `${DECENAS[d]} y ${corto && u === 1 ? "un" : UNIDADES[u]}`;
}

// 1..999
function centenas(n, corto) {
  if (n === 100) return "cien";
  const c = Math.floor(n / 100);
  const r = n % 100;
  if (c === 0) return decenas(r, corto);
  return r === 0 ? CENTENAS[c] : `${CENTENAS[c]} ${decenas(r, corto)}`;
}

// 1..999.999
function menorQueMillon(n, corto) {
  const miles = Math.floor(n / 1000);
  const resto = n % 1000;
  const partes = [];
  if (miles === 1) partes.push("mil");
  else if (miles > 1) partes.push(`${centenas(miles, true)} mil`);
  if (resto > 0) partes.push(centenas(resto, corto));
  return partes.join(" ");
}

/**
 * Entero no negativo en palabras (minúsculas). `corto` acorta el "uno" final
 * a "un" porque lo sigue un sustantivo.
 * @param {number} n
 * @param {boolean} [corto=false]
 */
export function enteroEnLetras(n, corto = false) {
  if (n === 0) return "cero";
  const billones = Math.floor(n / 1e12);
  const millones = Math.floor(n / 1e6) % 1e6;
  const resto = n % 1e6;
  const partes = [];
  if (billones > 0) {
    partes.push(
      billones === 1
        ? "un billón"
        : `${menorQueMillon(billones, true)} billones`,
    );
  }
  if (millones > 0) {
    partes.push(
      millones === 1
        ? "un millón"
        : `${menorQueMillon(millones, true)} millones`,
    );
  }
  if (resto > 0) partes.push(menorQueMillon(resto, corto));
  return partes.join(" ");
}

/**
 * Monto en pesos, en letras y con la primera letra en mayúscula.
 * Devuelve "" si el valor no es un número.
 * @param {number|string|null|undefined} monto
 * @returns {string}
 */
export function montoEnLetras(monto) {
  const v = Number(monto);
  if (monto == null || monto === "" || !Number.isFinite(v)) return "";
  const n = Math.round(Math.abs(v));
  let texto = enteroEnLetras(n, true);
  if (n !== 0 && n % 1e6 === 0) texto += " de";
  texto += n === 1 ? " peso" : " pesos";
  if (v < 0 && n !== 0) texto = `menos ${texto}`;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
