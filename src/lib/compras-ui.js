/**
 * Helpers de presentación del módulo Compras (diseño Lovable).
 *
 * Convierte valores REALES de la base de datos a las clases del sistema
 * de diseño portado (`.s-pill`). NO contiene lógica de datos ni fetching —
 * solo presentación.
 *
 * NOTA DE RECONCILIACIÓN (diseño Lovable vs. backend real):
 *   El diseño Lovable contempla estados `borrador`, `transito`, `parcial`,
 *   etc. y recepción línea-a-línea (parcial / faltante / excedente). El
 *   backend REAL solo modela la compra con un booleano `recibida` + un
 *   `estado` ('completada' | 'devolucion_garantia'). Aquí mapeamos al
 *   lenguaje visual Lovable SIN inventar estados que el backend no soporta.
 */

import { formatCOP as formatoCOP } from "./utils";

/**
 * Pestañas de filtro por estado (mapeadas a la query de CompraHistorial).
 *
 * "Cancelada" existe porque las compras canceladas SÍ se listan en "Todas" y SÍ
 * suman al total del encabezado: sin pestaña propia no había forma de aislarlas
 * ni de entender por qué el total no cuadraba con lo realmente comprado.
 */
export const COMPRAS_TABS = [
  "Todas",
  "Registrada",
  "Recibida",
  "Cancelada",
  "Garantía",
];

/** Pestañas de filtro por tipo: orden de compra formal vs. gasto de caja menor. */
export const COMPRAS_TIPO_TABS = ["Todos", "Órdenes de compra", "Caja menor"];

/**
 * Badge de tipo de registro de compra. Distingue una orden de compra formal
 * de un gasto de caja menor (misma tabla `compras`, campo `es_caja_menor`).
 * @param {boolean|null|undefined} esCajaMenor
 * @returns {{ cls: string, label: string }}
 */
export function compraTipoBadge(esCajaMenor) {
  return esCajaMenor
    ? { cls: "s-pill s-env", label: "Caja menor" }
    : { cls: "s-pill s-borr", label: "Orden de compra" };
}

/**
 * Estado real de una compra → clase `.s-pill` + etiqueta.
 * El estado real se deriva de dos campos:
 *   - `recibida` (bool): false → registrada, true → recibida
 *   - `estado` ('completada' | 'devolucion_garantia')
 * @param {{ recibida: boolean, estado?: string|null, es_caja_menor?: boolean,
 *   metodo_pago?: string|null, saldo?: number|null }} compra
 *   `saldo` = saldo de v_cuentas_por_pagar (solo aplica a Crédito; null si no
 *   se conoce).
 * @returns {{ cls: string, label: string }}
 */
export function compraEstadoPill({
  recibida,
  estado,
  es_caja_menor,
  metodo_pago,
  saldo,
}) {
  if (estado === "cancelada") {
    // C-04: rojo de alto contraste (antes usaba el pill neutro s-entregada,
    // indistinguible de una compra normal).
    return { cls: "s-pill s-anul", label: "Cancelada" };
  }
  if (estado === "devolucion_garantia") {
    return { cls: "s-pill s-conv", label: "Dev. garantía" };
  }
  // Caja menor no trae mercancía (la RPC la crea ya "recibida"). Casi siempre
  // se paga en el acto; desde el Bloque 3.2 también puede quedar a Crédito, y
  // entonces es "Por pagar" hasta que Cuentas por pagar la salde.
  if (es_caja_menor) {
    if (metodo_pago === "Crédito") {
      if (saldo == null) return { cls: "s-pill s-ven", label: "A crédito" };
      return Number(saldo) > 0.01
        ? { cls: "s-pill s-ven", label: "Por pagar" }
        : { cls: "s-pill s-apr", label: "Pagado" };
    }
    return { cls: "s-pill s-apr", label: "Pagado" };
  }
  return recibida
    ? { cls: "s-pill s-apr", label: "Recibida" }
    : { cls: "s-pill s-ven", label: "Registrada" };
}

