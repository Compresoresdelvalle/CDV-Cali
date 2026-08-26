/**
 * Generador PDF de cotizaciones (BLANCO Y NEGRO) — idéntico al preview en
 * pantalla. Un MISMO documento alimenta el preview (iframe) y la
 * impresión/descarga, así lo que se ve es exactamente lo que se imprime.
 *
 * Uso:
 *   const pdf = generarCotizacionPDF({ cotizacion, items, cuentas, vendedor });
 *   pdf.blob;          // para el <iframe> del preview
 *   pdf.print();       // imprime
 *   pdf.download();    // descarga
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate } from "../utils";
import { descomponerObservaciones } from "../cotizaciones-ui";
import {
  MARCA,
  NOMBRE_COMERCIAL,
  RECIBO_DIRECCION,
  SEDE_TELEFONO,
  TEXTO_ENTREGA_COTIZACION,
  TEXTO_LEGAL_COTIZACION,
  formatCOP,
} from "./pdfStyles";

/* Paleta B/N (sin azul) — equivalente a los tokens del preview HTML. */
const INK = [16, 24, 40]; // casi negro (--n-950)
const DARK = [31, 41, 55]; // texto cuerpo
const GRAY = [107, 114, 128]; // etiquetas / secundario
const LIGHT = [156, 163, 175]; // etiquetas muy tenues
const RULE = [230, 232, 237]; // líneas (#E6E8ED)

const PAGE_H = 279;
const L = 15; // margen izquierdo
const R = 201; // borde derecho (216 - 15)
const W = R - L; // 186mm
const CX = 108; // centro

