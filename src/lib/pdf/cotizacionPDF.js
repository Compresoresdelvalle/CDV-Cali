/**
 * Generador PDF de cotizaciones — Fase 11.
 *
 * Cumple §1.5 a §1.11 del MD del cliente:
 *   - Tamaño carta
 *   - IVA configurable visible
 *   - Cuentas bancarias seleccionadas al pie
 *   - "Cotizado por" auto
 *   - Texto fijo de condiciones de entrega (inmutable)
 *   - Notas adicionales libres
 *   - Tiempo de entrega como nota
 *   - Condiciones de pago
 *
 * Uso:
 *   const blob = await generarCotizacionPDF({ cotizacion, items, cuentas, vendedor });
 *   blob.download(); // o blob.print();
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  TEXTO_CONDICIONES_ENTREGA,
  MARCA,
  COLORES,
  LAYOUT,
  formatCOP,
} from "./pdfStyles";

/**
 * Genera el PDF y retorna un objeto con métodos:
 *   { blob, download(), print(), open(), dataUri }
 *
 * Args:
 *   cotizacion: { numero, fecha, cliente_nombre, cliente_nit, cliente_email,
 *                 cliente_telefono, descuento_pct, iva_pct, vigencia_dias,
 *                 subtotal, total, observaciones, condiciones_pago,
 *                 tiempo_entrega_nota }
 *   items:      [{ producto:{nombre, referencia, unidad_medida}, cantidad,
 *                  precio_unitario, subtotal }]
 *   cuentas:    [{ banco, tipo, numero, titular, marca_iva }]
 *   vendedor:   string (nombre completo)
 */
