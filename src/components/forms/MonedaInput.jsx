import { useLayoutEffect, useRef } from "react";

// "always": algunos motores no agrupan los números de 4 cifras en español
// ("5000" en vez de "5.000").
const MILES = new Intl.NumberFormat("es-CO", {
  maximumFractionDigits: 0,
  useGrouping: "always",
});

/**
 * Input de pesos colombianos con separador de miles mientras se escribe:
 * muestra "$ 647.185" y le entrega al padre solo los dígitos ("647185").
 *
 * - Pesos enteros: el COP no se maneja con centavos en la operación.
 * - El padre guarda un string de dígitos (o ""), así `Number(value)` sigue
 *   funcionando igual que con el `<input type="number">` de antes.
 * - Conserva la posición del cursor contando los dígitos que quedan a su
 *   derecha; sin esto, cada punto que se agrega lo mandaba al final.
 */
export default function MonedaInput({
  value,
  onChange,
  maxDigits = 12,
  ...rest
}) {
  const ref = useRef(null);
  // Dígitos a la derecha del cursor tras el último cambio (null = no mover).
  const digitosDerechaRef = useRef(null);

  const digitos = String(value ?? "")
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "");
  const mostrado = digitos === "" ? "" : `$ ${MILES.format(Number(digitos))}`;

  useLayoutEffect(() => {
    const el = ref.current;
    const derecha = digitosDerechaRef.current;
    if (!el || derecha == null || document.activeElement !== el) return;
    digitosDerechaRef.current = null;
    let pos = mostrado.length;
    let vistos = 0;
    while (pos > 0 && vistos < derecha) {
      pos -= 1;
      if (/\d/.test(mostrado[pos])) vistos += 1;
    }
    try {
      el.setSelectionRange(pos, pos);
    } catch {
      /* algunos navegadores no lo permiten en ciertos estados */
    }
  });

  const handleChange = (e) => {
    const raw = e.target.value;
    const cursor = e.target.selectionStart ?? raw.length;
    digitosDerechaRef.current = raw.slice(cursor).replace(/\D/g, "").length;
    const nuevos = raw
      .replace(/\D/g, "")
      .replace(/^0+(?=\d)/, "")
      .slice(0, maxDigits);
    onChange(nuevos);
  };

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={mostrado}
      onChange={handleChange}
      {...rest}
    />
  );
}
