/**
 * Retenciones a la vista: lógica pura para el informe del mes y la línea
 * informativa del cierre. No calcula retenciones nuevas: LEE las columnas
 * generadas de `ventas`, `ordenes_servicio` y `compras` (retefuente_valor,
 * reteica_valor, reteiva_valor, retenciones_total), que son la verdad. Lo único
 * que se reconstruye aquí es la BASE sobre la que se aplicó cada porcentaje,
 * porque esa no se guarda como columna; la fórmula es espejo de las funciones
 * del servidor `_fn_base_retencion_venta`, `_fn_base_retencion_ot` y de la
 * expresión de `compras`.
 *
 * Qué entra en cada lado (los mismos filtros que usa el cierre):
 *   - "Nos retuvieron": ventas DIRECTAS no anuladas por su `fecha`, y OT
 *     entregadas por su `fecha_entrega`. Las ventas con `origen = 'ot'` NO se
 *     cuentan: son la facturación de la misma OT y llevan la misma retención,
 *     contarlas sería duplicarla.
 *   - "Retuvimos": compras no canceladas por su `fecha`.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const TIPOS_RETENCION = [
  { id: "retefuente", label: "Retefuente" },
  { id: "reteica", label: "ReteICA" },
  { id: "reteiva", label: "ReteIVA" },
];

/* ─────────────────────────── Bases (espejo del servidor) ─────────────── */

/** Base de una venta: subtotal menos descuento (en $, o el % legado). */
export function baseVenta(v) {
  const sub = num(v?.subtotal);
  const desc =
    v?.descuento_valor != null
      ? num(v.descuento_valor)
      : (sub * num(v?.descuento_pct)) / 100;
  return sub - Math.max(0, Math.min(desc, sub));
}

/** IVA de una venta tal como lo calcula el servidor (redondeado). */
export function ivaVenta(v) {
  return Math.round((baseVenta(v) * num(v?.iva_pct)) / 100);
}

/** Base de una OT. Sin autorización solo se cobra la revisión. */
export function baseOT(o) {
  if (o?.estado_autorizacion === "no_autorizado") {
    return Math.max(0, num(o?.valor_revision));
  }
  const bruto =
    num(o?.costo_mano_obra) + num(o?.valor_repuestos) + num(o?.valor_revision);
  const desc = Math.min(Math.max(num(o?.descuento_valor), 0), bruto);
  return Math.max(0, bruto - desc);
}

export function ivaOT(o) {
  return Math.round((baseOT(o) * num(o?.iva_pct)) / 100);
}

/** Base de una compra: subtotal menos descuento, nunca negativa. */
export function baseCompra(c) {
  return Math.max(0, num(c?.subtotal) - num(c?.descuento_valor));
}

/* ─────────────────────────── Normalización ─────────────────────────────── */

/**
 * Convierte una fila cruda de la base en un documento uniforme.
 * @param {object} row
 * @param {"venta"|"ot"|"compra"} tipoDoc
 */
/**
 * Ventas cuya retención explica la caja del CIERRE. Una venta a Crédito no
 * entra como plata el día que se vende (el cierre no la cuenta como entrada;
 * entra después, con los cobros de Cuentas por cobrar), así que su retención
 * no explica nada de ese cierre. El informe mensual sí las incluye todas.
 * @param {Array<{ metodo_pago?: string|null }>} rows filas de `ventas`
 */
export function ventasQueEntranAlCierre(rows = []) {
  return (rows ?? []).filter((r) => r?.metodo_pago !== "Crédito");
}

export function normalizarDoc(row, tipoDoc) {
  const base =
    tipoDoc === "venta"
      ? baseVenta(row)
      : tipoDoc === "ot"
        ? baseOT(row)
        : baseCompra(row);
  const iva =
    tipoDoc === "venta"
      ? ivaVenta(row)
      : tipoDoc === "ot"
        ? ivaOT(row)
        : num(row?.iva);
  const tercero =
    (tipoDoc === "compra" ? row?.proveedor : row?.cliente_nombre)?.trim() ||
    (tipoDoc === "compra" ? "Proveedor sin nombre" : "Cliente mostrador");
  const fecha = tipoDoc === "ot" ? row?.fecha_entrega : row?.fecha;
  const retenciones = TIPOS_RETENCION.map((t) => ({
    tipo: t.id,
    label: t.label,
    pct: num(row?.[`${t.id}_pct`]),
    valor: num(row?.[`${t.id}_valor`]),
    // ReteIVA va sobre el IVA facturado, no sobre la base.
    base: t.id === "reteiva" ? iva : base,
  })).filter((r) => r.valor > 0);
  const total = num(row?.total);
  const retenido = num(row?.retenciones_total);
  return {
    id: row?.id,
    tipoDoc,
    numero: row?.numero,
    fecha,
    sedeId: tipoDoc === "compra" ? row?.sede_destino_id : row?.sede_id,
    tercero,
    total,
    base,
    iva,
    retenido,
    neto: Math.max(0, Math.round(total - retenido)),
    retenciones,
  };
}

