import zlib from "node:zlib";
import { generarVentaPOS } from "./ventaPOS.js";

function analizar(nombre, args) {
  const r = generarVentaPOS(args);
  return r.blob.arrayBuffer().then((ab) => {
    const buf = Buffer.from(ab);
    const txt = buf.toString("latin1");
    const mbMatch = txt.match(/\/MediaBox \[0 0 [\d.]+ ([\d.]+)\]/);
    const pageHeightPt = mbMatch ? parseFloat(mbMatch[1]) : null;
    const pageHeightMm = pageHeightPt / 2.8346456693;

    let minY = Infinity;
    let i = 0;
    let full = "";
    for (;;) {
      const ini = buf.indexOf("stream", i);
      if (ini === -1) break;
      const fin = buf.indexOf("endstream", ini);
      if (fin === -1) break;
      let d = ini + 6;
      while (buf[d] === 0x0d || buf[d] === 0x0a) d++;
      try {
        const dec = zlib.inflateSync(buf.subarray(d, fin)).toString("latin1");
        full += dec;
      } catch {}
      i = fin + 1;
    }
    const tdRe = /(-?[\d.]+)\s+(-?[\d.]+)\s+Td/g;
    let m;
    while ((m = tdRe.exec(full))) {
      const yv = parseFloat(m[2]);
      if (yv < minY) minY = yv;
    }
    const lowestMmFromTop = (pageHeightPt - minY) / 2.8346456693;
    console.log(
      `${nombre}: pageHeightMm=${pageHeightMm.toFixed(1)}  lowestContentMmFromTop=${lowestMmFromTop.toFixed(1)}  margen=${(pageHeightMm - lowestMmFromTop).toFixed(1)}mm`,
    );
  });
}

const ventaBase = {
  numero: 1741,
  fecha: "2026-08-25T22:07:00Z",
  cliente_nombre: "JOSE ZUÑIGA MARTINEZ DE LA CRUZ VALENCIA",
  sede_id: "L3",
  subtotal: 5000000,
  total: 5000000,
  metodo_pago: "Crédito",
  anulada: false,
  observaciones:
    "Cliente pide que se entregue en la tarde despues de las 3pm porque en la mañana no hay nadie recibiendo en la bodega del taller, ojo con el portero",
  cuenta_bancaria:
    "Bancolombia Ahorros 123-456789-01 a nombre de Compresores del Valle SAS con NIT 900123456-7",
};

const itemsMuchos = Array.from({ length: 40 }, (_, i) => ({
  producto: {
    nombre: `PRODUCTO DE PRUEBA NUMERO ${i + 1} REFERENCIA LARGA XL-${i}`,
  },
  cantidad: 2,
  precio_unitario: 45000,
  subtotal: 90000,
}));

const pagos = [
  { metodo_pago: "Efectivo", monto: 1000000 },
  {
    metodo_pago: "Transferencia",
    monto: 2000000,
    cuenta_bancaria: "Nequi Digital 3103794129 a nombre de Compresores",
  },
  { metodo_pago: "Crédito", monto: 2000000 },
];

const credito = {
  abonosCotiz: 200000,
  cobros: Array.from({ length: 6 }, (_, i) => ({
    fecha: `2026-08-${10 + i}T10:00:00Z`,
    metodo_pago: "Efectivo",
    monto: 100000,
  })),
};

await analizar("Muchos items", {
  venta: ventaBase,
  items: itemsMuchos,
  pagos: [],
  vendedor: "Sofía",
});
await analizar("Obs larga + cuenta + pagos + abonos", {
  venta: ventaBase,
  items: itemsMuchos.slice(0, 5),
  pagos,
  vendedor: "Sofía",
  credito,
});
await analizar("Venta anulada", {
  venta: { ...ventaBase, anulada: true, metodo_pago: "Efectivo" },
  items: itemsMuchos.slice(0, 3),
  pagos: [],
  vendedor: "Sofía",
});
await analizar("Caso minimo", {
  venta: {
    numero: 1,
    fecha: "2026-08-25T22:07:00Z",
    sede_id: "CV",
    subtotal: 1000,
    total: 1000,
    metodo_pago: "Efectivo",
  },
  items: [
    {
      producto: { nombre: "X" },
      cantidad: 1,
      precio_unitario: 1000,
      subtotal: 1000,
    },
  ],
  pagos: [],
  vendedor: "Bladimir",
});
