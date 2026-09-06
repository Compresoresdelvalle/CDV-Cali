/**
 * Agrupado de egresos por concepto parecido.
 *
 * El concepto es texto libre y está revuelto: "NOMIN", "NOMINAS", "NOM E" son
 * todos nómina escritos distinto. Sin agrupar, clasificar 465 movimientos uno
 * por uno no lo hace nadie, y un Resultado que depende de una tarea que nadie
 * va a hacer no sirve.
 *
 * Medido sobre los datos reales: la primera palabra normalizada produce 125
 * grupos para 465 movimientos, y **20 grupos cubren 309** de ellos. Marcar esos
 * veinte clasifica dos tercios del trabajo.
 *
 * Es SOLO ayuda para seleccionar en bloque. No asigna categoría sola: un
 * "PIDIO PLATA" únicamente lo puede clasificar quien sabe qué fue.
 */

/** Primera palabra, sin tildes ni números ni signos. */
function claveDeConcepto(concepto) {
  const limpio = String(concepto ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // tildes
    .replace(/[^A-Z ]/g, "")
    .trim();
  return limpio.split(/\s+/)[0] || "SIN CONCEPTO";
}

/**
 * @param {Array<{id:string, concepto:string|null, total:number}>} egresos
 * @returns {Array<{clave:string, items:Array, monto:number}>} de mayor a menor monto
 */
export function agruparEgresos(egresos = []) {
  const mapa = new Map();
  for (const e of egresos) {
    const k = claveDeConcepto(e.concepto);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(e);
  }
  return (
    [...mapa.entries()]
      .map(([clave, items]) => ({
        clave,
        items,
        monto: items.reduce((s, i) => s + (Number(i.total) || 0), 0),
      }))
      // Por MONTO, no por cantidad. El aviso del Resultado se mide en pesos: en
      // los datos reales, la nómina son pocos movimientos de mucha plata y la
      // gasolina son 71 de poca. Clasificar la nómina primero baja el margen de
      // error mucho más rápido.
      .sort((a, b) => b.monto - a.monto)
  );
}
