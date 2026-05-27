/**
 * Helpers de presentación del módulo Cotizaciones (diseño Lovable).
 *
 * Convierte valores REALES de la base de datos a las clases del sistema
 * de diseño portado (`.s-pill`). NO contiene lógica de datos — solo
 * presentación.
 */

/** Estados reales (columna cotizaciones.estado) + filtro "Todos". */
export const ESTADOS_COTIZACION = [
  "Todos",
  "borrador",
  "enviada",
  "aprobada",
  "rechazada",
  "vencida",
];

/** Etiquetas legibles por estado real. */
export const ESTADO_COTIZACION_LABELS = {
  borrador: "Borrador",
  enviada: "Enviada",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  vencida: "Vencida",
};

/**
 * Estado real de cotización → clase de `.s-pill` del diseño.
 * Reales: borrador | enviada | aprobada | rechazada | vencida.
 * Diseño: s-borr | s-env | s-apr | s-rec | s-ven | s-conv.
 * @param {string|null|undefined} estado
 * @param {boolean} [convertida=false] — si ya tiene venta_id asociada
 * @returns {'s-borr'|'s-env'|'s-apr'|'s-rec'|'s-ven'|'s-conv'}
 */
export function cotizacionEstadoClass(estado, convertida = false) {
  if (convertida) return "s-conv";
  switch (estado) {
    case "borrador":
      return "s-borr";
    case "enviada":
      return "s-env";
    case "aprobada":
      return "s-apr";
    case "rechazada":
      return "s-rec";
    case "vencida":
      return "s-ven";
    default:
      return "s-borr";
  }
}

/**
 * Etiqueta legible del estado de cotización.
 * @param {string|null|undefined} estado
 * @param {boolean} [convertida=false]
 * @returns {string}
 */
export function cotizacionEstadoLabel(estado, convertida = false) {
  if (convertida) return "Convertida";
  return ESTADO_COTIZACION_LABELS[estado] ?? estado ?? "—";
}

/* ──────────────────── Validez / vigencia (lista Lovable) ─────────────── */

/** Milisegundos en un día — evita el número mágico en los cálculos de vigencia. */
const MS_POR_DIA = 86_400_000;
/** Umbral (días restantes) bajo el cual la vigencia se considera "por vencer". */
const DIAS_POR_VENCER = 5;

/**
 * Deriva la vigencia REAL de una cotización a partir de `fecha` + `vigencia_dias`.
 * Reproduce la columna "Validez" del diseño Lovable (tono norm | warn | dang)
 * sin inventar fechas: si falta la fecha, cae a la nota neutra "Nd vigencia".
 *
 * @param {string|null|undefined} fecha ISO de creación
 * @param {number|null|undefined} vigenciaDias
 * @param {string|null|undefined} estado estado real (no recalcula días si ya está cerrada)
 * @returns {{ label: string, tone: 'norm'|'warn'|'dang', icon: 'clock'|'alert'|null }}
 */
export function cotizacionVigencia(fecha, vigenciaDias, estado) {
  const dias = Number(vigenciaDias);
  if (!fecha || !Number.isFinite(dias)) {
    return {
      label: Number.isFinite(dias) ? `${dias}d vigencia` : "—",
      tone: "norm",
      icon: null,
    };
  }
  // Estados terminales: la vigencia ya no aplica como cuenta regresiva.
  if (estado === "rechazada" || estado === "vencida") {
    return {
      label: ESTADO_COTIZACION_LABELS[estado] ?? estado,
      tone: estado === "vencida" ? "dang" : "norm",
      icon: estado === "vencida" ? "alert" : null,
    };
  }
  const venceMs = new Date(fecha).getTime() + dias * MS_POR_DIA;
  const restanteDias = Math.ceil((venceMs - Date.now()) / MS_POR_DIA);
  if (restanteDias < 0) {
    const hace = Math.abs(restanteDias);
    return { label: `Venció hace ${hace}d`, tone: "dang", icon: "alert" };
  }
  if (restanteDias === 0)
    return { label: "Vence hoy", tone: "dang", icon: "alert" };
  if (restanteDias <= DIAS_POR_VENCER)
    return { label: `${restanteDias}d`, tone: "warn", icon: "clock" };
  return { label: `${restanteDias}d`, tone: "norm", icon: null };
}

