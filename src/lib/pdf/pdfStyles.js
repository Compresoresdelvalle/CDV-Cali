/**
 * Estilos compartidos del generador PDF de cotizaciones (Fase 11).
 *
 * Tamaño: carta (216 × 279 mm) — decisión §1.11 del cliente.
 */

// Texto fijo de "Condiciones de entrega" que va en el PDF de cotización
// (incluye la nota de garantías). Fuente única para el generador y el preview.
export const TEXTO_ENTREGA_COTIZACION =
  "El producto se entrega únicamente en nuestras instalaciones sin ningún costo. " +
  "Fuera de nuestras instalaciones el flete corre por cuenta del cliente. " +
  "Las garantías aplican según política de fábrica del producto.";

// Condiciones que se muestran en el paso 3 de Cotizaciones (nueva y edición).
// Vivía copiado en CotizacionNueva.jsx y CotizacionEditar.jsx; se unifica aquí
// porque tenerlo por duplicado es justo por qué la mención al embalaje
// sobrevivió tanto: se corregía en un sitio y no en el otro.
// Sin la nota de embalaje: la empresa no presta ese servicio.
export const TEXTO_FIJO_ENTREGA =
  "El cliente se compromete a recibir la mercancía en las condiciones físicas " +
  "en que se entrega. Cualquier reclamo sobre defectos visibles debe realizarse " +
  "al momento de la entrega. Las garantías aplican según política de fábrica del " +
  "producto.";

// Nota legal al pie del PDF de cotización. También sin la mención al embalaje.
export const TEXTO_LEGAL_COTIZACION =
  "Esta cotización es válida hasta la fecha indicada. Las garantías aplican " +
  "según política de fábrica del producto.";

// Marca de la empresa
export const MARCA = {
  nombre: "Compresores del Valle S.A.S.",
  ciudad: "Cali, Colombia",
  // Email/teléfono van vacíos por ahora — Admin puede llenar en config futura
};

// Nombre comercial corto de la empresa. NO es el nombre legal: para eso está
// MARCA.nombre, que debe seguir usándose donde el nombre tenga valor jurídico
// —en particular el titular de la cuenta bancaria de la cotización—.
// Nació para los recibos (#14) y ahora lo comparten recibos y cotizaciones.
export const NOMBRE_COMERCIAL = "Compresores CV";

// #14 — Teléfono por sede para los recibos (se muestra el de la sede de la venta).
// La Bodega Principal (BODEGA) no tiene teléfono propio: se omite la línea de
// teléfono cuando la sede no está en este mapa.
export const SEDE_TELEFONO = {
  CV: "3127536787",
  L3: "3114940799",
  CHV: "3174675905",
};

// #22 — Dirección de la empresa para las órdenes de trabajo.
export const RECIBO_DIRECCION = "Calle 34 #4b-30";

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
