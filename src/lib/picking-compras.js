/**
 * Lógica pura del picking de recepción de compras.
 *
 * Sin React y sin Supabase a propósito: es la parte donde un error cuesta plata
 * (una unidad mal clasificada termina en un reclamo que no era, o en una
 * factura mal ajustada), así que tiene que poder probarse sola.
 *
 * La regla que gobierna todo: el campo "llegaron" arranca en CERO, y por eso el
 * cero es ambiguo entre "no llegó nada" y "todavía no lo cuento". La bandera
 * `contada` es la que desambigua, y NADA puede confirmarse mientras alguna
 * línea siga sin contar. Importa de verdad: `fn_recibir_compra` BORRA la línea
 * que reciba en cero.
 */

export const METODO = {
  MANUAL: "manual",
  ESCANER: "escaner",
  COMPLETO: "completo",
  NADA: "nada",
};

/**
 * Estado de línea → props de StatusBadge.
 *
 * Vive aquí y no en cada pantalla para que el modo lista y el modo enfoque no
 * puedan discrepar. StatusBadge SOLO acepta success|warning|danger|info|neutral.
 * Siempre color Y texto: con guantes, polvo y contraluz el color solo no alcanza.
 */
export const BADGE = {
  sin_contar: { status: "neutral", texto: "Sin contar" },
  completo: { status: "success", texto: "Completo" },
  faltan: { status: "warning", texto: "Faltan" },
  danadas: { status: "danger", texto: "Dañadas" },
  sobran: { status: "info", texto: "Sobran" },
};

/** Estado inicial de una línea a partir de su `detalle_compra`. */
export function lineaNueva(detalle) {
  return {
    detalle_id: detalle.id,
    producto_id: detalle.producto_id,
    referencia: detalle.producto?.referencia ?? "",
    nombre: detalle.producto?.nombre ?? "",
    destino: detalle.destino ?? "venta",
    costo_unitario: Number(detalle.costo_unitario ?? 0),
    pedido: Number(detalle.cantidad ?? 0),
    llegaron: 0,
    danadas: 0,
    contada: false,
    metodo: null,
    faltante_accion: null, // 'ajustar' | 'reclamar'
    sobrante_accion: null, // 'entra' | 'entra_y_reporta'
  };
}

const num = (v) => Math.max(0, Math.round(Number(v) || 0));

/** Números derivados y el estado que pinta el semáforo. */
export function derivar(linea) {
  const llegaron = num(linea.llegaron);
  const danadas = Math.min(num(linea.danadas), llegaron);
  const pedido = num(linea.pedido);

  const buenas = llegaron - danadas;
  const faltan = Math.max(0, pedido - llegaron);
  const sobran = Math.max(0, llegaron - pedido);

  // El orden importa: se muestra lo más grave primero. Una línea puede tener
  // faltante Y dañadas a la vez, y el badge tiene que enseñar lo peor.
  let estado = "completo";
  if (!linea.contada) estado = "sin_contar";
  else if (danadas > 0) estado = "danadas";
  else if (faltan > 0) estado = "faltan";
  else if (sobran > 0) estado = "sobran";

  return { llegaron, danadas, buenas, faltan, sobran, pedido, estado };
}

/** Totales de la pantalla y si se puede confirmar (con el porqué si no). */
export function resumen(lineas) {
  const total = lineas.length;
  let contadas = 0;
  let aReclamar = 0;
  let aAjustar = 0;
  let deMas = 0;
  let sinDecidirFaltante = 0;
  let sinDecidirSobrante = 0;

  for (const l of lineas) {
    const d = derivar(l);
    if (l.contada) contadas += 1;
    if (!l.contada) continue;

    aReclamar += d.danadas;
    if (d.faltan > 0) {
      if (l.faltante_accion === "reclamar") aReclamar += d.faltan;
      else if (l.faltante_accion === "ajustar") aAjustar += d.faltan;
      else sinDecidirFaltante += 1;
    }
    if (d.sobran > 0) {
      if (l.sobrante_accion) deMas += d.sobran;
      else sinDecidirSobrante += 1;
    }
  }

  const sinContar = total - contadas;
  // Todo en cero no es un picking, es una compra que no llego. fn_recibir_compra
  // borraria TODAS las lineas y rebotaria con "usa Cancelar compra". Mejor
  // atajarlo aqui y mandar a cancelar, que dejar que reviente contra la base.
  const todoEnCero =
    total > 0 && lineas.every((l) => l.contada && derivar(l).llegaron === 0);

  let motivoBloqueo = null;
  if (todoEnCero) {
    motivoBloqueo =
      "No llegó nada de esta compra. Eso no se recibe: hay que cancelarla desde su detalle.";
  } else if (sinContar > 0) {
    motivoBloqueo = `Faltan ${sinContar} línea${sinContar === 1 ? "" : "s"} por contar`;
  } else if (sinDecidirFaltante > 0) {
    motivoBloqueo = `Falta decidir qué se hace con el faltante en ${sinDecidirFaltante} línea${sinDecidirFaltante === 1 ? "" : "s"}`;
  } else if (sinDecidirSobrante > 0) {
    motivoBloqueo = `Falta decidir qué se hace con el sobrante en ${sinDecidirSobrante} línea${sinDecidirSobrante === 1 ? "" : "s"}`;
  }

  return {
    total,
    contadas,
    sinContar,
    aReclamar,
    aAjustar,
    deMas,
    todoEnCero,
    listo: motivoBloqueo === null && total > 0,
    motivoBloqueo,
  };
}

/**
 * Payload para `fn_procesar_picking_compra`.
 *
 * Van los conteos y las decisiones, NO los derivados: el servidor los recalcula.
 * Si la pantalla mandara `faltan` o `buenas`, un cliente manipulado podría
 * pedir un reclamo por más unidades de las que corresponden.
 */
export function construirPayload(lineas) {
  return lineas.map((l) => {
    const d = derivar(l);
    return {
      detalle_id: l.detalle_id,
      llegaron: d.llegaron,
      danadas: d.danadas,
      faltante_accion: d.faltan > 0 ? l.faltante_accion : null,
      sobrante_accion: d.sobran > 0 ? l.sobrante_accion : null,
      metodo_conteo: metodoReal(l),
    };
  });
}

/**
 * El método que de verdad se usó.
 *
 * Si alguien pulsa "Llegó completo" y después corrige con +/−, el método ya no
 * es 'completo'. Dejarlo así haría que la columna mienta justo en lo que se
 * quiere medir: distinguir un conteo real de uno de trámite. Misma idea con
 * 'nada' si después suma unidades.
 *
 * Ojo con 'completo': el click deja `llegaron = pedido`, pero no toca
 * `danadas`. Si después de esa marca rápida el operario aparta unidades como
 * dañadas, ya hizo un conteo real (encontró algo que la factura no reflejaba),
 * así que también deja de ser 'completo' aunque `llegaron` siga cuadrando con
 * el pedido.
 */
export function metodoReal(linea) {
  const d = derivar(linea);
  if (linea.metodo === METODO.COMPLETO && (d.llegaron !== d.pedido || d.danadas > 0)) {
    return METODO.MANUAL;
  }
  if (linea.metodo === METODO.NADA && d.llegaron !== 0) return METODO.MANUAL;
  return linea.metodo ?? METODO.MANUAL;
}
