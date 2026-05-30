/**
 * Helpers de presentación de Órdenes de Servicio (diseño Lovable).
 *
 * Convierte valores REALES de la base de datos a las clases del sistema de
 * diseño portado (`.s-pill`, `.auth-pill`, `.av-tec`). NO contiene lógica de
 * datos ni fetching — solo presentación.
 */

/**
 * Pestañas de filtro de la lista de OT. `v` es la etiqueta visible y `estado`
 * el valor real de la columna `estado` (null = no filtra por estado).
 */
export const OT_TABS = [
  { v: "Todas", estado: null },
  { v: "Abiertas", estado: "abierta" },
  { v: "En proceso", estado: "en_proceso" },
  { v: "Esperando repuesto", estado: "esperando_repuesto" },
  { v: "Completadas", estado: "completada" },
  { v: "Pend. recogida", estado: "pendiente_recogida" },
  { v: "Entregadas", estado: "entregada" },
];

/**
 * Estado real de OT → clase `.s-pill` + etiqueta.
 * Real: 'abierta' | 'en_proceso' | 'esperando_repuesto' | 'completada'
 *       | 'pendiente_recogida' | 'entregada'.
 * @param {string|null|undefined} estado
 * @returns {{ cls: string, label: string }}
 */
export function ordenEstadoPill(estado) {
  switch (estado) {
    case "abierta":
      return { cls: "s-pill s-abierta", label: "Abierta" };
    case "en_proceso":
      return { cls: "s-pill s-proceso", label: "En proceso" };
    case "esperando_repuesto":
      return { cls: "s-pill s-esperando", label: "Esperando rep." };
    case "completada":
      return { cls: "s-pill s-completada", label: "Completada" };
    case "pendiente_recogida":
      return { cls: "s-pill s-recogida", label: "Pend. recogida" };
    case "entregada":
      return { cls: "s-pill s-entregada", label: "Entregada" };
    default:
      return { cls: "s-pill s-abierta", label: estado ?? "—" };
  }
}

/**
 * Estado de autorización real → clase `.auth-pill` + etiqueta.
 * Real: 'pendiente' | 'autorizado' | 'no_autorizado'.
 * @param {string|null|undefined} estado
 * @returns {{ cls: string, label: string }}
 */
export function autorizacionPill(estado) {
  switch (estado) {
    case "autorizado":
      return { cls: "auth-pill aut-ok", label: "Autorizado" };
    case "no_autorizado":
      return { cls: "auth-pill aut-no", label: "No autorizado" };
    case "pendiente":
    default:
      return { cls: "auth-pill aut-pen", label: "Pendiente" };
  }
}

/** Variantes de avatar de técnico del diseño (`.av-tec.t1`…`.t5`). */
const AV_VARIANTS = ["t1", "t2", "t3", "t4", "t5"];

/**
 * Deriva variante de avatar e iniciales de un nombre de técnico de forma
 * estable (mismo nombre → mismo color).
 * @param {string|null|undefined} nombre
 * @returns {{ variant: string, ini: string }}
 */
export function tecnicoAvatar(nombre) {
  const n = (nombre ?? "").trim();
  if (!n) return { variant: "t1", ini: "—" };
  const partes = n.split(/\s+/);
  const ini = ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase();
  let hash = 0;
  for (let i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) | 0;
  const variant = AV_VARIANTS[Math.abs(hash) % AV_VARIANTS.length];
  return { variant, ini: ini || n[0].toUpperCase() };
}

/* ─────────────────────────── Tablero Kanban (Lovable) ─────────────────────── */

/**
 * Columnas del tablero Kanban de OT (diseño Lovable). El `id` coincide con el
 * valor real de la columna `estado`. `dot` colorea el indicador del encabezado;
 * `pulse` anima la columna que requiere atención (pendiente de recogida).
 */