/* ─────────────────────────── Sumas ─────────────────────────────────────── */

/**
 * Totales de un conjunto de documentos: por tipo de retención, lo facturado,
 * lo retenido y el neto (lo que de verdad se movió).
 */
export function resumirRetenciones(docs = []) {
  const porTipo = { retefuente: 0, reteica: 0, reteiva: 0 };
  let facturado = 0;
  let retenido = 0;
  for (const d of docs) {
    facturado += num(d.total);
    retenido += num(d.retenido);
    for (const r of d.retenciones ?? []) {
      porTipo[r.tipo] = (porTipo[r.tipo] ?? 0) + num(r.valor);
    }
  }
  return {
    porTipo,
    facturado,
    retenido,
    neto: facturado - retenido,
    n: docs.length,
  };
}

/**
 * Agrupa por tercero (cliente o proveedor), de mayor a menor retenido. Dentro
 * de cada tercero, los documentos van por fecha.
 */
export function agruparPorTercero(docs = []) {
  const mapa = new Map();
  for (const d of docs) {
    const clave = d.tercero.toLocaleLowerCase("es-CO");
    if (!mapa.has(clave)) {
      mapa.set(clave, { tercero: d.tercero, docs: [], retenido: 0 });
    }
    const g = mapa.get(clave);
    g.docs.push(d);
    g.retenido += num(d.retenido);
  }
  const grupos = [...mapa.values()];
  for (const g of grupos) {
    g.docs.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  }
  return grupos.sort(
    (a, b) => b.retenido - a.retenido || a.tercero.localeCompare(b.tercero),
  );
}

/* ─────────────────────────── Exportar ──────────────────────────────────── */

const ETIQUETA_DOC = { venta: "Venta", ot: "OT", compra: "Compra" };

/** Fecha 'dd/mm/aaaa' en Bogotá para una celda del CSV. */
export function fechaCorta(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-CO", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export const COLUMNAS_CSV = [
  { clave: "lado", titulo: "Lado" },
  { clave: "tercero", titulo: "Cliente / proveedor" },
  { clave: "documento", titulo: "Documento" },
  { clave: "fecha", titulo: "Fecha" },
  { clave: "tipo", titulo: "Retención" },
  { clave: "base", titulo: "Base" },
  { clave: "pct", titulo: "%" },
  { clave: "valor", titulo: "Valor" },
];

/**
 * Una fila por retención (no por documento): es como lo pide el contador para
 * cuadrar cada certificado. Los números van sin formato de moneda para que
 * Excel los sume; el % con coma decimal, que es como lo lee Excel en español.
 */
export function filasCSV(docs, lado) {
  const filas = [];
  for (const d of docs) {
    for (const r of d.retenciones) {
      filas.push({
        lado,
        tercero: d.tercero,
        documento: `${ETIQUETA_DOC[d.tipoDoc] ?? d.tipoDoc} #${d.numero}`,
        fecha: fechaCorta(d.fecha),
        tipo: r.label,
        base: Math.round(r.base),
        pct: String(r.pct).replace(".", ","),
        valor: Math.round(r.valor),
      });
    }
  }
  return filas;
}

/* ─────────────────────────── Fechas ────────────────────────────────────── */

const pad = (n) => String(n).padStart(2, "0");

/**
 * Mes 'YYYY-MM' → días de calendario y rango de instantes de Bogotá (UTC-5,
 * sin horario de verano), listo para `.gte()/.lte()` sobre un timestamptz.
 */
export function rangoMesBogota(mes) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(mes ?? ""));
  if (!m) return null;
  const anio = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const ultimo = new Date(Date.UTC(anio, mo, 0)).getUTCDate();
  const desdeDia = `${anio}-${pad(mo)}-01`;
  const hastaDia = `${anio}-${pad(mo)}-${pad(ultimo)}`;
  return {
    desdeDia,
    hastaDia,
    desde: `${desdeDia}T00:00:00.000-05:00`,
    hasta: `${hastaDia}T23:59:59.999-05:00`,
  };
}

/** Nombre del mes para el encabezado: "octubre de 2026". */
export function etiquetaMes(mes) {
  const r = rangoMesBogota(mes);
  if (!r) return "";
  const [a, mo] = mes.split("-").map(Number);
  // Mediodía UTC para que ninguna zona lo corra al mes anterior.
  return new Date(Date.UTC(a, mo - 1, 1, 12)).toLocaleDateString("es-CO", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