export function generarCotizacionPDF({
  cotizacion,
  items = [],
  cuentas = [],
  vendedor = "—",
}) {
  const doc = new jsPDF({
    unit: "mm",
    format: "letter",
    compress: true,
  });

  let y = LAYOUT.margenSup;

  // ── Header ─────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...COLORES.primario);
  doc.text(MARCA.nombre, LAYOUT.margenIzq, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLORES.textoMedio);
  doc.text(MARCA.ciudad, LAYOUT.margenIzq, y + 5);

  // Bloque número/fecha derecha
  const numeroStr = `Cotización N° ${String(cotizacion.numero ?? "—").padStart(5, "0")}`;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...COLORES.textoOscuro);
  doc.text(numeroStr, LAYOUT.pageWidth - LAYOUT.margenDer, y, {
    align: "right",
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLORES.textoMedio);
  const fecha = cotizacion.fecha
    ? new Date(cotizacion.fecha).toLocaleDateString("es-CO", {
        timeZone: "America/Bogota",
      })
    : "—";
  doc.text(`Fecha: ${fecha}`, LAYOUT.pageWidth - LAYOUT.margenDer, y + 5, {
    align: "right",
  });
  doc.text(
    `Validez: ${cotizacion.vigencia_dias ?? 15} días hábiles`,
    LAYOUT.pageWidth - LAYOUT.margenDer,
    y + 10,
    { align: "right" },
  );
  y += 18;

  // Línea divisoria
  doc.setDrawColor(...COLORES.primario);
  doc.setLineWidth(0.5);
  doc.line(LAYOUT.margenIzq, y, LAYOUT.pageWidth - LAYOUT.margenDer, y);
  y += 6;

  // ── Cliente ────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...COLORES.textoOscuro);
  doc.text("CLIENTE", LAYOUT.margenIzq, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const clienteLines = [
    `Nombre: ${cotizacion.cliente_nombre ?? "—"}`,
    cotizacion.cliente_nit ? `NIT: ${cotizacion.cliente_nit}` : null,
    cotizacion.cliente_telefono ? `Tel: ${cotizacion.cliente_telefono}` : null,
    cotizacion.cliente_email ? `Email: ${cotizacion.cliente_email}` : null,
  ].filter(Boolean);
  for (const line of clienteLines) {
    doc.text(line, LAYOUT.margenIzq, y);
    y += 4.5;
  }
  y += 3;

  // ── Tabla de ítems ─────────────────────────────────────────────────────
  const ivaPct = Number(cotizacion.iva_pct ?? 19);
  const descPct = Number(cotizacion.descuento_pct ?? 0);
  const subtotal = Number(cotizacion.subtotal ?? 0);
  const descuento = subtotal * (descPct / 100);
  const baseIva = subtotal - descuento;
  const ivaMonto = baseIva * (ivaPct / 100);
  const total = Number(cotizacion.total ?? baseIva + ivaMonto);

  autoTable(doc, {
    startY: y,
    head: [["#", "Referencia", "Descripción", "Cant.", "P. Unit.", "Total"]],
    body: items.map((it, i) => [
      String(i + 1),
      it.producto?.referencia ?? "—",
      it.producto?.nombre ?? "—",
      `${it.cantidad} ${it.producto?.unidad_medida ?? ""}`.trim(),
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
    bodyStyles: {
      fontSize: 9,
      textColor: COLORES.textoOscuro,
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 28 },
      2: { cellWidth: 70 },
      3: { cellWidth: 22, halign: "right" },
      4: { cellWidth: 28, halign: "right" },
      5: { cellWidth: 28, halign: "right" },
    },
    margin: { left: LAYOUT.margenIzq, right: LAYOUT.margenDer },
  });
  y = doc.lastAutoTable.finalY + 5;

  // ── Totales ────────────────────────────────────────────────────────────
  const totalsX = LAYOUT.pageWidth - LAYOUT.margenDer - 60;
  const valuesX = LAYOUT.pageWidth - LAYOUT.margenDer;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORES.textoMedio);
  doc.text("Subtotal:", totalsX, y);
  doc.setTextColor(...COLORES.textoOscuro);
  doc.text(formatCOP(subtotal), valuesX, y, { align: "right" });
  y += 4.5;
  if (descPct > 0) {
    doc.setTextColor(...COLORES.textoMedio);
    doc.text(`Descuento (${descPct}%):`, totalsX, y);
    doc.setTextColor(...COLORES.textoOscuro);
    doc.text(`-${formatCOP(descuento)}`, valuesX, y, { align: "right" });
    y += 4.5;
  }
  doc.setTextColor(...COLORES.textoMedio);
  doc.text(`IVA ${ivaPct}%:`, totalsX, y);
  doc.setTextColor(...COLORES.textoOscuro);
  doc.text(formatCOP(ivaMonto), valuesX, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLORES.primario);
  doc.text("TOTAL:", totalsX, y);
  doc.text(formatCOP(total), valuesX, y, { align: "right" });
  y += 8;

  // ── Condiciones de pago + tiempo entrega + notas ───────────────────────
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  const seccionLineas = [];
  if (cotizacion.condiciones_pago) {
    seccionLineas.push(["Condiciones de pago", cotizacion.condiciones_pago]);
  }
  if (cotizacion.tiempo_entrega_nota) {
    seccionLineas.push(["Tiempo de entrega", cotizacion.tiempo_entrega_nota]);
  }
  if (cotizacion.observaciones) {
    seccionLineas.push(["Notas adicionales", cotizacion.observaciones]);
  }

  for (const [titulo, texto] of seccionLineas) {
    if (y > LAYOUT.pageHeight - 50) {
      doc.addPage();
      y = LAYOUT.margenSup;
    }
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COLORES.textoOscuro);
    doc.text(titulo + ":", LAYOUT.margenIzq, y);
    y += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLORES.textoMedio);
    const wrapped = doc.splitTextToSize(texto, LAYOUT.contentWidth);
    doc.text(wrapped, LAYOUT.margenIzq, y);
    y += wrapped.length * 4.5 + 3;
  }

  // ── Texto fijo de condiciones de entrega §1.9 ──────────────────────────
  if (y > LAYOUT.pageHeight - 50) {
    doc.addPage();
    y = LAYOUT.margenSup;
  }
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...COLORES.textoMedio);
  const cond = doc.splitTextToSize(
    TEXTO_CONDICIONES_ENTREGA,
    LAYOUT.contentWidth,
  );
  doc.text(cond, LAYOUT.margenIzq, y);
  y += cond.length * 4 + 5;

  // ── Cuentas bancarias §1.5 ─────────────────────────────────────────────
  if (cuentas.length > 0) {
    if (y > LAYOUT.pageHeight - 50) {
      doc.addPage();
      y = LAYOUT.margenSup;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...COLORES.textoOscuro);
    doc.text("DATOS DE CONSIGNACIÓN", LAYOUT.margenIzq, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    for (const c of cuentas) {
      const marca =
        c.marca_iva === "con_iva"
          ? " (con IVA)"
          : c.marca_iva === "sin_iva"
            ? " (sin IVA)"
            : "";
      const linea = `${c.banco} ${c.tipo} ${c.numero}${c.titular ? " · " + c.titular : ""}${marca}`;
      doc.setTextColor(...COLORES.textoMedio);
      doc.text(linea, LAYOUT.margenIzq, y);
      y += 4;
    }
    y += 3;
  }

  // ── Pie en TODAS las páginas: Cotizado por + Página X de N §1.8 ────────
  // Se debe iterar al final cuando ya conocemos getNumberOfPages()
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...COLORES.borde);
    doc.line(
      LAYOUT.margenIzq,
      LAYOUT.pageHeight - 18,
      LAYOUT.pageWidth - LAYOUT.margenDer,
      LAYOUT.pageHeight - 18,
    );
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORES.textoMedio);
    doc.text(
      `Cotizado por: ${vendedor}`,
      LAYOUT.margenIzq,
      LAYOUT.pageHeight - 13,
    );
    doc.text(
      `Página ${p} de ${totalPages}`,
      LAYOUT.pageWidth - LAYOUT.margenDer,
      LAYOUT.pageHeight - 13,
      { align: "right" },
    );
  }

  // ── Retornar API ───────────────────────────────────────────────────────
  const blob = doc.output("blob");
  const filename = `Cotizacion_${String(cotizacion.numero ?? "draft").padStart(5, "0")}.pdf`;

  return {
    blob,
    filename,
    /** Solo expone dataUri lazy — base64 es costoso para PDFs grandes */
    get dataUri() {
      return doc.output("datauristring");
    },
    /** Descarga el PDF al dispositivo */
    download() {
      doc.save(filename);
    },
    /**
     * Abre nueva pestaña con preview imprimible.
     * Maneja: race con readyState, popup blockers, cleanup de blob URL.
     */
    print() {
      const url = URL.createObjectURL(blob);
      const win = window.open(url);
      if (!win) {
        // popup bloqueado: liberar URL y degradar a download
        URL.revokeObjectURL(url);
        doc.save(filename);
        return;
      }
      const triggerPrint = () => {
        try {
          win.print();
        } catch {
          // ignore — algunos visores PDF no permiten print() programático
        }
      };
      if (win.document?.readyState === "complete") {
        triggerPrint();
      } else {
        win.addEventListener("load", triggerPrint, { once: true });
      }
      // Liberar blob URL tras un tiempo prudente (la pestaña ya tiene la copia)
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    /** Solo abrir preview sin imprimir */
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