/* ──────────────────── Resumen de productos (lista) ──────────────────── */

/**
 * Resumen textual de los productos de una cotización para la columna
 * "Productos" del diseño Lovable ("Filtro GA-22 + 3 más").
 *
 * Recibe el join `detalle_cotizacion(producto:producto_id(nombre))`. Si no hay
 * detalle (el listado no lo trae por rendimiento), devuelve `null` y el caller
 * muestra un guion honesto.
 *
 * @param {Array<{ producto?: { nombre?: string }|null }>|null|undefined} detalle
 * @param {number} [maxNombres=1]
 * @returns {string|null}
 */
export function resumenProductosCotizacion(detalle, maxNombres = 1) {
  if (!Array.isArray(detalle) || detalle.length === 0) return null;
  const nombres = detalle
    .map((d) => d?.producto?.nombre)
    .filter((n) => typeof n === "string" && n.trim().length > 0);
  if (nombres.length === 0) return null;
  const visibles = nombres.slice(0, maxNombres);
  const resto = nombres.length - visibles.length;
  return resto > 0
    ? `${visibles.join(" + ")} + ${resto} más`
    : visibles.join(" + ");
}

/* ──────────────────── Categoría de producto (wizard paso 2) ──────────── */

/**
 * Categoría real (productos.categoria) → clase visual del badge Lovable.
 * El diseño define cat-rep | cat-lub | cat-srv; las categorías reales del
 * catálogo (Compresor, Parte, Insumo, Accesorio, Kit…) se mapean por
 * cercanía semántica. Sin categoría → null (el caller omite el badge).
 *
 * @param {string|null|undefined} categoria
 * @returns {{ cls: 'cat-rep'|'cat-lub'|'cat-srv', label: string }|null}
 */
export function categoriaBadge(categoria) {
  const c = (categoria ?? "").toLowerCase();
  if (!c) return null;
  if (c.includes("lubric") || c.includes("aceite") || c.includes("insumo"))
    return { cls: "cat-lub", label: categoria };
  if (c.includes("servic") || c.includes("labor") || c.includes("mano"))
    return { cls: "cat-srv", label: categoria };
  // Compresor, Parte, Accesorio, Kit, Repuesto, etc.
  return { cls: "cat-rep", label: categoria };
}

/**
 * Compone observaciones libres con los datos extendidos del cliente que el
 * diseño Lovable captura (contacto, cargo, dirección) pero que NO tienen
 * columna propia en `cotizaciones`. Se anteponen como líneas etiquetadas para
 * no perder la información sin inventar esquema. Si todo está vacío, devuelve
 * las observaciones tal cual (posiblemente null).
 *
 * @param {{ contacto?: string, cargo?: string, direccion?: string }} extra
 * @param {string} observaciones
 * @returns {string|null}
 */
export function componerObservaciones(extra, observaciones) {
  const lineas = [];
  const contacto = (extra?.contacto ?? "").trim();
  const cargo = (extra?.cargo ?? "").trim();
  const direccion = (extra?.direccion ?? "").trim();
  if (contacto || cargo) {
    const persona = [contacto, cargo].filter(Boolean).join(" · ");
    lineas.push(`Contacto: ${persona}`);
  }
  if (direccion) lineas.push(`Dirección: ${direccion}`);
  const obs = (observaciones ?? "").trim();
  if (obs) lineas.push(obs);
  return lineas.length > 0 ? lineas.join("\n") : null;
}

/**
 * Inverso de `componerObservaciones`: separa de las observaciones libres las
 * líneas etiquetadas que el wizard antepone (`Contacto:` / `Dirección:`) para
 * mostrarlas como campos del cliente en el detalle, sin inventar columnas.
 * Devuelve también el texto de notas restante (lo que el usuario escribió
 * realmente como observación libre).
 *
 * @param {string|null|undefined} observaciones
 * @returns {{ contacto: string|null, cargo: string|null, direccion: string|null, notas: string|null }}
 */
