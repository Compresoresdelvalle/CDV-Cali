/**
 * Retenciones: retefuente, reteICA y reteIVA.
 *
 * Espejo EXACTO de las columnas generadas de `ventas` y `ordenes_servicio`. Si
 * esta fórmula y la del servidor divergen, la pantalla le promete al cliente un
 * neto distinto del que la caja va a contar.
 *
 * Reglas:
 *   - retefuente y reteICA van sobre la BASE (subtotal menos descuento, sin IVA
 *     y sin domicilio).
 *   - reteIVA va sobre el IVA facturado, no sobre la base.
 *   - cada una se redondea por separado y después se suman, igual que el
 *     servidor. Redondear la suma daría un peso de diferencia.
 *
 * La factura NO se toca: `total`, IVA y subtotal quedan como están. Una
 * retención no modifica la factura; modifica cuánta plata se mueve.
 *
 * Vive en un solo archivo a propósito: lo comparten Nueva Venta, la OT, el
 * recibo POS y el PDF. Duplicar esta fórmula ya costó caro una vez.
 */

/**
 * Claves de `parametros_sistema` con las tarifas sugeridas. Maritza las edita
 * en Configuración → Parámetros.
 */
export const CLAVES_TARIFA_RETENCION = {
  retefuentePct: "retencion_retefuente_pct",
  reteicaPct: "retencion_reteica_pct",
  reteivaPct: "retencion_reteiva_pct",
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Recorta una tarifa a [0, 100], igual que el CHECK de la tabla. */
const pct = (v) => Math.min(100, Math.max(0, num(v)));

/**
 * @param {object} p
 * @param {number} p.base   subtotal menos descuento, sin IVA ni domicilio
 * @param {number} p.iva    IVA facturado
 * @param {number} p.total  total de la factura (base + IVA + domicilio)
 * @param {number} [p.retefuentePct]
 * @param {number} [p.reteicaPct]
 * @param {number} [p.reteivaPct]
 * @returns {{retefuente:number, reteica:number, reteiva:number, total:number, neto:number, hay:boolean}}
 */
export function calcularRetenciones({
  base = 0,
  iva = 0,
  total = 0,
  retefuentePct = 0,
  reteicaPct = 0,
  reteivaPct = 0,
} = {}) {
  const b = Math.max(0, num(base));
  const i = Math.max(0, num(iva));
  const t = num(total);

  const retefuente = Math.round(b * (pct(retefuentePct) / 100));
  const reteica = Math.round(b * (pct(reteicaPct) / 100));
  const reteiva = Math.round(Math.round(i) * (pct(reteivaPct) / 100));

  const suma = retefuente + reteica + reteiva;
  return {
    retefuente,
    reteica,
    reteiva,
    total: suma,
    neto: Math.max(0, Math.round(t - suma)),
    hay: suma > 0,
  };
}
