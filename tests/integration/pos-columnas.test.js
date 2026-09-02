import { describe, it, expect } from "vitest";
import { jsPDF } from "jspdf";
import { formatCOP } from "../../src/lib/pdf/pdfStyles";
import {
  generarVentaPOS,
  anchoDescripcion,
  lineasNombre,
  W,
  MX,
  X_DESC,
  FS_ITEM,
} from "../../src/lib/pdf/ventaPOS";

/**
 * La descripción del ítem no puede invadir la columna del total.
 *
 * En el recibo 01767 salió impreso "COMPRESOR 3HP SENCILLO MONOFAS$C3O600.000":
 * el nombre del producto montado encima del importe. Dos causas sumadas.
 *
 * La primera, que el nombre se partía con `splitTextToSize` mientras seguía
 * vigente el tamaño 6,5 del encabezado, pero se dibujaba a 7: el texto salía un
 * 7,7% más ancho de lo medido.
 *
 * La segunda, que el ancho reservado (`CW - 18`) se contaba desde el margen y
 * no desde donde de verdad arranca la descripción, 9 mm más adentro. La
 * descripción llegaba hasta x=65,8 mm cuando el total empezaba en x=62,1.
 *
 * Estos tests reproducen la geometría del generador y comprueban la holgura en
 * milímetros. Ninguna prueba sobre el texto del PDF habría visto esto: los dos
 * textos están, solo que encima uno del otro.
 */

/**
 * Holgura en mm entre el final de la línea más larga de la descripción y el
 * inicio del total. Positiva = hay aire; negativa = se pisan.
 *
 * Usa `anchoDescripcion` y `lineasNombre` DEL GENERADOR, no una copia: si el
 * test reprodujera la fórmula por su cuenta, seguiría en verde aunque
 * ventaPOS.js volviera a medir mal, que es exactamente lo que pasó.
 */
function holgura(nombre, cantidad, precio) {
  const d = new jsPDF({ unit: "mm", format: [W, 1000] });
  const it = {
    producto: { nombre },
    cantidad,
    precio_unitario: precio,
    subtotal: cantidad * precio,
  };
  const ancho = anchoDescripcion(d, [it]);
  const lineas = lineasNombre(d, it, ancho);
  d.setFontSize(FS_ITEM);
  const anchoTotal = d.getTextWidth(formatCOP(it.subtotal));
  const inicioTotal = W - MX - anchoTotal;
  const finMax = Math.max(...lineas.map((l) => X_DESC + d.getTextWidth(l)));
  return inicioTotal - finMax;
}

describe("Recibo POS · la descripción no pisa el total", () => {
  it("el caso que reportó la dueña: compresor de $3.500.000", () => {
    expect(
      holgura("COMPRESOR 3HP SENCILLO MONOFASICO VERTICAL", 1, 3500000),
    ).toBeGreaterThanOrEqual(0);
  });

  it("nombre muy largo con importe de millones", () => {
    expect(
      holgura(
        "COMPRESOR INDUSTRIAL 15HP TRIFASICO DOBLE ETAPA CON TANQUE 500 LITROS",
        1,
        25000000,
      ),
    ).toBeGreaterThanOrEqual(0);
  });

  it("importe pequeño: la descripción gana espacio, no lo pierde", () => {
    const conImporteChico = holgura("EMPAQUE DE CULATA", 1, 2000);
    const conImporteGrande = holgura("EMPAQUE DE CULATA", 1, 25000000);
    expect(conImporteChico).toBeGreaterThanOrEqual(0);
    expect(conImporteGrande).toBeGreaterThanOrEqual(0);
    // Con un importe corto sobra más aire: el ancho del total se mide, no se
    // asume una constante.
    expect(conImporteChico).toBeGreaterThan(conImporteGrande);
  });

  it("cantidad de cuatro cifras no empuja la descripción", () => {
    expect(holgura("KIT DE REPARACION", 999, 999999)).toBeGreaterThanOrEqual(0);
  });

  it("una docena de un producto de nombre largo", () => {
    expect(
      holgura(
        "MANGUERA POLIURETANO 8MM X 100 METROS CON RACOR RAPIDO",
        12,
        85000,
      ),
    ).toBeGreaterThanOrEqual(0);
  });

  it("la tirilla se genera con un nombre largo sin quedar cortada", () => {
    // El alto se calcula en una pasada previa. Si esa pasada mide el nombre con
    // otro ancho que el dibujo, la tirilla sale corta y el pie se pierde.
    const venta = {
      numero: 1767,
      fecha: "2026-08-26T16:52:00.000Z",
      cliente_nombre: "NNNN PRUEBA",
      cliente_nit: "1000",
      metodo_pago: "Efectivo",
      subtotal: 3500000,
      iva_pct: 19,
      total: 4165000,
      sede_id: "CHV",
    };
    const items = [
      {
        producto: { nombre: "COMPRESOR 3HP SENCILLO MONOFASICO VERTICAL" },
        cantidad: 1,
        precio_unitario: 3500000,
        subtotal: 3500000,
      },
    ];
    const r = generarVentaPOS({ venta, items, vendedor: "Admin Maritza" });
    expect(r.blob).toBeTruthy();
    expect(r.blob.size).toBeGreaterThan(0);
  });
});
