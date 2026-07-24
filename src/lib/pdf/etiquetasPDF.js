/**
 * Generador de etiquetas QR de producto — hoja carta en grilla (para mandar a
 * imprenta) o etiqueta suelta 50×30mm (para impresora térmica de rollo).
 *
 * Hoy casi ningún producto del catálogo tiene sticker pegado, así que estas
 * son las etiquetas que alimentan a las 9 pantallas que escanean QR. El dueño
 * va a subcontratar la impresión con una imprenta externa: por eso el modo
 * principal es la hoja carta en grilla y `download()` es la acción que
 * importa, no imprimir desde el navegador.
 *
 * Sigue el mismo contrato de salida que ventaPOS.js:
 *   { blob, filename, download(), print(), open() }
 * con la misma caída a doc.save(filename) si el navegador bloquea el popup y
 * el mismo revoke del object URL a los 60s. Además devuelve `total` (cuántas
 * etiquetas se generaron) y `omitidos` (productos que no se pudieron
 * etiquetar, con el motivo) para que la pantalla se lo diga al usuario.
 *
 * Uso:
 *   const r = await generarEtiquetasPDF({
 *     productos: [{ referencia, nombre, cantidad }],
 *     formato: "hoja" | "individual",
 *     onProgress: (hechas, total) => ...,
 *   });
 *   r.download();
 */
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { LAYOUT } from "./pdfStyles";

// ── Tamaño de la etiqueta (mismo que el @page de QRPrintLabel.jsx) ────────
const LABEL_W = 50; // mm
const LABEL_H = 30; // mm

// ── Grilla de la hoja carta ────────────────────────────────────────────────
// Hoja 216×279mm (LAYOUT de pdfStyles), etiquetas de 50×30mm.
// Fórmula: con un margen mínimo de seguridad de 5mm y 2mm de separación entre
// etiquetas, ¿cuántas caben por eje?
//   ancho:  usable = 216 - 2*5 = 206mm → cols = floor((206+2)/(50+2)) = 4
//           4×50 + 3×2 = 206mm exactos → el margen real queda en 5mm c/lado
//   alto:   usable = 279 - 2*5 = 269mm → rows = floor((269+2)/(30+2)) = 8
//           8×30 + 7×2 = 254mm de 269mm usables → el sobrante se reparte
//           como margen (queda ~12.5mm arriba/abajo en vez de 5mm)
// Resultado: 4 columnas × 8 filas = 32 etiquetas por hoja carta.
const GRID_MARGIN_MIN = 5; // mm
const GRID_GAP = 2; // mm

function calcularEjeGrilla(pageDim, labelDim) {
  const usable = pageDim - 2 * GRID_MARGIN_MIN;
  const count = Math.max(
    1,
    Math.floor((usable + GRID_GAP) / (labelDim + GRID_GAP)),
  );
  const used = count * labelDim + (count - 1) * GRID_GAP;
  const margin = (pageDim - used) / 2; // centra la grilla, absorbe el sobrante
  return { count, margin };
}

const { count: GRID_COLS, margin: GRID_MARGIN_X } = calcularEjeGrilla(
  LAYOUT.pageWidth,
  LABEL_W,
);
const { count: GRID_ROWS, margin: GRID_MARGIN_Y } = calcularEjeGrilla(
  LAYOUT.pageHeight,
  LABEL_H,
);

// ── Topes defensivos ───────────────────────────────────────────────────────
// Nadie pega 500 stickers idénticos en un estante, pero un typo en la
// cantidad (ej. escribir 50000 en vez de 5) no debe generar un PDF absurdo.
// Se exporta para que la pantalla enseñe el mismo límite ANTES de generar: si
// cada lado guardara su propia copia del número, tarde o temprano uno de los
// dos se cambia y el operario vería su cantidad recortada sin explicación.
export const MAX_COPIAS_POR_PRODUCTO = 500;

// ── QR ──────────────────────────────────────────────────────────────────
// Nivel "H" (30% de tolerancia a daño): la etiqueta vive pegada en la bodega
// entre grasa, polvo y roces. margin:4 es la quiet zone estándar en módulos
// (sin ella muchos escáneres no enfocan/leen el QR). width:300px rinde nítido
// incluso impreso a los 24mm que ocupa el QR en la etiqueta.
async function generarQRDataUrl(referencia) {
  return QRCode.toDataURL(referencia, {
    errorCorrectionLevel: "H",
    margin: 4,
    width: 300,
  });
}

