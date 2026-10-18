import { useLayoutEffect, useRef } from "react";
import { digitosDeMonto } from "../../lib/moneda";

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
    // El campo nunca muestra comas: si aparece una, la escribió o la pegó la
    // persona ("150.000,50") y lo que sigue son centavos, que en COP no se
    // manejan. Sin este corte "150.000,50" se volvía 15.000.050.
    const raw = e.target.value.split(",")[0];
    const cursor = e.target.selectionStart ?? raw.length;
    digitosDerechaRef.current = raw.slice(cursor).replace(/\D/g, "").length;
    onChange(digitosDeMonto(raw, maxDigits));
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
