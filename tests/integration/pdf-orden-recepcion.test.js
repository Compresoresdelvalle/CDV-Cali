/**
 * Constancia de recepción de OT — el papel que el cliente se lleva.
 *
 * Nace de un reporte de la dueña: escribía el "Diagnóstico inicial" al crear la
 * orden y no salía impreso. Era cierto y llevaba roto desde el 21 de junio: el
 * rediseño del flujo de OT lo excluyó de la recepción suponiendo que "aún no
 * existe al recibir el equipo", cuando el formulario de creación sí lo pide.
 * Entre esa fecha y el arreglo se entregaron 173 hojas sin esa descripción.
 *
 * Se genera el PDF de verdad y se descomprimen sus streams: jsPDF usa
 * compress:true, así que sin inflar, cualquier assert sobre el contenido es un
 * falso positivo, porque no encontraría NADA, ni lo que sí está.
 */
import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { generarOrdenPDF } from "../../src/lib/pdf/ordenPDF";

const DIAGNOSTICO = "LLEGA SIN TAPA Y CON LA CARCASA GOLPEADA";
const TRABAJO = "SE CAMBIO EL EMPAQUE";

async function textoDelPDF(modo) {
  const pdf = generarOrdenPDF({
    orden: {
      numero: 1234,
      fecha: "2026-08-31T12:00:00Z",
      cliente_nombre: "Cliente de prueba",
      cliente_telefono: "3001234567",
      equipo_descripcion: "COMPRESOR 5HP",
      equipo_serie: "SN12345",
      diagnostico: DIAGNOSTICO,
      trabajo_realizado: TRABAJO,
      estado: "recepcion",
      sede_id: "CV",
      total: 0,
    },
    tecnico: "TecPrueba",
    checklist: [],
    modo,
  });

  // ordenPDF expone `blob`, igual que ventaPOS (cotizacionPDF usa `dataUri`).
  const buf = Buffer.from(await pdf.blob.arrayBuffer());

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
  return texto;
}

/** El texto viaja troceado por el interletrado, así que se comparan sólo las
 *  letras: si no, una palabra partida en dos operadores daría falso negativo.
 *  Las tildes se quitan de los dos lados: en el PDF la "ó" es un byte suelto de
 *  la codificación del tipo de letra, no la misma "ó" que se escribe aquí. */
const soloLetras = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();

describe("constancia de recepción", async () => {
  const texto = await textoDelPDF("recepcion");
  const plano = soloLetras(texto);

  it("el stream se pudo descomprimir (si no, los demás asserts no valen)", () => {
    expect(texto.length).toBeGreaterThan(500);
    expect(plano).toContain(soloLetras("COMPRESOR 5HP"));
  });

  it("imprime el diagnóstico inicial que se escribió al crear la orden", () => {
    expect(plano).toContain(soloLetras(DIAGNOSTICO));
  });

  it("lo rotula como en el formulario, para que se reconozca", () => {
    expect(plano).toContain(soloLetras("Diagnostico inicial"));
  });

  it("NO imprime el trabajo realizado: al recibir no se ha hecho ninguno", () => {
    expect(plano).not.toContain(soloLetras(TRABAJO));
  });
});

describe("documento final de la OT", async () => {
  const plano = soloLetras(await textoDelPDF("final"));

  it("sigue imprimiendo el diagnóstico", () => {
    expect(plano).toContain(soloLetras(DIAGNOSTICO));
  });

  it("y ahí sí el trabajo realizado", () => {
    expect(plano).toContain(soloLetras(TRABAJO));
  });
});
