/**
 * Filtros reales para los listados — lógica pura (sin React).
 *
 * Por qué existe: cada pantalla resolvía la búsqueda a su manera y cada una
 * volvía a pisar las mismas trampas — la zona horaria de Bogotá, que `numero`
 * es integer y revienta con `ilike`, olvidar resetear la paginación, y contar
 * lo cargado en vez de preguntarle el total al servidor. Aquí se resuelven una
 * sola vez.
 *
 * Convención de rangos: `{ desde, hasta }` en ISO con offset `-05:00`, igual
 * que `busquedaFecha.js`, para usar con `.gte(desde)` / `.lte(hasta)` sobre una
 * columna `timestamptz`. NUNCA castear la columna (`fecha::date`) — eso mata el
 * índice y además interpreta el día en UTC, no en Bogotá.
 */

import { applyKeywordSearch } from "./search";

const TZ = "-05:00"; // America/Bogota — sin horario de verano, siempre UTC-5.

const pad = (n) => String(n).padStart(2, "0");

/** Fecha de HOY en Bogotá como 'YYYY-MM-DD' (no la del navegador). */
export function hoyBogota() {
  // 'en-CA' produce YYYY-MM-DD. El timeZone hace el trabajo real: un operario
  // en Colombia y el servidor coinciden aunque el equipo tenga otra zona.
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

/** Suma días a un 'YYYY-MM-DD' y devuelve otro 'YYYY-MM-DD'. */
export function sumarDias(fechaISO, dias) {
  const [a, m, d] = fechaISO.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Convierte dos fechas de calendario ('YYYY-MM-DD', las que da `<input
 * type="date">`) en un rango de instantes de Bogotá.
 * Cualquiera de las dos puede ir vacía: "desde el 1 en adelante" o "hasta el 15".
 * @returns {{desde: string|null, hasta: string|null}|null}
 */
export function rangoBogota(desdeDia, hastaDia) {
  if (!desdeDia && !hastaDia) return null;
  return {
    desde: desdeDia ? `${desdeDia}T00:00:00.000${TZ}` : null,
    hasta: hastaDia ? `${hastaDia}T23:59:59.999${TZ}` : null,
  };
}

/** Presets del selector de fechas. Devuelven `{ desdeDia, hastaDia }`. */
export const PRESETS_FECHA = {
  hoy: {
    label: "Hoy",
    calcular: () => {
      const h = hoyBogota();
      return { desdeDia: h, hastaDia: h };
    },
  },
  semana: {
    label: "Esta semana",
    calcular: () => {
      // Semana de lunes a hoy (no "últimos 7 días"): es como cuadra la gente.
      const h = hoyBogota();
      const [a, m, d] = h.split("-").map(Number);
      const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0=dom
      const atras = dow === 0 ? 6 : dow - 1;
      return { desdeDia: sumarDias(h, -atras), hastaDia: h };
    },
  },
  mes: {
    label: "Este mes",
    calcular: () => {
      const h = hoyBogota();
      return { desdeDia: `${h.slice(0, 7)}-01`, hastaDia: h };
    },
  },
  mesPasado: {
    label: "Mes pasado",
    calcular: () => {
      const h = hoyBogota();
      const [a, m] = h.split("-").map(Number);
      const anio = m === 1 ? a - 1 : a;
      const mes = m === 1 ? 12 : m - 1;
      const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
      return {
        desdeDia: `${anio}-${pad(mes)}-01`,
        hastaDia: `${anio}-${pad(mes)}-${pad(ultimo)}`,
      };
    },
  },
};

/** ¿El término es un entero puro? (para buscar por # de documento). */
export function esNumeroPuro(raw) {
  const t = (raw ?? "").trim().replace(/^#/, "");
  return /^\d+$/.test(t) ? Number(t) : null;
}

/**
 * Aplica un filtro de texto a la consulta.
 *
 * Dos caminos, y la distinción importa: si el operario escribe "873" casi
 * siempre quiere ESA factura, no todo lo que contenga 873. Además `numero` es
 * integer y un `ilike` contra integer revienta en Postgres.
 *
 * @param {object} q Query builder de supabase-js.
 * @param {string} raw Texto CRUDO (el saneo pasa adentro; sanear dos veces
 *   dobla el escape de los wildcards).
 * @param {{columnas?: string[], numericoA?: string}} cfg
 */
export function aplicarTexto(q, raw, cfg = {}) {
  const t = (raw ?? "").trim();
  if (!t) return q;
  const n = esNumeroPuro(t);
  if (n != null && cfg.numericoA) return q.eq(cfg.numericoA, n);
  if (!cfg.columnas?.length) return q;
  return applyKeywordSearch(q, t, cfg.columnas);
}

/** Aplica un rango de fechas (de `rangoBogota`) a una columna timestamptz. */
export function aplicarRango(q, columna, rango) {
  if (!rango) return q;
  let out = q;
  if (rango.desde) out = out.gte(columna, rango.desde);
  if (rango.hasta) out = out.lte(columna, rango.hasta);
  return out;
}

/**
 * Aplica un filtro de opción (chip/select).
 *
 * `ilike-exacto` = igualdad insensible a mayúsculas, SIN comodines. Se usa para
 * los métodos de pago: en la base conviven 'Efectivo' y algún 'efectivo' suelto,
 * y con `.eq()` ese registro se caería del reporte sin avisar.
 */
export function aplicarOpcion(q, columna, valor, comparador = "eq") {
  if (valor == null || valor === "" || valor === "Todos") return q;
  if (comparador === "ilike-exacto") return q.ilike(columna, String(valor));
  return q.eq(columna, valor);
}

/** Etiqueta legible de un rango, para el chip de "filtro activo". */
export function etiquetaRango({ desdeDia, hastaDia }) {
  const corto = (d) => {
    const [, m, dd] = d.split("-");
    return `${dd}/${m}`;
  };
  if (desdeDia && hastaDia) {
    return desdeDia === hastaDia
      ? corto(desdeDia)
      : `${corto(desdeDia)} – ${corto(hastaDia)}`;
  }
  if (desdeDia) return `desde ${corto(desdeDia)}`;
  return `hasta ${corto(hastaDia)}`;
}
