/**
 * Generador de documento imprimible de Orden de Trabajo — Fase 13B.
 *
 * Formato carta (216×279mm), misma estética que el PDF de cotización.
 * Renderiza datos ya existentes de `ordenes_servicio` + `detalle_orden`.
 *
 * Uso:
 *   const r = generarOrdenPDF({ orden, repuestos, tecnico });
 *   r.print();
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  MARCA,
  COLORES,
  LAYOUT,
  formatCOP,
  RECIBO_DIRECCION,
  SEDE_TELEFONO,
} from "./pdfStyles";
import { METODO_PAGO_LABELS } from "../ordenes-ui";

const ESTADO_LABEL = {
  abierta: "Abierta",
  en_proceso: "En proceso",
  esperando_repuesto: "Esperando repuesto",
  completada: "Completada",
  pendiente_recogida: "Pendiente de recogida",
  entregada: "Entregada",
};

/**
 * Args:
 *   orden:     { numero, fecha, cliente_nombre, cliente_telefono,
 *                equipo_descripcion, equipo_serie, diagnostico,
 *                trabajo_realizado, estado, tipo, costo_mano_obra,
 *                costo_repuestos, valor_revision, total, sede_id,
 *                fecha_entrega }
 *   repuestos: [{ producto:{nombre, referencia}, cantidad, costo_unitario,
 *                 subtotal }]
 *   tecnico:   string
 */
