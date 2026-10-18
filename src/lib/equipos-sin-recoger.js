/**
 * Alertas → "Equipos sin recoger" (vista v_ot_alertas_30_dias).
 *
 * Solo presentación: severidad por días sin movimiento, enlace para llamar y
 * orden de la lista. Sin fetching, para poder probarlo sin montar la pantalla.
 */

/** Días por defecto del parámetro dias_alerta_ot_abandonada (igual que la vista). */
export const DIAS_ALERTA_OT_DEFAULT = 30;

/**
 * Días de más, sobre el parámetro, a partir de los cuales la alerta pasa a
 * urgente. Relativo al parámetro: con un 45 fijo, si el Admin subía el
 * parámetro a 60 TODAS las filas salían urgentes desde el primer día.
 */
export const MARGEN_URGENTE_SIN_RECOGER = 15;

/**
 * Token de severidad de la fila según los días sin movimiento: urgente si
 * pasa de `diasAlerta` (parámetro dias_alerta_ot_abandonada) + 15.
 */
export function severidadSinRecoger(dias, diasAlerta = DIAS_ALERTA_OT_DEFAULT) {
  const umbral =
    (Number(diasAlerta) > 0 ? Number(diasAlerta) : DIAS_ALERTA_OT_DEFAULT) +
    MARGEN_URGENTE_SIN_RECOGER;
  return (Number(dias) || 0) > umbral ? "--destructive" : "--warning";
}

/**
 * Sede donde está HOY el equipo (la vista la trae en `sede_equipo`); si no,
 * la sede de la OT. Es la que sirve para filtrar: se va a buscar el equipo.
 */
export function sedeDelEquipo(r) {
  return r?.sede_equipo ?? r?.sede_id ?? null;
}

/**
 * `tel:` listo para tocar desde el celular, o null si no hay un número usable.
 * Quita espacios, puntos, guiones y paréntesis; conserva el "+" inicial.
 */
export function telHref(telefono) {
  const t = String(telefono ?? "").trim();
  if (!t) return null;
  const mas = t.startsWith("+") ? "+" : "";
  const digitos = t.replace(/\D/g, "");
  if (digitos.length < 7) return null;
  return `tel:${mas}${digitos}`;
}

/** Más días sin movimiento primero; a igualdad, la OT más vieja primero. */
export function ordenarSinRecoger(filas = []) {
  return [...filas].sort(
    (a, b) =>
      (Number(b.dias_sin_movimiento) || 0) -
        (Number(a.dias_sin_movimiento) || 0) ||
      (Number(a.numero) || 0) - (Number(b.numero) || 0),
  );
}

/** "1 día" / "N días". */
export function diasLabel(dias) {
  const n = Number(dias) || 0;
  return n === 1 ? "1 día" : `${n} días`;
}
