/**
 * Generador PDF de recibos de pago (BLANCO Y NEGRO) — MISMO modelo que el de
 * cotizaciones (src/lib/pdf/cotizacionPDF.js). Un ÚNICO documento alimenta el
 * preview (iframe) y la impresión/descarga, así lo que se ve es exactamente lo
 * que se imprime.
 *
 * Uso:
 *   const r = generarReciboPDF({ recibo, items, cuenta, recibidoPor });
 *   r.blob;       // para el <iframe> del preview
 *   r.print();    // imprime
 *   r.download(); // descarga
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { MARCA, RECIBO_DIRECCION, SEDE_TELEFONO, formatCOP } from "./pdfStyles";

/* Paleta B/N (sin azul) — idéntica al generador de cotizaciones. */
const INK = [16, 24, 40]; // casi negro
const DARK = [31, 41, 55]; // texto cuerpo
const GRAY = [107, 114, 128]; // etiquetas / secundario
const LIGHT = [156, 163, 175]; // etiquetas muy tenues
const RULE = [230, 232, 237]; // líneas (#E6E8ED)

const PAGE_H = 279;
const L = 15; // margen izquierdo
const R = 201; // borde derecho (216 - 15)
const W = R - L; // 186mm
const CX = 108; // centro

/**
 * Args:
 *   recibo: { numero, fecha, sede_id, cliente_nombre, cliente_nit, concepto,
 *             subtotal, iva_pct, total, abonos_previos, monto_pagado, saldo,
 *             metodo_pago, observaciones, anulado }
 *   items:  [{ descripcion, cantidad, precio_unitario, subtotal }] (opcional)
 *   cuenta: { banco, tipo, numero, titular } | null
 *   recibidoPor: string
 */