export function generarCotizacionPDF({
  cotizacion,
  items = [],
  cuentas = [],
  vendedor = "—",
}) {
  const doc = new jsPDF({ unit: "mm", format: "letter", compress: true });
  const extra = descomponerObservaciones(cotizacion?.observaciones) || {};

  /* Helpers de dibujo ----------------------------------------------------- */
  const rule = (y, color = RULE, w = 0.2) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(w);
    doc.line(L, y, R, y);
  };
  const label = (text, x, y, align = "left", color = LIGHT) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...color);
    doc.text(String(text).toUpperCase(), x, y, { align, charSpace: 0.25 });
  };
  const pageBreak = (y, reserva = 30) => {
    if (y > PAGE_H - reserva) {
      doc.addPage();
      return 18;
    }
    return y;
  };

  let y = 16;

  /* ── Encabezado ───────────────────────────────────────────── */
  doc.setFillColor(...INK);
  doc.roundedRect(L, y, 13, 13, 1.4, 1.4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text("CHV", L + 6.5, y + 8.2, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  doc.setTextColor(...GRAY);
  doc.text(NOMBRE_COMERCIAL.toUpperCase(), L, y + 17, { charSpace: 0.2 });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text(NOMBRE_COMERCIAL, R, y + 2, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text(RECIBO_DIRECCION, R, y + 6.5, { align: "right" });
  const tel = SEDE_TELEFONO[cotizacion?.sede_id];
  doc.text(`${MARCA.ciudad}${tel ? ` · Tel: ${tel}` : ""}`, R, y + 10.5, {
    align: "right",
  });

  y += 22;
  rule(y);
  y += 9.5;

  /* ── Título ───────────────────────────────────────────────── */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...INK);
  doc.text("COTIZACIÓN", CX, y, { align: "center", charSpace: 1.2 });
  y += 6.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...GRAY);
  doc.text(`#${cotizacion?.numero ?? "—"}`, CX, y, { align: "center" });
  y += 5;
  rule(y);
  y += 8;

  /* ── Cliente + meta ───────────────────────────────────────── */
  const metaTop = y;
  label("Cliente", L, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text(cotizacion?.cliente_nombre || "Sin nombre", L, y + 6);
  let cy = y + 11;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAY);
  if (cotizacion?.cliente_nit) {
    doc.text(`NIT ${cotizacion.cliente_nit}`, L, cy);
    cy += 4;
  }
  doc.text(extra?.direccion || "—", L, cy);
  cy += 4;

  const mcolA = 120;
  const mcolB = 165;
  const fechaEmision = cotizacion?.fecha ? formatDate(cotizacion.fecha) : "—";
  const metaCell = (lab, val, x, yy, valBold = false) => {
    label(lab, x, yy);
    doc.setFont("helvetica", valBold ? "bold" : "normal");
    doc.setFontSize(9);
    doc.setTextColor(...DARK);
    doc.text(String(val), x, yy + 4.5);
  };
  metaCell("Fecha emisión", fechaEmision, mcolA, metaTop);
  metaCell(
    "Validez",
    `${cotizacion?.vigencia_dias ?? 15} días`,
    mcolB,
    metaTop,
    true,
  );
  metaCell("Cotizado por", vendedor, mcolA, metaTop + 11);
  metaCell("Sede", cotizacion?.sede_id ?? "—", mcolB, metaTop + 11, true);

  y = Math.max(cy, metaTop + 22);
  rule(y);
  y += 4;

  /* ── Totales (cálculo) ────────────────────────────────────── */
  const ivaPct = Number(cotizacion?.iva_pct ?? 19);
  const subtotal = Number(cotizacion?.subtotal ?? 0);
  const descuento =
    cotizacion?.descuento_valor != null
      ? Math.min(Math.max(0, Number(cotizacion.descuento_valor)), subtotal)
      : subtotal * (Number(cotizacion?.descuento_pct ?? 0) / 100);
  const baseIva = subtotal - descuento;
  const ivaMonto = baseIva * (ivaPct / 100);
  const domicilio = Math.max(0, Number(cotizacion?.domicilio ?? 0));
  const total = Number(cotizacion?.total ?? baseIva + ivaMonto + domicilio);

  /* ── Tabla de ítems (sin relleno, líneas finas) ───────────── */
  autoTable(doc, {
    startY: y,
    head: [["REF.", "DESCRIPCIÓN", "CANT", "PRECIO UNIT", "SUBTOTAL"]],
    body: items.map((it) => {
      const esServicio = it.servicio_id != null;
      return [
        esServicio ? "Servicio" : (it.producto?.referencia ?? "—"),
        it.descripcion ?? it.producto?.nombre ?? "—",
        String(it.cantidad ?? ""),
        formatCOP(it.precio_unitario),
        formatCOP(it.subtotal),
      ];
    }),
    theme: "plain",
    styles: {
      fontSize: 9,
      textColor: DARK,
      cellPadding: { top: 2.4, bottom: 2.4, left: 1, right: 1 },
      lineWidth: 0,
    },
    headStyles: { textColor: GRAY, fontStyle: "bold", fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: "auto" },
      2: { cellWidth: 16, halign: "center" },
      3: { cellWidth: 30, halign: "right" },
      4: { cellWidth: 30, halign: "right" },
    },
    margin: { left: L, right: L },
    didDrawCell: (data) => {
      const { x, y: cyy, width, height } = data.cell;
      if (data.section === "head") {
        doc.setDrawColor(...INK);
        doc.setLineWidth(0.3);
        doc.line(x, cyy + height, x + width, cyy + height);
      } else if (data.section === "body") {
        doc.setDrawColor(...RULE);
        doc.setLineWidth(0.1);
        doc.line(x, cyy + height, x + width, cyy + height);
      }
    },
  });
  y = doc.lastAutoTable.finalY + 6;

  /* ── Totales (impresión) ──────────────────────────────────── */
  const tLabel = R - 55;
  const totRow = (lab, val, opts = {}) => {
    const { bold = false, color = DARK, labColor = GRAY } = opts;
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 11 : 9);
    doc.setTextColor(...labColor);
    doc.text(lab, tLabel, y);
    doc.setTextColor(...color);
    doc.text(val, R, y, { align: "right" });
    y += bold ? 6 : 4.8;
  };
  totRow("Subtotal", formatCOP(subtotal));
  if (descuento > 0) totRow("Descuento", `−${formatCOP(descuento)}`);
  totRow(`IVA ${ivaPct}%`, formatCOP(ivaMonto));
  if (domicilio > 0) totRow("Domicilio", formatCOP(domicilio));
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.2);
  doc.line(tLabel, y - 1.5, R, y - 1.5);
  y += 1.5;
  totRow("TOTAL", formatCOP(total), { bold: true, color: INK, labColor: INK });
  y += 4;

  /* ── Secciones ────────────────────────────────────────────── */
  const sectionHeader = (titulo, yy) => {
    yy = pageBreak(yy);
    label(titulo, L, yy, "left", GRAY);
    rule(yy + 1.6, RULE, 0.15);
    return yy + 6;
  };
  const termLine = (lab, val, yy) => {
    yy = pageBreak(yy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...DARK);
    doc.text(lab, L, yy);
    const lw = doc.getTextWidth(lab);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    const wrapped = doc.splitTextToSize(String(val), W - lw - 2);
    doc.text(wrapped, L + lw + 1.5, yy);
    return yy + wrapped.length * 4.6 + 1.6;
  };

  // Términos comerciales
  y = sectionHeader("Términos comerciales", y);
  y = termLine(
    "Validez: ",
    `${cotizacion?.vigencia_dias ?? 15} días a partir de la fecha de emisión.`,
    y,
  );
  if (cotizacion?.condiciones_pago) {
    y = termLine("Condiciones de pago: ", cotizacion.condiciones_pago, y);
  }
  if (cotizacion?.tiempo_entrega_nota) {
    y = termLine("Tiempo de entrega: ", cotizacion.tiempo_entrega_nota, y);
  }
  y = termLine(
    "IVA incluido: ",
    ivaPct > 0 ? `Sí, ${ivaPct}%.` : "No aplica.",
    y,
  );
  y += 3;

  // Cuentas para pago
  if (cuentas.length > 0) {
    y = sectionHeader("Cuentas para pago", y);
    for (const c of cuentas) {
      const resto = `${c.tipo ? ` · ${c.tipo}` : ""} · ${c.numero} · A nombre de ${c.titular || MARCA.nombre}`;
      y = termLine(c.banco ?? "—", resto, y);
    }
    y += 3;
  }

  // Condiciones de entrega
  y = sectionHeader("Condiciones de entrega", y);
  y = pageBreak(y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAY);
  const cond = doc.splitTextToSize(TEXTO_ENTREGA_COTIZACION, W);
  doc.text(cond, L, y);
  y += cond.length * 4.4 + 5;

  /* ── Pie (fluye con el contenido, como el preview) ────────── */
  y = pageBreak(y, 24);
  rule(y, RULE, 0.2);
  y += 5;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  const legal = doc.splitTextToSize(TEXTO_LEGAL_COTIZACION, W);
  doc.text(legal, L, y);
  y += legal.length * 4 + 3;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...LIGHT);
  const totalPages = doc.getNumberOfPages();
  doc.text(
    `Página ${totalPages} de ${totalPages} · #${cotizacion?.numero ?? "—"} · ${NOMBRE_COMERCIAL}`,
    L,
    y,
  );

  /* ── API de retorno (igual que antes) ─────────────────────── */
  const blob = doc.output("blob");
  const filename = `Cotizacion_${String(cotizacion?.numero ?? "draft").padStart(5, "0")}.pdf`;

  return {
    blob,
    filename,
    get dataUri() {
      return doc.output("datauristring");
    },
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
          // algunos visores no permiten print() programático
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