export function generarOrdenPDF({
  orden,
  repuestos = [],
  tecnico = "—",
  checklist = [],
  abonos = [],
  // Solo el DESGLOSE de costos (costo unitario de repuestos y el desglose de
  // mano de obra/repuestos) es información sensible y se imprime únicamente para
  // Admin. El total a pagar, los abonos y el saldo son del cliente y se imprimen
  // para todos los roles. Default true por compatibilidad.
  incluirCostos = true,
}) {
  const doc = new jsPDF({ unit: "mm", format: "letter", compress: true });
  let y = LAYOUT.margenSup;

  // ── Header ───────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...COLORES.primario);
  doc.text(MARCA.nombre, LAYOUT.margenIzq, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLORES.textoMedio);
  doc.text(MARCA.ciudad, LAYOUT.margenIzq, y + 5);
  // #22: dirección de la empresa en la OT.
  doc.text(`Dir: ${RECIBO_DIRECCION}`, LAYOUT.margenIzq, y + 9);
  // Ítem 2: el teléfono de la sede va DEBAJO de la dirección (en el encabezado),
  // no en los datos del cliente. Se omite si la sede no tiene teléfono propio.
  const telSede = SEDE_TELEFONO[orden.sede_id];
  if (telSede) doc.text(`Tel: ${telSede}`, LAYOUT.margenIzq, y + 13);

  const esGarantia = orden.tipo === "garantia";
  const titulo = `Orden de Trabajo N° ${String(orden.numero ?? "—").padStart(5, "0")}`;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...COLORES.textoOscuro);
  doc.text(titulo, LAYOUT.pageWidth - LAYOUT.margenDer, y, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLORES.textoMedio);
  const fecha = orden.fecha
    ? new Date(orden.fecha).toLocaleDateString("es-CO", {
        timeZone: "America/Bogota",
      })
    : "—";
  doc.text(`Fecha: ${fecha}`, LAYOUT.pageWidth - LAYOUT.margenDer, y + 5, {
    align: "right",
  });
  doc.text(
    `Estado: ${ESTADO_LABEL[orden.estado] ?? orden.estado ?? "—"}` +
      (esGarantia ? "  ·  GARANTÍA" : ""),
    LAYOUT.pageWidth - LAYOUT.margenDer,
    y + 10,
    { align: "right" },
  );
  y += 18;

  doc.setDrawColor(...COLORES.primario);
  doc.setLineWidth(0.5);
  doc.line(LAYOUT.margenIzq, y, LAYOUT.pageWidth - LAYOUT.margenDer, y);
  y += 6;

  // ── Cliente + equipo ─────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...COLORES.textoOscuro);
  doc.text("CLIENTE Y EQUIPO", LAYOUT.margenIzq, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLORES.textoMedio);
  const datos = [
    `Cliente: ${orden.cliente_nombre ?? "—"}`,
    orden.cliente_telefono ? `Teléfono: ${orden.cliente_telefono}` : null,
    `Equipo: ${orden.equipo_descripcion ?? "—"}`,
    orden.equipo_serie ? `Serie: ${orden.equipo_serie}` : null,
    // Ítem 2: el teléfono de la sede ahora va en el encabezado (junto a la
    // dirección), no aquí en los datos del cliente.
    `Sede: ${orden.sede_id ?? "—"}`,
    orden.fecha_entrega
      ? `Entregado: ${new Date(orden.fecha_entrega).toLocaleDateString("es-CO", { timeZone: "America/Bogota" })}`
      : null,
  ].filter(Boolean);
  for (const d of datos) {
    doc.text(d, LAYOUT.margenIzq, y);
    y += 4.5;
  }
  y += 3;

  // ── Diagnóstico / trabajo ────────────────────────────────────────────
  const bloques = [];
  if (orden.diagnostico) bloques.push(["Diagnóstico", orden.diagnostico]);
  if (orden.trabajo_realizado)
    bloques.push(["Trabajo realizado", orden.trabajo_realizado]);
  for (const [tit, txt] of bloques) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...COLORES.textoOscuro);
    doc.text(tit + ":", LAYOUT.margenIzq, y);
    y += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COLORES.textoMedio);
    const wrap = doc.splitTextToSize(txt, LAYOUT.contentWidth);
    doc.text(wrap, LAYOUT.margenIzq, y);
    y += wrap.length * 4.5 + 3;
  }

  // ── Checklist de recepción (#24) ─────────────────────────────────────
  // Marcado = el cliente lo trajo. Sin marcar = no llegó (soporte legal).
  if (checklist.length > 0) {
    if (y > LAYOUT.pageHeight - 55) {
      doc.addPage();
      y = LAYOUT.margenSup;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...COLORES.textoOscuro);
    doc.text("CHECKLIST DE RECEPCIÓN", LAYOUT.margenIzq, y);
    y += 5;
    doc.setFontSize(9);
    const colW = LAYOUT.contentWidth / 2;
    const half = Math.ceil(checklist.length / 2);
    const startY = y;
    checklist.forEach((c, i) => {
      const col = i < half ? 0 : 1;
      const row = col === 0 ? i : i - half;
      const x = LAYOUT.margenIzq + col * colW;
      const yy = startY + row * 4.8;
      doc.setFont("helvetica", c.marcado ? "bold" : "normal");
      doc.setTextColor(
        ...(c.marcado ? COLORES.textoOscuro : COLORES.textoMedio),
      );
      doc.text(`${c.marcado ? "[X]" : "[  ]"} ${c.nombre}`, x, yy);
    });
    y = startY + half * 4.8 + 4;
    doc.setTextColor(...COLORES.textoOscuro);
  }

  // ── Tabla de repuestos ───────────────────────────────────────────────
  if (repuestos.length > 0) {
    const cabecera = incluirCostos
      ? ["#", "Referencia", "Repuesto", "Cant.", "Costo unit.", "Total"]
      : ["#", "Referencia", "Repuesto", "Cant."];
    const cuerpo = repuestos.map((it, i) => {
      const fila = [
        String(i + 1),
        it.producto?.referencia ?? "—",
        it.producto?.nombre ?? "—",
        String(it.cantidad ?? 0),
      ];
      if (incluirCostos) {
        fila.push(formatCOP(it.costo_unitario), formatCOP(it.subtotal));
      }
      return fila;
    });
    autoTable(doc, {
      startY: y,
      head: [cabecera],
      body: cuerpo,
      theme: "grid",
      headStyles: {
        fillColor: COLORES.primario,
        textColor: 255,
        fontStyle: "bold",
        fontSize: 9,
      },
      bodyStyles: { fontSize: 9, textColor: COLORES.textoOscuro },
      columnStyles: incluirCostos
        ? {
            0: { cellWidth: 10, halign: "center" },
            1: { cellWidth: 30 },
            2: { cellWidth: 70 },
            3: { cellWidth: 18, halign: "right" },
            4: { cellWidth: 29, halign: "right" },
            5: { cellWidth: 29, halign: "right" },
          }
        : {
            0: { cellWidth: 10, halign: "center" },
            1: { cellWidth: 38 },
            2: { cellWidth: 108 },
            3: { cellWidth: 20, halign: "right" },
          },
      margin: { left: LAYOUT.margenIzq, right: LAYOUT.margenDer },
    });
    y = doc.lastAutoTable.finalY + 5;
  } else {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(...COLORES.textoMedio);
    doc.text("Sin repuestos registrados.", LAYOUT.margenIzq, y);
    y += 7;
  }

  // ── Resumen económico ────────────────────────────────────────────────
  // El DESGLOSE de costos (mano de obra / repuestos / valor de revisión) solo
  // se imprime para Admin porque revela el costo de los repuestos. El TOTAL a
  // pagar, los ABONOS del cliente y el SALDO se imprimen para todos los roles.
  {
    const totalsX = LAYOUT.pageWidth - LAYOUT.margenDer - 60;
    const valuesX = LAYOUT.pageWidth - LAYOUT.margenDer;
    const manoObra = Number(orden.costo_mano_obra ?? 0);
    const costoRep = Number(orden.costo_repuestos ?? 0);
    const valorRev = Number(orden.valor_revision ?? 0);
    // TOTAL autoconsistente con las líneas (mano obra + repuestos + valor de
    // revisión). Equivale a orden.total (canónico en BD), pero se computa de los
    // componentes para no caer en `orden.total ?? ...` cuando total = 0.
    const total = manoObra + costoRep + valorRev;
    const abonado = abonos.reduce((s, a) => s + (Number(a.monto) || 0), 0);
    const saldo = total - abonado;

    const filaT = (label, valor) => {
      doc.setTextColor(...COLORES.textoMedio);
      doc.text(label, totalsX, y);
      doc.setTextColor(...COLORES.textoOscuro);
      doc.text(valor, valuesX, y, { align: "right" });
      y += 4.5;
    };

    // Desglose de costos: SOLO Admin.
    if (incluirCostos) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      filaT("Revisión de servicio:", formatCOP(manoObra));
      filaT("Repuestos:", formatCOP(costoRep));
      if (valorRev > 0) filaT("Valor de revisión:", formatCOP(valorRev));
      y += 1.5;
    }

    // Total a pagar: TODOS los roles (es lo que paga el cliente).
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...COLORES.primario);
    doc.text("TOTAL:", totalsX, y);
    doc.text(formatCOP(total), valuesX, y, { align: "right" });
    y += 7;

    // Abonos del cliente: TODOS los roles, si hay alguno registrado.
    if (abonos.length > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...COLORES.textoOscuro);
      doc.text(`Abonos (${abonos.length})`, LAYOUT.margenIzq, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      abonos.forEach((a) => {
        const f = a.fecha
          ? new Date(a.fecha).toLocaleDateString("es-CO", {
              timeZone: "America/Bogota",
            })
          : "—";
        const metodo = METODO_PAGO_LABELS[a.metodo_pago] ?? a.metodo_pago ?? "";
        const nota = a.observaciones ? ` · ${a.observaciones}` : "";
        let izq = `${f} · ${metodo}${nota}`;
        if (izq.length > 62) izq = izq.slice(0, 60) + "…";
        doc.setTextColor(...COLORES.textoMedio);
        doc.text(izq, LAYOUT.margenIzq, y);
        doc.setTextColor(...COLORES.textoOscuro);
        doc.text(formatCOP(a.monto), valuesX, y, { align: "right" });
        y += 4.2;
      });
      y += 1.5;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      filaT("Abonado:", formatCOP(abonado));
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...COLORES.primario);
      // El documento del cliente nunca muestra saldo negativo: un sobre-abono se
      // presenta como "Saldo a favor" (crédito del cliente), no como saldo < 0 (ORDENES-02).
      const saldoAFavor = saldo < 0;
      doc.text(saldoAFavor ? "Saldo a favor:" : "Saldo:", totalsX, y);
      doc.text(formatCOP(Math.abs(saldo)), valuesX, y, { align: "right" });
      y += 6;
    }
    y += 4;
  }

  // ── Firmas ───────────────────────────────────────────────────────────
  if (y > LAYOUT.pageHeight - 40) {
    doc.addPage();
    y = LAYOUT.margenSup;
  }
  const firmaY = Math.max(y + 12, LAYOUT.pageHeight - 40);
  const colW = LAYOUT.contentWidth / 2;
  doc.setDrawColor(...COLORES.textoMedio);
  doc.setLineWidth(0.3);
  doc.line(LAYOUT.margenIzq + 8, firmaY, LAYOUT.margenIzq + colW - 8, firmaY);
  doc.line(
    LAYOUT.margenIzq + colW + 8,
    firmaY,
    LAYOUT.pageWidth - LAYOUT.margenDer - 8,
    firmaY,
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORES.textoMedio);
  doc.text("Técnico responsable", LAYOUT.margenIzq + colW / 2, firmaY + 4, {
    align: "center",
  });
  doc.text(
    "Recibí conforme (cliente)",
    LAYOUT.margenIzq + colW + colW / 2,
    firmaY + 4,
    { align: "center" },
  );

  // ── Pie ──────────────────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...COLORES.borde);
    doc.line(
      LAYOUT.margenIzq,
      LAYOUT.pageHeight - 14,
      LAYOUT.pageWidth - LAYOUT.margenDer,
      LAYOUT.pageHeight - 14,
    );
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORES.textoMedio);
    doc.text(`Técnico: ${tecnico}`, LAYOUT.margenIzq, LAYOUT.pageHeight - 9);
    doc.text(
      `Página ${p} de ${totalPages}`,
      LAYOUT.pageWidth - LAYOUT.margenDer,
      LAYOUT.pageHeight - 9,
      { align: "right" },
    );
  }

  // ── API ──────────────────────────────────────────────────────────────
  const blob = doc.output("blob");
  const filename = `OT_${String(orden.numero ?? "draft").padStart(5, "0")}.pdf`;

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
