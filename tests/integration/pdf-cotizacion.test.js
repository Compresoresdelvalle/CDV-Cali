/**
 * PDF de cotización — verificación del documento REAL que recibe el cliente.
 *
 * A diferencia del resto de tests de esta carpeta, este NO necesita base de
 * datos ni los fixtures de integración: genera el PDF en memoria y lee su
 * contenido. Por eso sí corre en este entorno.
 */
import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { generarCotizacionPDF } from "../../src/lib/pdf/cotizacionPDF";
import { TEXTO_ENTREGA_COTIZACION } from "../../src/lib/pdf/pdfStyles";

/** Genera un PDF real, descomprime sus streams y devuelve el texto que
 *  realmente recibe el cliente. jsPDF se construye con compress:true, así que
 *  sin inflar los streams cualquier assert sobre el contenido es un falso
 *  positivo: no encontraría NADA, ni lo que sí está. */
function textoDelPDF() {
  const cotizacion = {
    numero: "TEST-1",
    fecha: "2026-08-20T12:00:00Z",
    sede_id: "CV",
    cliente_nombre: "Cliente de prueba",
    cliente_nit: "900123456",
    subtotal: 100000,
    descuento_valor: 0,
    iva_pct: 19,
    domicilio: 0,
    total: 119000,
    vigencia_dias: 15,
    observaciones: null,
  };
  const items = [
    {
      producto: { referencia: "FA-2236", nombre: "Filtro" },
      cantidad: 2,
      precio_unitario: 50000,
      subtotal: 100000,
    },
  ];
  // titular null a propósito: debe caer al nombre LEGAL de la empresa
  const cuentas = [
    { banco: "Bancolombia", tipo: "Ahorros", numero: "123-456", titular: null },
  ];

  const pdf = generarCotizacionPDF({
    cotizacion,
    items,
    cuentas,
    vendedor: "Maritza",
  });
  const buf = Buffer.from(pdf.dataUri.split(",")[1], "base64");

  let texto = "";
  let i = 0;
  for (;;) {
    const ini = buf.indexOf("stream", i);
    if (ini === -1) break;
    const fin = buf.indexOf("endstream", ini);
    if (fin === -1) break;
    let desde = ini + "stream".length;
    while (buf[desde] === 0x0d || buf[desde] === 0x0a) desde++;
    try {
      texto +=
        zlib.inflateSync(buf.subarray(desde, fin)).toString("latin1") + "\n";
    } catch {
      // stream no comprimido o no inflable: se ignora
    }
    i = fin + 1;
  }
  // El texto va dentro de paréntesis en los operadores Tj/TJ del PDF.
  return texto;
}

describe("PDF de cotización — contenido real", () => {
  const texto = textoDelPDF();

  it("el stream se pudo descomprimir (si no, los demás asserts no valen)", () => {
    expect(texto.length).toBeGreaterThan(500);
    expect(texto).toContain("COTIZACI");
  });
  it("no menciona embalaje en ninguna parte", () => {
    expect(texto.toLowerCase()).not.toContain("embalaje");
  });
  it("sale a nombre comercial Compresores CV", () => {
    expect(texto).toContain("Compresores CV");
  });
  it("conserva el nombre LEGAL en el titular de la cuenta bancaria", () => {
    expect(texto).toContain("Compresores del Valle");
  });

  // La pantalla del paso 3 muestra esta MISMA constante. Mientras el PDF la
  // imprima, lo que ve la vendedora es lo que recibe el cliente. Antes eran
  // textos distintos y la pantalla mentía diciendo "aparece siempre".
  it("imprime las condiciones de entrega que se muestran en pantalla", () => {
    const primeraFrase = TEXTO_ENTREGA_COTIZACION.split(".")[0];
    expect(texto).toContain(primeraFrase);
  });

  it("ya no contiene el texto viejo que solo vivía en pantalla", () => {
    expect(texto).not.toContain("El cliente se compromete");
  });
});