/**
 * Estado de una garantía de compra → tono semántico para el pill.
 * Real: 'abierta' | 'cerrada' | otros.
 * @param {string|null|undefined} estado
 * @returns {{ cls: string }}
 */
export function garantiaEstadoPill(estado) {
  return estado === "cerrada"
    ? { cls: "s-pill s-apr" }
    : { cls: "s-pill s-ven" };
}

/**
 * Construye los KPIs del encabezado de la lista (diseño Lovable: "N este
 * mes · $X comprado · M en tránsito") a partir de las filas REALES cargadas.
 * Como el backend no distingue "en tránsito" (solo recibida sí/no),
 * "pendientes" reemplaza honestamente a "en tránsito".
 *
 * @param {Array<{ total?: number, recibida?: boolean }>} compras
 * @returns {{ count: number, comprado: number, pendientes: number }}
 */
export function comprasHeaderStats(compras) {
  const list = Array.isArray(compras) ? compras : [];
  return list.reduce(
    (acc, c) => {
      acc.count += 1;
      acc.comprado += Number(c.total ?? 0);
      if (c.recibida !== true) acc.pendientes += 1;
      return acc;
    },
    { count: 0, comprado: 0, pendientes: 0 },
  );
}

/**
 * Línea de tiempo de una compra derivada de timestamps REALES.
 * Cada hito existe solo si su dato real está presente. Reproduce el
 * "Timeline detallado" de Lovable adaptado a los campos disponibles.
 *
 * @param {object} compra - fila de compras (fecha, fecha_recepcion, estado,
 *   recibida, registrador, proveedor)
 * @param {Array} garantias - garantias_compra asociadas
 * @param {(d: string) => string} fmtDate
 * @returns {Array<{ tone: string, act: string, meta: string, time: string|null }>}
 */
