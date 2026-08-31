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
import { Buffer } from "node:buffer";
import { generarOrdenPDF } from "../../src/lib/pdf/ordenPDF";

const DIAGNOSTICO = "LLEGA SIN TAPA Y CON LA CARCASA GOLPEADA";
const TRABAJO = "SE CAMBIO EL EMPAQUE";

function construir(modo, over = {}) {
  return generarOrdenPDF({
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
      ...over,
    },
    tecnico: "TecPrueba",
    checklist: [],
    modo,
  });
}

/** Devuelve los streams del PDF ya descomprimidos y concatenados. */
async function streams(pdf) {
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

const textoDelPDF = (modo, over) => streams(construir(modo, over));

/**
 * Coordenada vertical más baja a la que se escribe algo, en puntos.
 *
 * jsPDF posiciona con `x y Td` midiendo desde el PIE de la página, así que
 * un valor negativo es texto dibujado por debajo del borde: se pierde al
 * imprimir y jsPDF no avisa. Es la única forma de comprobar el recorte, porque
 * el texto recortado igual aparece dentro del stream.
 */
async function menorY(pdf) {
  const ys = [...(await streams(pdf)).matchAll(/([-\d.]+) ([-\d.]+) Td/g)].map(
    (m) => Number(m[2]),
  );
  expect(ys.length).toBeGreaterThan(10); // si no hay coordenadas, no se midió nada
  return Math.min(...ys);
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

describe("un diagnóstico largo no se sale de la hoja", () => {
  // El textarea de OrdenNueva no tiene tope de longitud, y jsPDF dibuja igual
  // por debajo del borde inferior: el sobrante se pierde al imprimir sin que
  // nada avise. Sería la misma queja de la dueña — texto escrito que no sale
  // en el papel — sólo que por otra puerta.
  //
  // Contar páginas NO sirve como comprobación: la sección de firmas ya añade
  // una página por su cuenta cuando el contenido creció, así que el conteo da
  // 2 con recorte y sin él. Lo que discrimina es la coordenada.
  it("nunca escribe por debajo del borde de la hoja", async () => {
    const largo = "RAYON EN LA CARCASA. ".repeat(250); // ~5.000 caracteres
    expect(
      await menorY(construir("recepcion", { diagnostico: largo })),
    ).toBeGreaterThan(0);
  });

  it("y una orden normal tampoco, claro", async () => {
    // 363 caracteres es el diagnóstico más largo que existe hoy en la base.
    expect(
      await menorY(construir("recepcion", { diagnostico: "A".repeat(363) })),
    ).toBeGreaterThan(0);
  });
});
