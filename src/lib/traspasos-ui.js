/**
 * Helpers de presentación del módulo Traspasos (diseño Lovable).
 *
 * Convierte valores REALES de la base de datos a las clases del sistema de
 * diseño portado (`.s-pill`, etiquetas de sede, pasos del flujo). NO contiene
 * lógica de datos ni fetching — solo presentación.
 */

/** Etiqueta legible para cada sede (IDs TEXT reales). */
export const SEDE_LABELS = {
  BODEGA: "Bodega Principal",
  CV: "Almacén CV",
  L3: "Almacén L3",
  CHV: "Almacén CHV",
};

/** Etiqueta corta para chips/avatares de ruta. */
export const SEDE_CORTO = {
  BODEGA: "Bodega",
  CV: "CV",
  L3: "L3",
  CHV: "CHV",
};

/** ID de sede → etiqueta legible (fallback al ID si no se reconoce). */
export function sedeLabel(id) {
  return SEDE_LABELS[id] ?? id ?? "—";
}

/** ID de sede → etiqueta corta (fallback a la etiqueta larga). */
export function sedeCorto(id) {
  return SEDE_CORTO[id] ?? SEDE_LABELS[id] ?? id ?? "—";
}

/**
 * Color estable por sede para los chips de ruta (`<WhChip>`) y dots.
 * Reproduce el mapeo de Lovable WH-01..04 (succ/info/warn/prog) sobre las
 * sedes reales, de forma estable (la sede principal = verde, etc.).
 * Devuelve el nombre de la familia de token (`succ`|`info`|`warn`|`prog`).
 */
export const SEDE_TONO = {
  BODEGA: "succ",
  CV: "info",
  L3: "warn",
  CHV: "prog",
};

/** ID de sede → variable CSS del dot de color (fallback neutro). */
export function sedeDotVar(id) {
  const tono = SEDE_TONO[id];
  return tono ? `var(--${tono}-500)` : "var(--n-400)";
}

/**
 * Pestañas de filtro de la lista de traspasos. El valor coincide con la
 * columna real `estado` (o "Todos" para no filtrar).
 */
export const TRASPASO_TABS = [
  { v: "Todos", label: "Todos" },
  { v: "borrador", label: "Pendiente" },
  { v: "picking", label: "En Picking" },
  { v: "verificado", label: "Verificado" },
  { v: "en_transito", label: "En Tránsito" },
  { v: "recibido", label: "Recibido" },
  { v: "con_diferencia", label: "Con Diferencia" },
];

/**
 * Estado real de un traspaso → clase `.s-pill` + etiqueta.
 * Real: 'borrador' | 'picking' | 'verificado' | 'en_transito' | 'recibido'
 *       | 'con_diferencia'.
 * @param {string|null|undefined} estado
 * @returns {{ cls: string, label: string }}
 */
export function traspasoEstadoPill(estado) {
  switch (estado) {
    case "borrador":
      return { cls: "s-pill s-borr", label: "Pendiente" };
    case "picking":
      return { cls: "s-pill s-ven", label: "En Picking" };
    case "verificado":
      return { cls: "s-pill s-rec", label: "Verificado" };
    case "en_transito":
      return { cls: "s-pill s-env", label: "En Tránsito" };
    case "recibido":
      return { cls: "s-pill s-apr", label: "Recibido" };
    case "con_diferencia":
      return { cls: "s-pill s-anul", label: "Con Diferencia" };
    case "cancelado":
      return { cls: "s-pill s-anul", label: "Cancelado" };
    default:
      return { cls: "s-pill s-borr", label: estado ?? "—" };
  }
}

/**
 * Tipo especial de traspaso → tag visual (pill).
 * Real: 'normal' | 'mercancia_abandonada' | 'devolucion_garantia'.
 * Devuelve `null` para el tipo normal (sin tag).
 * @param {string|null|undefined} tipo
 * @returns {{ cls: string, label: string }|null}
 */
export function traspasoTipoTag(tipo) {
  if (tipo === "mercancia_abandonada") {
    return { cls: "pill pill-warn", label: "Abandonada" };
  }
  if (tipo === "devolucion_garantia") {
    return { cls: "pill pill-progress", label: "Garantía" };
  }
  return null;
}

/* ─────────────────────── Tablero Kanban (Lovable) ─────────────────────── */

/**
 * Las 4 columnas del tablero Kanban de Lovable, en orden.
 * `dotVar` colorea el dot del encabezado; `tint` indica el fondo de la columna.
 */