export function descomponerObservaciones(observaciones) {
  const vacio = { contacto: null, cargo: null, direccion: null, notas: null };
  if (typeof observaciones !== "string" || observaciones.trim() === "")
    return vacio;
  const lineas = observaciones.split("\n");
  let contacto = null;
  let cargo = null;
  let direccion = null;
  const notas = [];
  for (const raw of lineas) {
    const linea = raw.trim();
    if (/^contacto:/i.test(linea)) {
      const valor = linea.replace(/^contacto:/i, "").trim();
      const partes = valor.split("·").map((p) => p.trim());
      contacto = partes[0] || null;
      cargo = partes[1] || null;
    } else if (/^direcci[oó]n:/i.test(linea)) {
      direccion = linea.replace(/^direcci[oó]n:/i, "").trim() || null;
    } else if (linea !== "") {
      notas.push(raw);
    }
  }
  return {
    contacto,
    cargo,
    direccion,
    notas: notas.length > 0 ? notas.join("\n").trim() : null,
  };
}

/**
 * Estado real de cotización → clase de `.ph-state` del encabezado de detalle.
 * El CSS portado solo define `.ph-state.succ` y `.ph-state.danger`; los demás
 * estados se renderizan en tono neutro (sin modificador) por el caller.
 *
 * @param {string|null|undefined} estado
 * @param {boolean} [convertida=false]
 * @returns {'succ'|'danger'|null}
 */
export function cotizacionPhStateTone(estado, convertida = false) {
  if (convertida) return "succ";
  switch (estado) {
    case "aprobada":
      return "succ";
    case "rechazada":
    case "vencida":
      return "danger";
    default:
      return null; // borrador, enviada → neutro
  }
}

/**
 * Construye el timeline (Historial) del detalle de cotización a partir de los
 * timestamps reales de transición de estado. NO inventa eventos: cada fila
 * solo aparece si su timestamp existe en la fila de la base de datos.
 *
 * @param {object} cot fila de cotizaciones con timestamps de estado
 * @param {(d: string) => string} fmt formateador de fecha (formatDate)
 * @returns {Array<{ tipo: 'neut'|'info'|'succ'|'warn'|'dang', accion: string, actor: string, fecha: string }>}
 */
export function construirHistorialCotizacion(cot, fmt) {
  if (!cot) return [];
  const filas = [];
  const vendedor = cot.vendedor?.nombre ?? "—";
  if (cot.fecha) {
    filas.push({
      tipo: "neut",
      accion: "Creada como borrador",
      actor: vendedor,
      fecha: fmt(cot.fecha),
    });
  }
  if (cot.enviada_at) {
    filas.push({
      tipo: "info",
      accion: "Enviada al cliente",
      actor: vendedor,
      fecha: fmt(cot.enviada_at),
    });
  }
  if (cot.aprobada_at) {
    filas.push({
      tipo: "succ",
      accion: "Aprobada por el cliente",
      actor: cot.nota_aprobacion ? `"${cot.nota_aprobacion}"` : vendedor,
      fecha: fmt(cot.aprobada_at),
    });
  }
  if (cot.rechazada_at) {
    filas.push({
      tipo: "dang",
      accion: "Rechazada por el cliente",
      actor: cot.razon_rechazo ? `"${cot.razon_rechazo}"` : vendedor,
      fecha: fmt(cot.rechazada_at),
    });
  }
  if (cot.vencida_at) {
    filas.push({
      tipo: "warn",
      accion: "Cotización vencida",
      actor: "Por vigencia",
      fecha: fmt(cot.vencida_at),
    });
  }
  if (cot.venta_id && cot.venta) {
    filas.push({
      tipo: "succ",
      accion: `Convertida en venta #${cot.venta.numero}`,
      actor: vendedor,
      fecha: cot.fecha_conversion ? fmt(cot.fecha_conversion) : "",
    });
  }
  return filas;
}
