/**
 * Generador de recibo POS de venta — Fase 13B.
 *
 * Formato tirilla 80mm de ancho, alto dinámico (estilo impresora térmica).
 * Renderiza datos ya existentes de `ventas` + `detalle_venta`; NO toca BD.
 *
 * Uso:
 *   const r = generarVentaPOS({ venta, items, vendedor });
 *   r.print();   // abre preview imprimible
 *   r.download(); // descarga el PDF
 */
import { jsPDF } from "jspdf";
import {
  MARCA,
  NOMBRE_COMERCIAL,
  SEDE_TELEFONO,
  RECIBO_DIRECCION,
  formatCOP,
} from "./pdfStyles";

const W = 80; // ancho tirilla en mm
const MX = 5; // margen lateral
const CW = W - MX * 2; // ancho contenido

/**
 * Args:
 *   venta:   { numero, fecha, cliente_nombre, cliente_nit, metodo_pago,
 *              subtotal, descuento_pct, iva_pct, total, sede_id }
 *   items:   [{ producto:{nombre, referencia, unidad_medida}, cantidad,
 *               precio_unitario, subtotal }]
 *   vendedor: string
 */
export function generarVentaPOS({
  venta,
  items = [],
  pagos = [],
  vendedor = "—",
  credito = { abonosCotiz: 0, cobros: [] },
}) {
  // Altura: medición real de los ítems (pass 1) para que nombres largos que
  // envuelven a varias líneas no desborden la tirilla.
  const probe = new jsPDF({ unit: "mm", format: [W, 1000] });
  probe.setFontSize(7);
  let itemsAlto = 0;
  for (const it of items) {
    // B3: las líneas de servicio no tienen producto; usan `descripcion`.
    const lineas = probe.splitTextToSize(
      it.descripcion ?? it.producto?.nombre ?? "—",
      CW - 18,
    );
    // 3.6 primera línea + 3.6 por cada línea extra del nombre + 4.2 precio c/u
    itemsAlto += 3.6 + Math.max(0, lineas.length - 1) * 3.6 + 4.2;
  }
  // #15: la observación puede ocupar varias líneas — reservar su alto.
  let obsAlto = 0;
  if (venta.observaciones) {
    const ol = probe.splitTextToSize(`Obs: ${venta.observaciones}`, CW);
    obsAlto = ol.length * 3.4 + 4;
  }
  // B1 (ít 6): la cuenta destino puede envolver — reservar su alto.
  let ctaAlto = 0;
  if (venta.cuenta_bancaria) {
    const cl = probe.splitTextToSize(`Cuenta: ${venta.cuenta_bancaria}`, CW);
    ctaAlto = cl.length * 3.4 + 1;
  }
  // #S1-04: desglose de pago (una línea por forma de pago) — reservar su alto.
  const pagosAlto = pagos.length > 0 ? pagos.length * 4 + 4 : 0;
  // #S1-05: la marca de "ANULADA" agrega una línea de encabezado.
  const anulAlto = venta.anulada ? 6 : 0;

  // Cuando una venta a CRÉDITO tiene abonos, la tirilla muestra el desglose de
  // abonos + saldo pendiente, así el mismo recibo sirve de comprobante del abono.
  const cobrosAbono = credito?.cobros ?? [];
  const abonoCotiz = Number(credito?.abonosCotiz ?? 0);
  const abonadoTotal =
    abonoCotiz + cobrosAbono.reduce((s, a) => s + Number(a.monto ?? 0), 0);
  // Método exacto 'Crédito' (igual que la pantalla y el CHECK de la BD). El
  // bloque solo se muestra si HAY abonos: un recibo sin abonos no lo lleva, y
  // los recibos de OT (que no traen este contexto) no mostrarían un saldo falso.
  const esCredito = String(venta.metodo_pago ?? "") === "Crédito";
  const hayAbonos = abonadoTotal > 0 && esCredito;
  const nAbonos = cobrosAbono.length + (abonoCotiz > 0 ? 1 : 0);
  // Reserva ≥ alto real: línea+header (~9.8) + n·3.6 + Abonado+SALDO (~9.8).
  const abonosAlto = hayAbonos ? nAbonos * 3.6 + 22 : 0;

  // header ~58 + items + obs + cuenta + pagos + anulada + abonos + totales ~50 + footer ~25
  const altura = Math.max(
    58 +
      itemsAlto +
      obsAlto +
      ctaAlto +
      pagosAlto +
      anulAlto +
      abonosAlto +
      50 +
      25,
    120,
  );

  const doc = new jsPDF({
    unit: "mm",
    format: [W, altura],
    compress: true,
  });

  let y = 8;
  const center = W / 2;

  // ── Encabezado empresa (#14: nombre comercial + teléfono de la sede) ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(NOMBRE_COMERCIAL, center, y, { align: "center" });
  y += 4.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(`${RECIBO_DIRECCION} · ${MARCA.ciudad}`, center, y, {
    align: "center",
  });
  y += 3.8;
  const telSede = SEDE_TELEFONO[venta.sede_id];
  if (telSede) {
    doc.text(`Tel: ${telSede}`, center, y, { align: "center" });
    y += 3.8;
  }
  y += 2;

  // Línea
  doc.setLineWidth(0.2);
  doc.line(MX, y, W - MX, y);
  y += 5;

  // ── Datos de la venta ────────────────────────────────────────────────
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text(
    `RECIBO DE VENTA N° ${String(venta.numero ?? "—").padStart(5, "0")}`,
    center,
    y,
    { align: "center" },
  );
  y += 5;

  // #S1-05: sello visible cuando la venta está anulada (para que un recibo
  // reimpreso de una venta anulada no pase por válido).
  if (venta.anulada) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(200, 30, 30);
    doc.text("*** ANULADA — NO VÁLIDA ***", center, y, { align: "center" });
    doc.setTextColor(0, 0, 0);
    y += 5;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const fecha = venta.fecha
    ? new Date(venta.fecha).toLocaleString("es-CO", {
        timeZone: "America/Bogota",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
  doc.text(`Fecha: ${fecha}`, MX, y);
  y += 3.8;
  doc.text(`Cliente: ${venta.cliente_nombre || "Mostrador"}`, MX, y);
  y += 3.8;
  if (venta.cliente_nit) {
    doc.text(`NIT/CC: ${venta.cliente_nit}`, MX, y);
    y += 3.8;
  }
  doc.text(`Sede: ${venta.sede_id ?? "—"}`, MX, y);
  y += 3.8;
  doc.text(`Atendió: ${vendedor}`, MX, y);
  y += 5;

  // Línea
  doc.line(MX, y, W - MX, y);
  y += 4;

  // ── Ítems ────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.text("CANT  DESCRIPCIÓN", MX, y);
  doc.text("TOTAL", W - MX, y, { align: "right" });
  y += 3.5;
  doc.setFont("helvetica", "normal");

  for (const it of items) {
    const nombre = it.descripcion ?? it.producto?.nombre ?? "—";
    const cant = it.cantidad ?? 0;
    const precio = Number(it.precio_unitario ?? 0);
    const sub = Number(it.subtotal ?? cant * precio);

    // Línea 1: cantidad + nombre (envuelto)
    const nombreLines = doc.splitTextToSize(nombre, CW - 18);
    doc.setFontSize(7);
    doc.text(String(cant), MX, y);
    doc.text(nombreLines[0], MX + 9, y);
    doc.text(formatCOP(sub), W - MX, y, { align: "right" });
    y += 3.6;
    // Líneas extra del nombre si es largo
    for (let i = 1; i < nombreLines.length; i++) {
      doc.text(nombreLines[i], MX + 9, y);
      y += 3.6;
    }
    // Línea 2: precio unitario
    doc.setFontSize(6);
    doc.setTextColor(120, 120, 120);
    doc.text(`  ${formatCOP(precio)} c/u`, MX + 9, y);
    doc.setTextColor(0, 0, 0);
    y += 4.2;
  }

  // Línea
  doc.line(MX, y, W - MX, y);
  y += 4.5;

  // ── Totales ──────────────────────────────────────────────────────────
  const subtotal = Number(
    venta.subtotal > 0
      ? venta.subtotal
      : items.reduce((s, it) => s + Number(it.subtotal ?? 0), 0),
  );
  // B3: descuento en $ (cae al % legado si no hay valor); domicilio tras el IVA.
  const descPct = Number(venta.descuento_pct ?? 0);
  const descValor =
    venta.descuento_valor != null
      ? Number(venta.descuento_valor)
      : subtotal * (descPct / 100);
  const descuento = Math.min(Math.max(0, descValor), subtotal);
  const baseIva = subtotal - descuento;
  const ivaPct = Number(venta.iva_pct ?? 19);
  const iva = baseIva * (ivaPct / 100);
  const domicilio = Math.max(0, Number(venta.domicilio ?? 0));
  const total = Number(
    venta.total > 0 ? venta.total : baseIva + iva + domicilio,
  );

  doc.setFontSize(7.5);
  const fila = (label, valor, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(label, MX, y);
    doc.text(valor, W - MX, y, { align: "right" });
    y += bold ? 5 : 3.8;
  };
  fila("Subtotal:", formatCOP(subtotal));
  if (descuento > 0) fila("Descuento:", `-${formatCOP(descuento)}`);
  // #16: IVA condicional — si la venta es exenta (0%) no se imprime la línea.
  if (ivaPct > 0) fila(`IVA ${ivaPct}%:`, formatCOP(iva));
  if (domicilio > 0) fila("Domicilio:", formatCOP(domicilio));
  doc.setFontSize(9);
  fila("TOTAL:", formatCOP(total), true);

  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  // #S1-04: si hay desglose real (pago Mixto o electrónico), se imprime una
  // línea por forma de pago con su cuenta; si no, el método único de la venta.
  if (pagos.length > 0) {
    fila("Forma de pago:", String(venta.metodo_pago ?? "Mixto"));
    doc.setFontSize(6.8);
    for (const p of pagos) {
      const etiqueta = p.cuenta_bancaria
        ? `  ${p.metodo_pago} · ${p.cuenta_bancaria}`
        : `  ${p.metodo_pago}`;
      const lbl = doc.splitTextToSize(etiqueta, CW - 20);
      doc.text(lbl, MX, y);
      doc.text(formatCOP(p.monto), W - MX, y, { align: "right" });
      y += lbl.length * 3.4;
    }
    y += 1;
    doc.setFontSize(7);
  } else {
    fila("Forma de pago:", String(venta.metodo_pago ?? "—"));
    // B1 (ít 6): cuenta destino del pago, si se registró (puede envolver).
    if (venta.cuenta_bancaria) {
      doc.setFontSize(6.5);
      const cta = doc.splitTextToSize(`Cuenta: ${venta.cuenta_bancaria}`, CW);
      doc.text(cta, MX, y);
      y += cta.length * 3.4 + 1;
      doc.setFontSize(7);
    }
  }

  // #15: observación de la venta en el recibo (si existe).
  if (venta.observaciones) {
    y += 1;
    doc.setFontSize(6.5);
    const obs = doc.splitTextToSize(`Obs: ${venta.observaciones}`, CW);
    doc.text(obs, MX, y);
    y += obs.length * 3.4 + 1;
    doc.setFontSize(7);
  }

  // ── Abonos y saldo pendiente (venta a crédito con abonos) ────────────
  if (hayAbonos) {
    y += 2;
    doc.line(MX, y, W - MX, y);
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("ABONOS", MX, y);
    y += 3.8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    if (abonoCotiz > 0) {
      doc.text("Abono de cotización", MX, y);
      doc.text(formatCOP(abonoCotiz), W - MX, y, { align: "right" });
      y += 3.6;
    }
    for (const a of cobrosAbono) {
      const fAb = a.fecha
        ? new Date(a.fecha).toLocaleDateString("es-CO", {
            timeZone: "America/Bogota",
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
          })
        : "";
      const met = a.metodo_pago ? ` ${a.metodo_pago}` : "";
      doc.text(`${fAb}${met}`.trim() || "Abono", MX, y);
      doc.text(formatCOP(Number(a.monto ?? 0)), W - MX, y, { align: "right" });
      y += 3.6;
    }
    y += 1;
    doc.setFontSize(7.5);
    fila("Abonado:", formatCOP(abonadoTotal));
    const saldoPend = Math.max(0, total - abonadoTotal);
    doc.setFontSize(9);
    fila("SALDO PENDIENTE:", formatCOP(saldoPend), true);
    doc.setFontSize(7);
  }

  y += 2;
  doc.line(MX, y, W - MX, y);
  y += 5;

  // ── Pie ──────────────────────────────────────────────────────────────
  doc.setFontSize(7);
  doc.setFont("helvetica", "italic");
  doc.text("¡Gracias por su compra!", center, y, { align: "center" });
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(120, 120, 120);
  doc.text("Este recibo no es una factura electrónica.", center, y, {
    align: "center",
  });

  // #S1-05: marca de agua diagonal "ANULADA" superpuesta (además del sello del
  // encabezado). Solo si el visor soporta opacidad; si no, se omite para no
  // tapar el contenido con texto sólido.
  if (venta.anulada) {
    let okOpacidad = true;
    doc.saveGraphicsState();
    try {
      doc.setGState(new doc.GState({ opacity: 0.18 }));
    } catch {
      okOpacidad = false;
    }
    if (okOpacidad) {
      doc.setTextColor(200, 30, 30);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(30);
      doc.text("ANULADA", center, altura / 2, {
        align: "center",
        angle: 35,
      });
      doc.setTextColor(0, 0, 0);
    }
    doc.restoreGraphicsState();
  }

  // ── API ──────────────────────────────────────────────────────────────
  const blob = doc.output("blob");
  const filename = `Recibo_Venta_${String(venta.numero ?? "draft").padStart(5, "0")}.pdf`;

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