export function generarReciboPDF({
  recibo,
  items = [],
  cuenta = null,
  recibidoPor = "—",
}) {
  const doc = new jsPDF({ unit: "mm", format: "letter", compress: true });

  /* Helpers de dibujo (idénticos a cotizacionPDF) ------------------------- */
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

  const numero = String(recibo?.numero ?? "—").padStart(5, "0");
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
  doc.text("COMPRESORES DEL VALLE", L, y + 17, { charSpace: 0.2 });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text(MARCA.nombre, R, y + 2, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text(RECIBO_DIRECCION, R, y + 6.5, { align: "right" });
  const tel = SEDE_TELEFONO[recibo?.sede_id];
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
  doc.text("RECIBO DE PAGO", CX, y, { align: "center", charSpace: 1.2 });
  y += 6.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...GRAY);
  doc.text(`#${numero}`, CX, y, { align: "center" });
  y += 5;
  if (recibo?.anulado) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text("· RECIBO ANULADO ·", CX, y, { align: "center", charSpace: 0.5 });
    y += 5;
  }
  rule(y);
  y += 8;

  /* ── Recibí de + meta ─────────────────────────────────────── */
  const metaTop = y;
  label("Recibí de", L, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text(recibo?.cliente_nombre || "Sin nombre", L, y + 6);
  let cy = y + 11;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAY);
  if (recibo?.cliente_nit) {
    doc.text(`NIT/CC ${recibo.cliente_nit}`, L, cy);
    cy += 4;
  }

  const mcolA = 120;
  const mcolB = 165;
  const fecha = recibo?.fecha
    ? new Date(recibo.fecha).toLocaleDateString("es-CO", {
        timeZone: "America/Bogota",
      })
    : "—";
  const metaCell = (lab, val, x, yy, valBold = false) => {
    label(lab, x, yy);
    doc.setFont("helvetica", valBold ? "bold" : "normal");
    doc.setFontSize(9);
    doc.setTextColor(...DARK);
    doc.text(String(val), x, yy + 4.5);
  };
  metaCell("Fecha", fecha, mcolA, metaTop);
  metaCell("Forma de pago", recibo?.metodo_pago ?? "—", mcolB, metaTop, true);
  metaCell("Recibido por", recibidoPor, mcolA, metaTop + 11);
  metaCell("Sede", recibo?.sede_id ?? "—", mcolB, metaTop + 11, true);

  y = Math.max(cy, metaTop + 22);
  rule(y);
  y += 8;

  /* ── Concepto ─────────────────────────────────────────────── */
  label("Concepto", L, y, "left", GRAY);
  rule(y + 1.6, RULE, 0.15);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...DARK);
  const conc = doc.splitTextToSize(recibo?.concepto || "—", W);
  doc.text(conc, L, y);
  y += conc.length * 4.8 + 5;

  /* ── Detalle de ítems (opcional) ──────────────────────────── */
  if (items.length > 0) {
    y = pageBreak(y, 40);
    autoTable(doc, {
      startY: y,
      head: [["DESCRIPCIÓN", "CANT", "PRECIO UNIT", "SUBTOTAL"]],
      body: items.map((it) => [
        it.descripcion ?? "—",
        String(it.cantidad ?? ""),
        formatCOP(it.precio_unitario),
        formatCOP(it.subtotal),
      ]),
      theme: "plain",
      styles: {
        fontSize: 9,
        textColor: DARK,
        cellPadding: { top: 2.4, bottom: 2.4, left: 1, right: 1 },
        lineWidth: 0,
      },
      headStyles: { textColor: GRAY, fontStyle: "bold", fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: "auto" },
        1: { cellWidth: 16, halign: "center" },
        2: { cellWidth: 32, halign: "right" },
        3: { cellWidth: 32, halign: "right" },
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
  }

  /* ── Totales ──────────────────────────────────────────────── */
  const subtotal = Number(recibo?.subtotal ?? 0);
  const ivaPct = Number(recibo?.iva_pct ?? 19);
  const ivaMonto = subtotal * (ivaPct / 100);
  const total = Number(recibo?.total ?? subtotal + ivaMonto);
  const abonosPrev = Number(recibo?.abonos_previos ?? 0);
  const montoPagado = Number(recibo?.monto_pagado ?? 0);
  const saldo = Number(recibo?.saldo ?? total - abonosPrev - montoPagado);

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
  // #16: IVA condicional — si el recibo es exento (0%) no se imprime la línea.
  if (ivaPct > 0) totRow(`IVA ${ivaPct}%`, formatCOP(ivaMonto));
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.2);
  doc.line(tLabel, y - 1.5, R, y - 1.5);
  y += 1.5;
  totRow("Total", formatCOP(total), { bold: true, color: INK, labColor: INK });
  if (abonosPrev > 0) totRow("Abonos previos", `−${formatCOP(abonosPrev)}`);
  totRow("Monto recibido", formatCOP(montoPagado));
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.2);
  doc.line(tLabel, y - 1.5, R, y - 1.5);
  y += 1.5;
  totRow("Saldo pendiente", formatCOP(saldo), {
    bold: true,
    color: INK,
    labColor: INK,
  });
  y += 6;

  /* ── Secciones (cuenta / observaciones) ───────────────────── */
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

  if (cuenta) {
    y = sectionHeader("Cuenta de consignación", y);
    const resto =
      `${cuenta.tipo ? ` · ${cuenta.tipo}` : ""} · ${cuenta.numero}` +
      (cuenta.titular ? ` · A nombre de ${cuenta.titular}` : "");
    y = termLine(cuenta.banco ?? "—", resto, y);
    y += 3;
  }

  if (recibo?.observaciones) {
    y = sectionHeader("Observaciones", y);
    y = pageBreak(y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...GRAY);
    const obs = doc.splitTextToSize(String(recibo.observaciones), W);
    doc.text(obs, L, y);
    y += obs.length * 4.4 + 5;
  }

  /* ── Firma (fluye con el contenido) ───────────────────────── */
  y = pageBreak(y, 40);
  y += 14; // espacio para firmar
  const firmaY = y;
  doc.setDrawColor(...DARK);
  doc.setLineWidth(0.3);
  doc.line(L + 18, firmaY, L + 78, firmaY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(recibidoPor, L + 48, firmaY - 2, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text("Recibido por", L + 48, firmaY + 4, { align: "center" });
  y = firmaY + 12;

  /* ── Pie (fluye con el contenido) ─────────────────────────── */
  y = pageBreak(y, 24);
  rule(y, RULE, 0.2);
  y += 5;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  const legal = doc.splitTextToSize(
    `Este recibo no es una factura electrónica. Documento soporte de pago emitido por ${MARCA.nombre}.`,
    W,
  );
  doc.text(legal, L, y);
  y += legal.length * 4 + 3;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...LIGHT);
  const totalPages = doc.getNumberOfPages();
  doc.text(
    `Página ${totalPages} de ${totalPages} · Recibo #${numero} · ${MARCA.nombre}`,
    L,
    y,
  );

  /* ── API de retorno (igual que antes) ─────────────────────── */
  const blob = doc.output("blob");
  const filename = `Recibo_${numero}.pdf`;

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
