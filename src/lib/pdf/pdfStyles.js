/**
 * Estilos compartidos del generador PDF de cotizaciones (Fase 11).
 *
 * Tamaño: carta (216 × 279 mm) — decisión §1.11 del cliente.
 *
 * Texto fijo de condiciones de entrega (§1.9 del cliente — INMUTABLE):
 */

export const TEXTO_CONDICIONES_ENTREGA =
  "El producto se entrega únicamente en nuestras instalaciones sin ningún " +
  "costo. Fuera de nuestras instalaciones el flete corre por cuenta del cliente.";

// Marca de la empresa
export const MARCA = {
  nombre: "Compresores del Valle S.A.S.",
  ciudad: "Cali, Colombia",
  // Email/teléfono van vacíos por ahora — Admin puede llenar en config futura
};

// Paleta corporativa (sincronizada con tokens CSS hsl(var(--primary)))
export const COLORES = {
  primario: [36, 90, 140], // #245A8C — azul corporativo
  textoOscuro: [31, 41, 55], // #1F2937
  textoMedio: [107, 114, 128], // #6B7280
  textoClaro: [156, 163, 175], // #9CA3AF
  borde: [229, 231, 235], // #E5E7EB
  fondo: [249, 250, 251], // #F9FAFB
};

// Layout en mm
export const LAYOUT = {
  pageWidth: 216,
  pageHeight: 279,
  margenIzq: 15,
  margenDer: 15,
  margenSup: 15,
  margenInf: 15,
  contentWidth: 216 - 30, // 186mm
};

// Formateo COP — sin decimales, con separador miles "."
export function formatCOP(n) {
  const num = Number(n) || 0;
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}
