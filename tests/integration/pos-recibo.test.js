/**
 * Recibo POS — verificación del documento REAL que se imprime en la tirilla.
 *
 * No necesita base de datos: genera el PDF en memoria, descomprime sus streams
 * Flate y comprueba el texto. Como el de cotización.
 */
import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { generarVentaPOS } from "../../src/lib/pdf/ventaPOS";
import { TEXTO_POLITICA_DEVOLUCION } from "../../src/lib/pdf/pdfStyles";

async function reciboDePrueba(extra = {}) {
  const venta = {
    numero: 1741,
    fecha: "2026-08-25T22:07:00Z",
    cliente_nombre: "JOSE ZUÑIGA",
    sede_id: "L3",
    subtotal: 405000,
    total: 405000,
    metodo_pago: "Mixto",
    anulada: false,
    ...extra,
  };
  const items = [
    {
      producto: { nombre: "CABEZOTE 1 HP 1065" },
      cantidad: 1,
      precio_unitario: 380000,
      subtotal: 380000,
    },
    {
      producto: { nombre: "FILTRO 1/2 PLASTICO" },
      cantidad: 1,
      precio_unitario: 0,
      subtotal: 0,
    },
    {
      producto: { nombre: "MANOMETRO 150 1/4 CT" },
      cantidad: 1,
      precio_unitario: 25000,
      subtotal: 25000,
    },
  ];
  const pagos = [
    { metodo_pago: "Efectivo", monto: 105000 },
    {
      metodo_pago: "Transferencia",
      monto: 300000,
      cuenta_bancaria: "Nequi Digital 3103794129",
    },
  ];
  const pdf = generarVentaPOS({ venta, items, pagos, vendedor: "Sofía" });
  // ventaPOS expone `blob`, no `dataUri` como cotizacionPDF.
  const buf = Buffer.from(await pdf.blob.arrayBuffer());
  let texto = "";
  let i = 0;
  for (;;) {
    const ini = buf.indexOf("stream", i);
    if (ini === -1) break;
    const fin = buf.indexOf("endstream", ini);
    if (fin === -1) break;
    let d = ini + "stream".length;
    while (buf[d] === 0x0d || buf[d] === 0x0a) d++;
    try {
      texto += zlib.inflateSync(buf.subarray(d, fin)).toString("latin1") + "\n";
    } catch {
      /* stream no inflable */
    }
    i = fin + 1;
  }
  return texto;
}

describe("Recibo POS", async () => {
  const texto = await reciboDePrueba();

  it("el stream se pudo descomprimir (si no, los demás asserts no valen)", () => {
    expect(texto.length).toBeGreaterThan(500);
    expect(texto).toContain("RECIBO DE VENTA");
  });

  it("sale a nombre comercial Compresores CV", () => {
    expect(texto).toContain("Compresores CV");
  });

  it("imprime la política de devoluciones", () => {
    expect(texto).toContain(TEXTO_POLITICA_DEVOLUCION.split(".")[0]);
  });

  // Una térmica es de 1 bit: el gris se simula con puntos salteados y a 6pt
  // desaparece. Ninguna línea de texto debe quedar en gris.
  //
  // jsPDF emite la escala de grises con el operador `g`: "0. g" es negro y
  // "0.471 g" era el gris que salía fantasma. Verificado que este patrón SÍ
  // detecta el gris — la primera versión buscaba "0.470588 ... rg", que jsPDF
  // no emite nunca, así que pasaba siempre sin comprobar nada.
  it("no imprime texto en gris", () => {
    expect(texto).not.toMatch(/0\.\d+ g/);
  });
});