export const OT_KANBAN_COLS = [
  { id: "abierta", label: "Abierta", dot: "var(--n-500)" },
  { id: "en_proceso", label: "En proceso", dot: "var(--info-500)" },
  { id: "esperando_repuesto", label: "Esperando rep.", dot: "var(--warn-500)" },
  { id: "completada", label: "Completada", dot: "var(--succ-500)" },
  {
    id: "pendiente_recogida",
    label: "Pend. recogida",
    dot: "var(--warn-500)",
    pulse: true,
  },
  { id: "entregada", label: "Entregada", dot: "var(--n-500)" },
];

/* ───────────────────────── Días en estado / vencida ───────────────────────── */

const MS_POR_DIA = 86_400_000;
/** Umbral (días) tras el que una OT pendiente de recogida se marca "vencida". */
export const OT_DIAS_VENCIDA = 30;
/** Umbral (días) a partir del cual el contador de días entra en tono "warn". */
const OT_DIAS_WARN = 15;

/**
 * Días transcurridos desde una fecha ISO hasta hoy (entero, mínimo 0).
 * @param {string|null|undefined} desde
 * @returns {number|null} null si no hay fecha válida
 */
function diasDesde(desde) {
  if (!desde) return null;
  const t = new Date(desde).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / MS_POR_DIA));
}

/**
 * Métrica de "días en estado" de una OT, derivada de datos REALES.
 *
 * Para `pendiente_recogida` el reloj cuenta desde `pendiente_recogida_at`
 * (cuándo quedó lista para recoger). Para el resto, desde `fecha` (recepción).
 * Las OT entregadas no muestran contador (el ciclo terminó).
 *
 * Devuelve la etiqueta corta ("12 días"), el tono visual y si está vencida
 * (solo aplica a pendiente_recogida que supera OT_DIAS_VENCIDA).
 *
 * @param {{estado?:string,fecha?:string,pendiente_recogida_at?:string,fecha_alerta_30_dias?:string}} orden
 * @returns {{ dias: number|null, label: string, tone: "warn"|"dang"|null, vencida: boolean }}
 */
export function diasEnEstado(orden) {
  if (!orden || orden.estado === "entregada") {
    return { dias: null, label: "—", tone: null, vencida: false };
  }
  const esRecogida = orden.estado === "pendiente_recogida";
  const base = esRecogida
    ? (orden.pendiente_recogida_at ?? orden.fecha)
    : orden.fecha;
  const dias = diasDesde(base);
  if (dias == null)
    return { dias: null, label: "—", tone: null, vencida: false };

  const vencida = esRecogida && dias >= OT_DIAS_VENCIDA;
  // Tono: dang si vencida; warn si está pendiente de recogida o lleva muchos
  // días en taller; sin tono (neutro) en los primeros días.
  let tone = null;
  if (vencida) tone = "dang";
  else if (esRecogida || dias >= OT_DIAS_WARN) tone = "warn";

  const label = dias === 1 ? "1 día" : `${dias} días`;
  return { dias, label, tone, vencida };
}

/**
 * Construye una línea de tiempo de eventos derivada de los timestamps REALES
 * de la OT. Cada hito solo aparece si su dato existe (sin inventar fechas).
 * Reproduce el bloque "Historial de eventos" del diseño Lovable.
 *
 * @param {object} orden
 * @param {(d:string)=>string} fmt  formateador de fecha (p.ej. formatDate)
 * @returns {{ tone:"neut"|"info"|"succ", act:string, meta:string, time:string }[]}
 */
