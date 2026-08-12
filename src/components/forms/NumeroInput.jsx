import { useState, useEffect, useRef } from "react";

/**
 * Input numérico controlado que SÍ se puede vaciar mientras se edita.
 *
 * Problema que resuelve (reporte de la clienta): los inputs numéricos ataban el
 * `value` a un Number y el `onChange` del padre ignoraba el vacío
 * (`parseFloat("")` = NaN → `return`), así que al borrar siempre quedaba el
 * número viejo y no se podía teclear uno nuevo desde cero — peor en celular,
 * donde ni seleccionando se limpiaba.
 *
 * Comportamiento:
 *  - Mantiene su propio texto local: se puede dejar VACÍO mientras se edita.
 *  - Al enfocar selecciona todo (un toque en celular y el siguiente dígito
 *    reemplaza).
 *  - Propaga el número al padre en vivo cuando el texto es válido; si está
 *    vacío no propaga (el padre conserva su último valor).
 *  - Al salir del campo (blur) normaliza: vacío/inválido → `min` (o
 *    `emptyValue`); si hay número, lo acota a `[min, max]`.
 *
 * El padre sigue guardando un Number; este componente solo maneja la UX del
 * texto. Se puede seguir usando junto a botones +/- (se sincroniza al cambiar
 * `value` desde afuera).
 */
export default function NumeroInput({
  value,
  onChange,
  min = 0,
  max,
  emptyValue,
  selectOnFocus = true,
  ...rest
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const editingRef = useRef(false);

  // Sincroniza desde el padre SOLO cuando no se está editando (p.ej. los
  // botones +/-). Mientras se edita no se pisa lo que el usuario escribe.
  useEffect(() => {
    if (!editingRef.current) setText(value == null ? "" : String(value));
  }, [value]);

  const fallback = emptyValue != null ? emptyValue : min;
  const clampMax = (n) => (max != null ? Math.min(max, n) : n);

  const handleChange = (e) => {
    const raw = e.target.value;
    setText(raw);
    if (raw === "") return; // vacío permitido: no se propaga
    const n = parseFloat(raw);
    if (isNaN(n)) return;
    // No se acota al MÍN en vivo (para poder teclear dígito a dígito); solo al
    // máximo. El mínimo se aplica al salir del campo.
    onChange(clampMax(Math.max(0, n)));
  };

  const handleFocus = (e) => {
    editingRef.current = true;
    if (selectOnFocus) {
      // requestAnimationFrame: en algunos móviles select() inmediato no toma.
      requestAnimationFrame(() => {
        try {
          e.target.select();
        } catch {
          /* noop */
        }
      });
    }
  };

  const handleBlur = () => {
    editingRef.current = false;
    const n = parseFloat(text);
    const final =
      text === "" || isNaN(n) ? fallback : clampMax(Math.max(min, n));
    setText(String(final));
    onChange(final);
  };

  return (
    <input
      type="number"
      inputMode="decimal"
      value={text}
      min={min}
      max={max}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      {...rest}
    />
  );
}