export const KANBAN_COLS = [
  {
    key: "pendiente",
    label: "Pendiente",
    dotVar: "var(--n-400)",
    pulse: false,
  },
  { key: "enviado", label: "Enviado", dotVar: "var(--info-500)", pulse: false },
  {
    key: "transito",
    label: "En tránsito",
    dotVar: "var(--warn-500)",
    pulse: true,
  },
  {
    key: "recibido",
    label: "Recibido",
    dotVar: "var(--succ-500)",
    pulse: false,
  },
];

/**
 * Mapea un estado REAL del backend a una de las 4 columnas Kanban de Lovable.
 *
 * Mapeo (documentado en el reporte de reconciliación):
 *   borrador      → pendiente   (aún sin preparar)
 *   picking       → pendiente   (en preparación; matiz vía pill)
 *   verificado    → pendiente   (verificado, listo para enviar; matiz vía pill)
 *   en_transito   → transito    (stock ya salió de origen, viaja a destino)
 *   recibido      → recibido
 *   con_diferencia→ recibido    (cerrado con diferencias; matiz vía badge)
 *
 * La columna "enviado" de Lovable NO tiene estado propio en nuestro backend
 * (la acción `enviar` salta verificado→en_transito), por eso queda vacía: se
 * conserva la columna para fidelidad visual 1:1 con el diseño.
 *
 * @param {string|null|undefined} estado
 * @returns {"pendiente"|"enviado"|"transito"|"recibido"}
 */
export function estadoToKanban(estado) {
  switch (estado) {
    case "borrador":
    case "picking":
    case "verificado":
      return "pendiente";
    case "en_transito":
      return "transito";
    case "recibido":
    case "con_diferencia":
      return "recibido";
    // Bloque 1 (#5): un traspaso cancelado es un estado cerrado; se agrupa con
    // los recibidos (la pill roja "Cancelado" lo distingue). Evita que aparezca
    // como tarjeta activa en la columna "Pendiente".
    case "cancelado":
      return "recibido";
    default:
      return "pendiente";
  }
}

/**
 * Badge especial de una tarjeta (esquina del ID), derivado del `tipo` real.
 * Reproduce los badges `garantia` / `abandonada` de Lovable.
 * @param {string|null|undefined} tipo
 * @returns {"garantia"|"abandonada"|null}
 */
export function traspasoBadge(tipo) {
  if (tipo === "devolucion_garantia") return "garantia";
  if (tipo === "mercancia_abandonada") return "abandonada";
  return null;
}

/* ───────────────────────── Avatar de responsable ──────────────────────── */

/** Gradientes de avatar (idénticos a los de Lovable; única excepción a "no hex"). */
const AVATAR_GRADIENTS = [
  "linear-gradient(135deg,#2DA75A,#176B38)",
  "linear-gradient(135deg,#F79009,#B54708)",
  "linear-gradient(135deg,#3D4DE8,#1F2BC2)",
  "linear-gradient(135deg,#9A6FDF,#42307D)",
];

/** Iniciales (máx. 2) a partir de un nombre completo. */
export function iniciales(nombre) {
  if (!nombre) return "··";
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "··";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

/**
 * Gradiente estable para un avatar según el nombre (hash determinista).
 * Si no hay nombre, devuelve `null` → el caller dibuja un avatar neutro.
 * @param {string|null|undefined} nombre
 * @returns {string|null}
 */
export function avatarGradient(nombre) {
  if (!nombre) return null;
  let h = 0;
  for (let i = 0; i < nombre.length; i++) {
    h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
  }
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

/**
 * Pasos del flujo de un traspaso (para el stepper del detalle).
 * `con_diferencia` se trata como variante del paso final "recibido".
 */
export const TRASPASO_FLUJO = [
  { key: "borrador", label: "Pendiente" },
  { key: "picking", label: "Picking" },
  { key: "verificado", label: "Verificado" },
  { key: "en_transito", label: "En Tránsito" },
  { key: "recibido", label: "Recibido" },
];

/**
 * Índice del paso activo dentro de `TRASPASO_FLUJO` para un estado real.
 * @param {string|null|undefined} estado
 * @returns {number}
 */
export function flujoIndex(estado) {
  const norm = estado === "con_diferencia" ? "recibido" : estado;
  return TRASPASO_FLUJO.findIndex((p) => p.key === norm);
}