// Cede el hilo al navegador entre tandas de trabajo pesado para que la UI
// (spinner, contador de progreso) no se congele generando cientos de QR.
function cederAlNavegador() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Dibuja una etiqueta dentro de un rectángulo LABEL_W×LABEL_H con esquina
 * superior izquierda en (x, y). Imita el layout de QRPrintLabel.jsx: QR a la
 * izquierda, referencia en negrita, nombre recortado a lo que quepa, marca al
 * pie. NO incluye ubicación: cambia con el tiempo y dejaría la etiqueta
 * mintiendo pegada al producto.
 */
function dibujarEtiqueta(
  doc,
  x,
  y,
  { referencia, nombre, qrDataUrl, conBorde },
) {
  const PAD = 2; // mm
  const QR_SIZE = 24; // mm
  const GAP = 3; // mm

  if (conBorde) {
    // Guía de corte: punteado tenue y delgado — se ve poco a propósito, es
    // guía para la imprenta, no un marco decorativo.
    doc.saveGraphicsState();
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.1);
    doc.setLineDashPattern([0.6, 0.6], 0);
    doc.rect(x, y, LABEL_W, LABEL_H);
    doc.setLineDashPattern([], 0);
    doc.restoreGraphicsState();
  }

  doc.addImage(
    qrDataUrl,
    "PNG",
    x + PAD,
    y + (LABEL_H - QR_SIZE) / 2,
    QR_SIZE,
    QR_SIZE,
  );

  const textX = x + PAD + QR_SIZE + GAP;
  const textW = LABEL_W - PAD * 2 - QR_SIZE - GAP;
  let ty = y + PAD + 3;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  // La referencia promedia 6.6 caracteres pero hay una de 25: si envuelve, se
  // deja envolver en vez de recortar — es lo que el operario teclea a mano
  // si el QR falla, no se puede perder un carácter.
  const refLines = doc.splitTextToSize(String(referencia), textW);
  doc.text(refLines, textX, ty);
  ty += refLines.length * 3.2 + 1;

  if (nombre) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(60, 60, 60);
    // Recorta a 3 líneas (~50 chars reales de nombre entran holgado en 3).
    const todasLasLineas = doc.splitTextToSize(String(nombre), textW);
    const nombreLines = todasLasLineas.slice(0, 3);
    // Si el nombre no cupo entero, la última línea visible avisa con "…" en
    // vez de cortar en silencio: el operario debe saber que falta texto y no
    // confundir el recorte con el nombre completo. Se recorta carácter a
    // carácter hasta que el texto + puntos quepa en el ancho disponible, para
    // no desbordar la etiqueta.
    if (todasLasLineas.length > 3) {
      const ELLIPSIS = "…";
      let ultimaLinea = nombreLines[2];
      while (
        ultimaLinea.length > 0 &&
        doc.getTextWidth(ultimaLinea + ELLIPSIS) > textW
      ) {
        ultimaLinea = ultimaLinea.slice(0, -1).trimEnd();
      }
      nombreLines[2] = ultimaLinea + ELLIPSIS;
    }
    doc.text(nombreLines, textX, ty);
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5);
  doc.setTextColor(140, 140, 140);
  doc.text("Compresores del Valle", textX, y + LABEL_H - PAD);
  doc.setTextColor(0, 0, 0);
}

/**
 * Arma la lista de trabajo: valida referencias y separa lo que sí se puede
 * etiquetar de lo que hay que avisarle al usuario que se saltó.
 */
function prepararProductos(productos) {
  const validos = [];
  const omitidos = [];

  for (const p of productos ?? []) {
    const refOriginal = p?.referencia;
    const esTexto = typeof refOriginal === "string";
    // Cubre referencia ausente, null, y la "solo espacios" (dato sucio real
    // del catálogo): ambas se tratan como sin referencia, no como un QR vacío.
    if (!esTexto || refOriginal.trim().length === 0) {
      omitidos.push({
        referencia: esTexto ? refOriginal : "",
        nombre: p?.nombre ?? "",
        motivo: "Sin referencia: no se puede generar un QR para identificarlo",
      });
      continue;
    }

    const cantidadPedida = Math.round(Number(p?.cantidad) || 1);
    const cantidad = Math.min(
      MAX_COPIAS_POR_PRODUCTO,
      Math.max(1, cantidadPedida),
    );

    validos.push({
      // TAL CUAL: el escáner compara por igualdad exacta contra
      // productos.referencia, incluida comilla de pulgadas o caracteres ° .
      referencia: refOriginal,
      nombre: p?.nombre ?? "",
      cantidad,
    });
  }

  return { validos, omitidos };
}

/**
 * Genera el PDF de etiquetas QR.
 *
 * Args:
 *   productos:  [{ referencia, nombre, cantidad? }] — cantidad = copias de
 *               esa etiqueta (por defecto 1).
 *   formato:    "hoja" (default) — hoja carta en grilla 4×8, para imprenta.
 *               "individual"    — una etiqueta 50×30mm por página, para
 *               impresora térmica de rollo.
 *   onProgress: (hechas, total) => void — opcional, para mostrar
 *               "generando X de Y" mientras se procesan cientos de QR.
 */