export function construirTimelineCompra(
  compra,
  garantias,
  fmtDate,
  { pagosAnulados = [] } = {},
) {
  const eventos = [];
  const cancelada = compra.estado === "cancelada";
  eventos.push({
    tone: "info",
    act: compra.es_caja_menor
      ? "Gasto de caja menor registrado"
      : "Orden de compra registrada",
    meta: `${compra.proveedor}${
      compra.registrador?.nombre ? ` · ${compra.registrador.nombre}` : ""
    }`,
    time: compra.fecha ? fmtDate(compra.fecha) : null,
  });

  // Una compra cancelada ya no debe nada: no se pinta "por pagar" ni
  // "pagado" (una caja menor de contado cancelada NO es un gasto pagado).
  const debe =
    !cancelada &&
    compra.metodo_pago === "Crédito" &&
    (compra.saldo == null || Number(compra.saldo) > 0.01);
  if (cancelada) {
    // Lo que sí pasó antes de cancelar: la mercancía entró (y salió al
    // cancelar). Los pagos y la cancelación van abajo.
    if (!compra.es_caja_menor && compra.recibida && compra.fecha_recepcion) {
      eventos.push({
        tone: "succ",
        act: "Mercancía recibida en bodega",
        meta: `Ingreso a inventario · ${compra.sede_destino_id ?? ""}`.trim(),
        time: fmtDate(compra.fecha_recepcion),
      });
    }
  } else if (compra.es_caja_menor && debe) {
    // Gasto a crédito (Bloque 3.2): se debe hasta que se pague desde Cuentas
    // por pagar. Hoy no salió plata.
    eventos.push({
      tone: "prog",
      act: "Gasto por pagar",
      meta:
        compra.saldo == null
          ? "A crédito · se paga desde Cuentas por pagar"
          : `A crédito · debe ${formatoCOP(compra.saldo)} · se paga desde Cuentas por pagar`,
      time: null,
    });
  } else if (compra.es_caja_menor) {
    // Un gasto de caja menor no trae mercancía: se paga en el acto (o ya se
    // saldó, si fue a crédito).
    eventos.push({
      tone: "succ",
      act: "Gasto pagado",
      meta: `${
        compra.metodo_pago === "Crédito"
          ? "A crédito, ya saldado"
          : (compra.metodo_pago ?? "Efectivo")
      }${
        compra.cuenta_bancaria ? ` · ${compra.cuenta_bancaria}` : ""
      }${compra.sede_destino_id ? ` · ${compra.sede_destino_id}` : ""}`,
      time: compra.fecha ? fmtDate(compra.fecha) : null,
    });
  } else if (compra.recibida && compra.fecha_recepcion) {
    eventos.push({
      tone: "succ",
      act: "Mercancía recibida en bodega",
      meta: `Ingreso a inventario · ${compra.sede_destino_id ?? ""}`.trim(),
      time: fmtDate(compra.fecha_recepcion),
    });
  } else {
    eventos.push({
      tone: "prog",
      act: "Pendiente de recepción",
      meta: "Esperando llegada de la mercancía",
      time: null,
    });
  }

  (garantias ?? []).forEach((g) => {
    eventos.push({
      tone: "warn",
      act: `Garantía #${g.numero} · ${g.resolucion ?? ""}`.trim(),
      meta: g.motivo ?? "Devolución al proveedor",
      time: g.fecha ? fmtDate(g.fecha) : null,
    });
  });

  if (cancelada) {
    // fn_cancelar_compra anula los pagos con motivo "Compra cancelada" en el
    // mismo momento: esa hora es la de la cancelación (la compra no guarda
    // cuándo se canceló).
    const anulados = (pagosAnulados ?? []).filter((p) => p?.anulado);
    anulados.forEach((p) => {
      eventos.push({
        tone: "dang",
        act: `Pago de ${formatoCOP(p.monto)} anulado`,
        meta: `${p.metodo_pago ?? ""}${p.fecha ? ` · era del ${fmtDate(p.fecha)}` : ""}${
          p.motivo_anulacion ? ` · ${p.motivo_anulacion}` : ""
        }`.replace(/^ · /, ""),
        time: p.anulado_en ? fmtDate(p.anulado_en) : null,
      });
    });
    const enCancelacion = anulados.find(
      (p) => p.motivo_anulacion === "Compra cancelada" && p.anulado_en,
    );
    eventos.push({
      tone: "dang",
      act: compra.es_caja_menor ? "Gasto anulado" : "Compra cancelada",
      meta: compra.es_caja_menor
        ? "Ya no cuenta como gasto ni se debe nada"
        : compra.recibida
          ? "El stock que entró salió del inventario · no se debe nada"
          : "No movió inventario · no se debe nada",
      time: enCancelacion ? fmtDate(enCancelacion.anulado_en) : null,
    });
  }

  return eventos;
}

/**
 * Quién paga el saldo de una compra a crédito desde Cuentas por pagar.
 * fn_registrar_pago_cuenta deja pagar al Admin cualquier compra y a Bodega
 * solo las de BODEGA: decir "bodega o el administrador" en una compra de CV
 * mandaba a la vendedora a pedírselo a quien no puede.
 * @param {string|null|undefined} sedeCompra
 */
export function quienPagaSaldoCompra(sedeCompra) {
  return sedeCompra === "BODEGA"
    ? "lo paga bodega o el administrador"
    : "lo paga el administrador";
}

/**
 * Mensaje de confirmación de "Cancelar compra". Si la compra tiene pagos no
 * anulados, fn_cancelar_compra los anula: hay que decirlo antes, con cuántos
 * y por cuánto, y aclarar que la plata que devuelva el proveedor va aparte.
 * @param {{ es_caja_menor?: boolean, recibida?: boolean }} compra
 * @param {Array<{ monto: number, anulado?: boolean }>} pagos
 */
export function mensajeCancelarCompra(compra, pagos = []) {
  const base = compra?.es_caja_menor
    ? "Un gasto de caja menor no mueve inventario: cancelarlo solo anula el gasto."
    : compra?.recibida
      ? "El stock que entró con esta compra sale del inventario.\n\nDespués revisa el costo del producto: el promedio no siempre se recalcula solo al cancelar, y puede quedar mal."
      : "Esta compra todavía no ha entrado al inventario, así que cancelarla no mueve stock.";
  const vigentes = (pagos ?? []).filter((p) => !p?.anulado);
  const suma = vigentes.reduce((s, p) => s + Number(p.monto ?? 0), 0);
  const pagosTxt =
    vigentes.length > 0
      ? `\n\nTambién se anula${vigentes.length === 1 ? "" : "n"} ${
          vigentes.length === 1 ? "el pago" : `los ${vigentes.length} pagos`
        } que tiene por ${formatoCOP(suma)}. Si el proveedor te devolvió esa plata, eso se registra aparte.`
      : "";
  return `${base}${pagosTxt}\n\nEsto no se puede deshacer.`;
}