export function construirHistorialOT(orden, fmt) {
  if (!orden) return [];
  const ev = [];
  const tec = orden.tecnico?.nombre ?? "Sin asignar";

  ev.push({
    tone: "neut",
    act: "OT abierta",
    meta: orden.cliente_nombre ?? "—",
    time: orden.fecha ? fmt(orden.fecha) : "—",
  });

  if (orden.diagnostico) {
    ev.push({
      tone: "info",
      act: "Diagnóstico registrado",
      meta: orden.diagnostico.slice(0, 90),
      time: "",
    });
  }
  if (orden.estado_autorizacion === "autorizado") {
    ev.push({
      tone: "succ",
      act: "Cliente autorizó el trabajo",
      meta: "Requiere anticipo registrado para iniciar",
      time: "",
    });
  } else if (orden.estado_autorizacion === "no_autorizado") {
    ev.push({
      tone: "info",
      act: "Cliente no autorizó",
      meta: "Se cobra valor por revisión al cierre",
      time: "",
    });
  }
  if (
    [
      "en_proceso",
      "esperando_repuesto",
      "completada",
      "pendiente_recogida",
      "entregada",
    ].includes(orden.estado)
  ) {
    ev.push({
      tone: "info",
      act: "Trabajo en curso",
      meta: `Técnico: ${tec}`,
      time: "",
    });
  }
  if (orden.pendiente_recogida_at) {
    ev.push({
      tone: "succ",
      act: "Lista para recogida",
      meta: "Equipo terminado, esperando al cliente",
      time: fmt(orden.pendiente_recogida_at),
    });
  }
  if (orden.fecha_entrega) {
    ev.push({
      tone: "succ",
      act: "Equipo entregado",
      meta: orden.cliente_nombre ?? "—",
      time: fmt(orden.fecha_entrega),
    });
  }
  return ev;
}

/** Etiqueta legible de método de pago (abonos). */
export const METODO_PAGO_LABELS = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  otro: "Otro",
};

/**
 * Estado de ensamble (boolean `completado`) → clase `.s-pill` + etiqueta.
 * Reutiliza las variantes existentes: completada (verde) / proceso (naranja).
 * @param {boolean} completado
 * @returns {{ cls: string, label: string }}
 */
export function ensambleEstadoPill(e) {
  // Acepta el objeto ensamble (terminado/completado) o el booleano legacy.
  const completado = typeof e === "object" && e !== null ? e.completado : e;
  const terminado = typeof e === "object" && e !== null ? e.terminado : false;
  if (completado) return { cls: "s-pill s-completada", label: "Completado" };
  if (terminado) return { cls: "s-pill s-esperando", label: "Terminado" };
  return { cls: "s-pill s-proceso", label: "En proceso" };
}

/**
 * Columnas del tablero Kanban de Ensambles. El backend solo distingue dos
 * estados (boolean `completado`), por eso son dos columnas. `match` selecciona
 * las filas de cada columna a partir del booleano real.
 *
 * Diseño Lovable: el módulo Ensambles quedó como placeholder ("aplazado a
 * v1.1"), así que su superficie se construye en el LENGUAJE VISUAL del módulo
 * Taller de Lovable (mismas piezas: viewtog, kanban, kcard, s-pill, av-tec).
 */
export const ENSAMBLE_KANBAN_COLS = [
  {
    id: "en_proceso",
    label: "En proceso",
    dot: "var(--warn-500)",
    pulse: true,
    match: (e) => !e.terminado && !e.completado,
  },
  {
    id: "terminado",
    label: "Terminados",
    dot: "var(--info-500)",
    match: (e) => e.terminado && !e.completado,
  },
  {
    id: "completado",
    label: "Completados",
    dot: "var(--succ-500)",
    match: (e) => !!e.completado,
  },
];

/** Filtros de la lista de ensambles (Todos / En proceso / Terminados / Completados). */
export const ENSAMBLE_TABS = [
  { v: "Todos", key: null },
  { v: "En proceso", key: "en_proceso" },
  { v: "Terminados", key: "terminado" },
  { v: "Completados", key: "completado" },
];

/**
 * Etiquetas de las transiciones de estado de OT (máquina de estados real).
 * `v` = valor real de la columna `estado`. Coincide con ESTADO_LABEL del detalle.
 */
export const OT_ESTADO_LABELS = {
  abierta: "Abierta",
  en_proceso: "En proceso",
  esperando_repuesto: "Esperando repuesto",
  completada: "Completada",
  pendiente_recogida: "Pendiente de recogida",
  entregada: "Entregada",
};