export async function generarEtiquetasPDF({
  productos = [],
  formato = "hoja",
  onProgress,
} = {}) {
  const { validos, omitidos } = prepararProductos(productos);
  const total = validos.reduce((acc, p) => acc + p.cantidad, 0);

  const esIndividual = formato === "individual";
  // `orientation: "landscape"` NO es opcional: en vertical (el default) jsPDF
  // reordena el formato para que el lado corto sea el ancho, y [50, 30] se
  // convierte en una página de 30×50. La etiqueta se dibujaba entonces sobre
  // una hoja girada: el texto se salía por el borde derecho y sobraban 20mm en
  // blanco abajo. Se detectó renderizando el PDF, no leyendo el código.
  const doc = esIndividual
    ? new jsPDF({
        unit: "mm",
        orientation: "landscape",
        format: [LABEL_W, LABEL_H],
        compress: true,
      })
    : new jsPDF({
        unit: "mm",
        format: [LAYOUT.pageWidth, LAYOUT.pageHeight],
        compress: true,
      });

  let hechas = 0;
  let primeraEtiqueta = true;
  // Índice de la próxima etiqueta dentro de la hoja actual (solo modo hoja):
  // 0..(GRID_COLS*GRID_ROWS - 1); al llegar al límite, hoja nueva.
  let posEnHoja = 0;
  const porHoja = GRID_COLS * GRID_ROWS;

  for (const producto of validos) {
    let qrDataUrl;
    try {
      // Un QR por referencia (no por copia): si piden 8 iguales, se genera
      // una sola vez y se reutiliza el dataURL en las 8 etiquetas.
      qrDataUrl = await generarQRDataUrl(producto.referencia);
    } catch {
      omitidos.push({
        referencia: producto.referencia,
        nombre: producto.nombre,
        motivo: "No se pudo generar el código QR para esta referencia",
      });
      continue;
    }

    for (let i = 0; i < producto.cantidad; i++) {
      if (esIndividual) {
        // Misma orientación que la primera página: sin el segundo argumento,
        // addPage vuelve a girar el formato y solo la primera etiqueta saldría
        // bien.
        if (!primeraEtiqueta) doc.addPage([LABEL_W, LABEL_H], "landscape");
        dibujarEtiqueta(doc, 0, 0, {
          referencia: producto.referencia,
          nombre: producto.nombre,
          qrDataUrl,
          conBorde: false,
        });
      } else {
        if (posEnHoja > 0 && posEnHoja % porHoja === 0) {
          doc.addPage([LAYOUT.pageWidth, LAYOUT.pageHeight]);
        }
        const col = posEnHoja % GRID_COLS;
        const row = Math.floor(posEnHoja / GRID_COLS) % GRID_ROWS;
        const x = GRID_MARGIN_X + col * (LABEL_W + GRID_GAP);
        const y = GRID_MARGIN_Y + row * (LABEL_H + GRID_GAP);
        dibujarEtiqueta(doc, x, y, {
          referencia: producto.referencia,
          nombre: producto.nombre,
          qrDataUrl,
          conBorde: true,
        });
        posEnHoja++;
      }

      primeraEtiqueta = false;
      hechas++;
      if (onProgress) onProgress(hechas, total);
      // Cede el hilo cada 15 etiquetas: suficiente para que el navegador
      // repinte el contador de progreso sin frenar la generación.
      if (hechas % 15 === 0) await cederAlNavegador();
    }
  }

  const fechaTag = new Date()
    .toLocaleDateString("es-CO", { timeZone: "America/Bogota" })
    .split("/")
    .reverse()
    .join("-");
  const modoTag = esIndividual ? "Individual" : "Hoja";
  const filename = `Etiquetas_QR_CompresoresDelValle_${modoTag}_${total}_${fechaTag}.pdf`;

  const blob = doc.output("blob");

  return {
    blob,
    filename,
    total,
    omitidos,
    download() {
      doc.save(filename);
    },
    print() {
      const url = URL.createObjectURL(blob);
      const win = window.open(url);
      if (!win) {
        URL.revokeObjectURL(url);
        doc.save(filename);
        return;
      }
      const triggerPrint = () => {
        try {
          win.print();
        } catch {
          /* algunos visores no permiten print() programático */
        }
      };
      if (win.document?.readyState === "complete") triggerPrint();
      else win.addEventListener("load", triggerPrint, { once: true });
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    open() {
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (!win) {
        URL.revokeObjectURL(url);
        doc.save(filename);
        return;
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  };
}
