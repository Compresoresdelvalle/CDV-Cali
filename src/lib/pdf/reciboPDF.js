/**
 * Generador PDF de recibos de pago — Fase 14.
 *
 * Formato carta. Reusa pdfStyles.js. Documento de "recibí de [cliente] la
 * suma de [monto]" con concepto multi-línea, montos, abonos previos y saldo.
 *
 * Uso:
 *   const r = generarReciboPDF({ recibo, items, cuenta, recibidoPor });
 *   r.print();
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  MARCA,
  RECIBO_NOMBRE,
  SEDE_TELEFONO,
  RECIBO_DIRECCION,
  COLORES,
  LAYOUT,
  formatCOP,
} from "./pdfStyles";

/**
 * Args:
 *   recibo: { numero, fecha, cliente_nombre, cliente_nit, concepto,
 *             subtotal, iva_pct, total, abonos_previos, monto_pagado,
 *             saldo, metodo_pago, observaciones, anulado }
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
  let y = LAYOUT.margenSup;

  // ── Header (#14: nombre comercial + dirección + teléfono de la sede) ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...COLORES.primario);
  doc.text(RECIBO_NOMBRE, LAYOUT.margenIzq, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLORES.textoMedio);
  doc.text(`${RECIBO_DIRECCION} · ${MARCA.ciudad}`, LAYOUT.margenIzq, y + 5);
  const telSede = SEDE_TELEFONO[recibo.sede_id];
  if (telSede) {
    doc.text(`Tel: ${telSede}`, LAYOUT.margenIzq, y + 9.5);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...COLORES.textoOscuro);
  doc.text(
    `RECIBO DE PAGO N° ${String(recibo.numero ?? "—").padStart(5, "0")}`,
    LAYOUT.pageWidth - LAYOUT.margenDer,
    y,
    { align: "right" },
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLORES.textoMedio);
  const fecha = recibo.fecha
    ? new Date(recibo.fecha).toLocaleDateString("es-CO", {
        timeZone: "America/Bogota",
      })
    : "—";
  doc.text(`Fecha: ${fecha}`, LAYOUT.pageWidth - LAYOUT.margenDer, y + 5, {
    align: "right",
  });
  y += telSede ? 17 : 13;

  // Marca de anulado
  if (recibo.anulado) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...COLORES.textoMedio);
    doc.text("*** RECIBO ANULADO ***", LAYOUT.pageWidth / 2, y, {
      align: "center",
    });
    y += 6;
  }

  doc.setDrawColor(...COLORES.primario);
  doc.setLineWidth(0.5);
  doc.line(LAYOUT.margenIzq, y, LAYOUT.pageWidth - LAYOUT.margenDer, y);
  y += 7;

  // ── Recibí de ────────────────────────────────────────────────────────
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...COLORES.textoOscuro);
  const recibiLine = `Recibí de: ${recibo.cliente_nombre ?? "—"}${
    recibo.cliente_nit ? `   ·   NIT/CC: ${recibo.cliente_nit}` : ""
  }`;
  doc.text(recibiLine, LAYOUT.margenIzq, y);
  y += 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Por concepto de:", LAYOUT.margenIzq, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORES.textoMedio);
  const conceptoWrap = doc.splitTextToSize(
    recibo.concepto ?? "—",
    LAYOUT.contentWidth,
  );
  doc.text(conceptoWrap, LAYOUT.margenIzq, y);
  y += conceptoWrap.length * 4.8 + 4;

  // ── Detalle de ítems (opcional, desde cotización) ────────────────────
  if (items.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Descripción", "Cant.", "P. Unit.", "Total"]],
      body: items.map((it) => [
        it.descripcion ?? "—",
        String(it.cantidad ?? 0),
        formatCOP(it.precio_unitario),
        formatCOP(it.subtotal),
      ]),
      theme: "grid",
      headStyles: {
        fillColor: COLORES.primario,
        textColor: 255,
        fontStyle: "bold",
        fontSize: 9,
      },
      bodyStyles: { fontSize: 9, textColor: COLORES.textoOscuro },
      columnStyles: {
        0: { cellWidth: 100 },
        1: { cellWidth: 22, halign: "right" },
        2: { cellWidth: 32, halign: "right" },
        3: { cellWidth: 32, halign: "right" },
      },
      margin: { left: LAYOUT.margenIzq, right: LAYOUT.margenDer },
    });
    y = doc.lastAutoTable.finalY + 5;
  }

  // ── Totales ──────────────────────────────────────────────────────────
  const totalsX = LAYOUT.pageWidth - LAYOUT.margenDer - 65;
  const valuesX = LAYOUT.pageWidth - LAYOUT.margenDer;
  const subtotal = Number(recibo.subtotal ?? 0);
  const ivaPct = Number(recibo.iva_pct ?? 19);
  const ivaMonto = subtotal * (ivaPct / 100);
  const total = Number(recibo.total ?? subtotal + ivaMonto);
  const abonosPrev = Number(recibo.abonos_previos ?? 0);
  const montoPagado = Number(recibo.monto_pagado ?? 0);
  const saldo = Number(recibo.saldo ?? total - abonosPrev - montoPagado);

  doc.setFontSize(9);
  const fila = (label, valor, bold = false, color = COLORES.textoOscuro) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setTextColor(...COLORES.textoMedio);
    doc.text(label, totalsX, y);
    doc.setTextColor(...color);
    doc.text(valor, valuesX, y, { align: "right" });
    y += bold ? 6 : 4.6;
  };
  fila("Subtotal:", formatCOP(subtotal));
  // #16: IVA condicional — si el recibo es exento (0%) no se imprime la línea.
  if (ivaPct > 0) fila(`IVA ${ivaPct}%:`, formatCOP(ivaMonto));
  doc.setDrawColor(...COLORES.borde);
  doc.line(totalsX, y - 1, valuesX, y - 1);
  y += 1.5;
  fila("Total:", formatCOP(total), true, COLORES.textoOscuro);
  if (abonosPrev > 0) fila("Abonos previos:", `-${formatCOP(abonosPrev)}`);
  fila("Monto recibido:", formatCOP(montoPagado));
  doc.setFontSize(11);
  fila("SALDO PENDIENTE:", formatCOP(saldo), true, COLORES.primario);
  y += 4;

  // ── Forma de pago + cuenta ───────────────────────────────────────────
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLORES.textoMedio);
  doc.text(`Forma de pago: ${recibo.metodo_pago ?? "—"}`, LAYOUT.margenIzq, y);
  y += 4.6;
  if (cuenta) {
    doc.text(
      `Cuenta: ${cuenta.banco} ${cuenta.tipo} ${cuenta.numero}` +
        (cuenta.titular ? ` · ${cuenta.titular}` : ""),
      LAYOUT.margenIzq,
      y,
    );
    y += 4.6;
  }
  if (recibo.observaciones) {
    const obsWrap = doc.splitTextToSize(
      `Observaciones: ${recibo.observaciones}`,
      LAYOUT.contentWidth,
    );
    doc.text(obsWrap, LAYOUT.margenIzq, y);
    y += obsWrap.length * 4.6;
  }

  // ── Firma ────────────────────────────────────────────────────────────
  const firmaY = Math.max(y + 20, LAYOUT.pageHeight - 38);
  doc.setDrawColor(...COLORES.textoMedio);
  doc.setLineWidth(0.3);
  doc.line(LAYOUT.margenIzq + 20, firmaY, LAYOUT.margenIzq + 90, firmaY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORES.textoMedio);
  doc.text("Recibido por", LAYOUT.margenIzq + 55, firmaY + 4, {
    align: "center",
  });
  doc.text(recibidoPor, LAYOUT.margenIzq + 55, firmaY - 2, {
    align: "center",
  });

  // ── Pie ──────────────────────────────────────────────────────────────
  doc.setDrawColor(...COLORES.borde);
  doc.line(
    LAYOUT.margenIzq,
    LAYOUT.pageHeight - 14,
    LAYOUT.pageWidth - LAYOUT.margenDer,
    LAYOUT.pageHeight - 14,
  );
  doc.setFontSize(7);
  doc.setTextColor(...COLORES.textoMedio);
  doc.text(
    "Este recibo no es una factura electrónica.",
    LAYOUT.pageWidth / 2,
    LAYOUT.pageHeight - 9,
    { align: "center" },
  );

  // ── API ──────────────────────────────────────────────────────────────
  const blob = doc.output("blob");
  const filename = `Recibo_${String(recibo.numero ?? "draft").padStart(5, "0")}.pdf`;

  return {
    blob,
    filename,
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