/**
 * Convierte las sugerencias que manda Reorden en líneas de carrito de compra.
 *
 * Se extrae aquí, fuera del componente, porque tiene dos trampas que ya
 * costaron un error de diseño y conviene poder probarlas:
 *
 *  1. La selección de Reorden se lleva por producto Y sede (`producto_id-sede_id`),
 *     así que el mismo producto puede venir dos veces —bajo mínimo en CHV y en
 *     CV—. El carrito, en cambio, se indexa por `producto_id`: dos líneas con el
 *     mismo id se editarían y se borrarían juntas. Por eso se consolidan
 *     sumando las cantidades.
 *  2. El destino se decide con la misma regla que `agregarAlCarrito`: lo no
 *     vendible entra como insumo. Con "venta" fijo, los insumos del catálogo
 *     sumarían a `cantidad` en vez de `cantidad_insumo` y habría que
 *     convertirlos a mano después.
 *
 * @param {Array<object>|null|undefined} sugerencias `state.sugerenciasReorden`
 * @param {{ esVendedor?: boolean }} [opciones] Al Vendedor no se le precarga el
 *   costo histórico: arranca en 0 y lo digita, igual que en una compra normal.
 * @returns {Array<object>} líneas listas para `setCarrito`
 */
// Mismo tope que aplica `setCantidadDirecta` al teclear a mano y que declara el
// `max` del campo. Sin esto, el carrito importado podía superarlo (la suma de
// varias sedes no pasa por el campo) y las dos formas de llenar el carrito
// seguían reglas distintas.
const TOPE_CANTIDAD = 100000;

export function carritoDesdeReorden(sugerencias, { esVendedor = false } = {}) {
  if (!Array.isArray(sugerencias)) return [];

  const porProducto = new Map();
  for (const s of sugerencias) {
    if (!s?.producto_id) continue;
    const cantidad = Math.max(1, Number(s.cantidad_sugerida) || 1);
    const ya = porProducto.get(s.producto_id);
    if (ya) {
      ya.cantidad = Math.min(TOPE_CANTIDAD, ya.cantidad + cantidad);
      // Se guarda el desglose: la suma de varias sedes puede dar un número
      // sorprendente. La migración que pasó el mín/máx a las sedes copió el
      // valor global a las cuatro, así que un producto con techo 15.000 genera
      // hoy cuatro sugerencias y el carrito pide ~58.000. Es aritméticamente
      // correcto según lo configurado, pero nadie debería descubrirlo al
      // recibir la mercancía: se muestra de dónde sale cada número.
      if (s.sede_id) ya.desglose.push({ sede_id: s.sede_id, cantidad });
      continue;
    }
    porProducto.set(s.producto_id, {
      producto_id: s.producto_id,
      nombre: s.nombre,
      referencia: s.referencia,
      cantidad: Math.min(TOPE_CANTIDAD, cantidad),
      costo_unitario: esVendedor ? 0 : Number(s.costo_unitario) || 0,
      destino: s.vendible === false ? "insumo" : "venta",
      desglose: s.sede_id ? [{ sede_id: s.sede_id, cantidad }] : [],
    });
  }
  return [...porProducto.values()];
}

/**
 * Sedes de las que venían las sugerencias, sin repetir y sin vacíos.
 * Sirve para avisar que la compra se registra en la sede del usuario y no en
 * la de la sugerencia (`fn_registrar_compra` recibe una sola sede).
 */
export function sedesDeSugerencias(sugerencias) {
  if (!Array.isArray(sugerencias)) return [];
  return [...new Set(sugerencias.map((s) => s?.sede_id).filter(Boolean))];
}
