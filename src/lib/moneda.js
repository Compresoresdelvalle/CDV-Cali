/**
 * Lo que la persona escribió o pegó → solo los dígitos de los pesos.
 * Corta en la primera coma (centavos, que en COP no se manejan).
 */
export function digitosDeMonto(texto, maxDigits = 12) {
  return String(texto ?? "")
    .split(",")[0]
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "")
    .slice(0, maxDigits);
}
