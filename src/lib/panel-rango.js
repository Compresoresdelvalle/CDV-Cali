/**
 * Rangos de fecha del panel.
 *
 * Toda la aritmética vive aquí y se prueba sola: es lo que impide que el "mes
 * pasado" que se consulta y el "mes pasado" contra el que se compara se
 * desincronicen. Un desfase de un día aquí mueve todas las cifras del panel.
 *
 * Convención: los rangos se manejan como texto `YYYY-MM-DD` en hora de Colombia,
 * que es exactamente lo que esperan las RPC. Nunca se manda un `Date` al
 * servidor: la conversión de zona es justo donde se cuelan los errores de un día.
 */
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  differenceInCalendarDays,
  parseISO,
} from "date-fns";
import { es } from "date-fns/locale";

/**
 * Primer día con datos en producción. Antes de esto no hay nada que comparar, y
 * pintar un −100% contra la nada sería mentir.
 */
export const PRIMER_DIA_CON_DATOS = "2026-06-01";

const iso = (d) => format(d, "yyyy-MM-dd");

export const ATAJOS = [
  { id: "hoy", label: "Hoy" },
  { id: "ayer", label: "Ayer" },
  { id: "semana", label: "Esta semana" },
  { id: "mes", label: "Este mes" },
  { id: "mes_pasado", label: "Mes pasado" },
  { id: "ano", label: "Este año" },
  { id: "30d", label: "Últimos 30" },
  { id: "90d", label: "Últimos 90" },
];

/**
 * @param {string} id  uno de ATAJOS
 * @param {Date} [hoy] inyectable para poder probar sin depender del día real
 * @returns {{desde:string, hasta:string}}
 */
export function rangoDeAtajo(id, hoy = new Date()) {
  switch (id) {
    case "ayer": {
      const a = subDays(hoy, 1);
      return { desde: iso(a), hasta: iso(a) };
    }
    case "semana":
      // La semana arranca el lunes, como se cuenta aquí.
      return {
        desde: iso(startOfWeek(hoy, { weekStartsOn: 1 })),
        hasta: iso(hoy),
      };
    case "mes":
      // Hasta HOY, no hasta fin de mes: contar días que todavía no han pasado
      // haría ver una caída que no existe.
      return { desde: iso(startOfMonth(hoy)), hasta: iso(hoy) };
    case "mes_pasado": {
      const m = subMonths(hoy, 1);
      return { desde: iso(startOfMonth(m)), hasta: iso(endOfMonth(m)) };
    }
    case "ano":
      return { desde: iso(startOfYear(hoy)), hasta: iso(hoy) };
    case "30d":
      return { desde: iso(subDays(hoy, 29)), hasta: iso(hoy) };
    case "90d":
      return { desde: iso(subDays(hoy, 89)), hasta: iso(hoy) };
    case "hoy":
    default:
      return { desde: iso(hoy), hasta: iso(hoy) };
  }
}

/**
 * El periodo anterior equivalente: la misma cantidad de días, inmediatamente
 * antes. No es "el mes pasado": si se piden 12 días, compara contra los 12
 * anteriores, que es lo que hace comparable la cifra.
 */
export function periodoAnterior({ desde, hasta }) {
  const d = parseISO(desde);
  const h = parseISO(hasta);
  const dias = differenceInCalendarDays(h, d) + 1;
  const nuevoHasta = subDays(d, 1);
  return { desde: iso(subDays(nuevoHasta, dias - 1)), hasta: iso(nuevoHasta) };
}

/** ¿El periodo anterior cae dentro de los datos que existen? */
export function hayDatosParaComparar(rango) {
  return periodoAnterior(rango).desde >= PRIMER_DIA_CON_DATOS;
}

/**
 * El rango dicho en español, que es lo que va debajo de los chips. Es la frase
 * que evita tener que adivinar qué periodo está aplicado.
 */
export function etiquetaRango({ desde, hasta }) {
  const d = parseISO(desde);
  const h = parseISO(hasta);
  const opt = { locale: es };

  if (desde === hasta) return format(d, "d 'de' MMMM 'de' yyyy", opt);

  const mismoAno = format(d, "yyyy") === format(h, "yyyy");
  const mismoMes = mismoAno && format(d, "MM") === format(h, "MM");

  if (mismoMes) {
    return `Del ${format(d, "d", opt)} al ${format(h, "d 'de' MMMM 'de' yyyy", opt)}`;
  }
  if (mismoAno) {
    return `Del ${format(d, "d 'de' MMMM", opt)} al ${format(h, "d 'de' MMMM 'de' yyyy", opt)}`;
  }
  return `Del ${format(d, "d 'de' MMMM 'de' yyyy", opt)} al ${format(h, "d 'de' MMMM 'de' yyyy", opt)}`;
}
