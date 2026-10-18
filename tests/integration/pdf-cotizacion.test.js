/**
 * PDF de cotización — verificación del documento REAL que recibe el cliente.
 *
 * A diferencia del resto de tests de esta carpeta, este NO necesita base de
 * datos ni los fixtures de integración: genera el PDF en memoria y lee su
 * contenido. Por eso sí corre en este entorno.
 */
import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { Buffer } from "node:buffer";
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

/** Streams descomprimidos del PDF, uno por elemento (jsPDF: uno por página). */
function streamsDelPDF(observaciones, nItems) {
  const items = Array.from({ length: nItems }, (_, k) => ({
    producto: { referencia: `REF-${k}`, nombre: `Producto ${k}` },
    cantidad: 1,
    precio_unitario: 1000,
    subtotal: 1000,
  }));
  const pdf = generarCotizacionPDF({
    cotizacion: {
      numero: "TEST-2",
      fecha: "2026-08-20T12:00:00Z",
      sede_id: "CV",
      cliente_nombre: "Cliente de prueba",
      subtotal: 1000 * nItems,
      descuento_valor: 0,
      iva_pct: 19,
      domicilio: 0,
      total: 1190 * nItems,
      vigencia_dias: 15,
      observaciones,
    },
    items,
    cuentas: [],
    vendedor: "Maritza",
  });
  const buf = Buffer.from(pdf.dataUri.split(",")[1], "base64");
  const out = [];
  let i = 0;
  for (;;) {
    const ini = buf.indexOf("stream", i);
    if (ini === -1) break;
    const fin = buf.indexOf("endstream", ini);
    if (fin === -1) break;
    let desde = ini + "stream".length;
    while (buf[desde] === 0x0d || buf[desde] === 0x0a) desde++;
    try {
      out.push(zlib.inflateSync(buf.subarray(desde, fin)).toString("latin1"));
    } catch {
      // no inflable: se ignora
    }
    // Saltar "endstream" completo: con fin + 1 el siguiente "stream" que se
    // encuentra es el de la propia palabra "endstream" y se pierde una página.
    i = fin + "endstream".length;
  }
  return out;
}

describe("PDF de cotización — notas adicionales", () => {
  it("conserva los dos párrafos de las notas", () => {
    const todo = streamsDelPDF("PRIMERPARRAFO\n\nSEGUNDOPARRAFO", 1).join("\n");
    expect(todo).toContain("PRIMERPARRAFO");
    expect(todo).toContain("SEGUNDOPARRAFO");
  });

  it("el título 'Notas adicionales' nunca queda solo al pie de una hoja", () => {
    // Con distinta cantidad de ítems el título cae en distintas alturas;
    // en cada caso, la hoja que lo tiene debe tener también la primera nota.
    for (let n = 1; n <= 45; n++) {
      const paginas = streamsDelPDF("NOTAUNO", n);
      const conTitulo = paginas.filter((p) => /NOTAS ADICIONALES/i.test(p));
      expect(conTitulo.length).toBe(1);
      expect(conTitulo[0]).toContain("NOTAUNO");
    }
  });
});
