/**
 * Helpers de presentación del módulo Herramientas (diseño Lovable).
 *
 * Convierte valores REALES de `herramientas_prestamo` a las clases del sistema
 * de diseño portado (`.pill-*`, avatares `hrm-av-*`, iconos `hrm-tool-ico`).
 * NO contiene lógica de datos ni fetching — solo presentación.
 *
 * Fuente de diseño: `references/7.2 Herramientas.html` y los `ops.herramientas.*`
 * de la rama `frontend-lovable`.
 */

/* ───────────────────────────── Sedes ──────────────────────────────────── */

/** Etiqueta legible para cada sede (IDs TEXT reales). */
export const SEDE_LABELS = {
  BODEGA: "Bodega Principal",
  CV: "Almacén CV",
  L3: "Almacén L3",
  CHV: "Almacén CHV",
};

/** ID de sede → etiqueta legible (fallback al ID si no se reconoce). */
export function sedeLabel(id) {
  return SEDE_LABELS[id] ?? id ?? "—";
}

/* ───────────────────────── Estado de la herramienta ───────────────────── */

/**
 * ¿El préstamo está vencido? Solo aplica a herramientas prestadas con fecha
 * esperada de devolución anterior a ahora.
 * @param {{ estado?: string, fecha_devolucion_esperada?: string|null }} h
 * @returns {boolean}
 */
export function prestamoVencido(h) {
  if (!h || h.estado !== "prestada" || !h.fecha_devolucion_esperada)
    return false;
  return new Date(h.fecha_devolucion_esperada) < new Date();
}

/**
 * Estado REAL (`estado_herramienta`) → clase `.pill-*` + etiqueta + tono.
 * Real: 'disponible' | 'prestada' | 'en_mantenimiento' | 'extraviada'.
 * `tone` se usa para colorear texto/acentos secundarios (succ|warn|neut|dang).
 * @param {string|null|undefined} estado
 * @returns {{ cls: string, label: string, tone: "succ"|"warn"|"neut"|"dang" }}
 */
export function estadoPill(estado) {
  switch (estado) {
    case "disponible":
      return { cls: "pill-success", label: "Disponible", tone: "succ" };
    case "prestada":
      return { cls: "pill-warn", label: "Prestada", tone: "warn" };
    case "en_mantenimiento":
      return { cls: "pill-neutral", label: "Mantenimiento", tone: "neut" };
    case "extraviada":
      return { cls: "pill-danger", label: "Extraviada", tone: "dang" };
    case "consumido":
      return { cls: "pill-neutral", label: "Consumida", tone: "neut" };
    default:
      return { cls: "pill-neutral", label: estado ?? "—", tone: "neut" };
  }
}

/**
 * Tono visual de un préstamo según su fecha esperada de devolución.
 * Reproduce el `LoanTone` de Lovable (ok | warn | danger):
 *   - danger : ya vencido
 *   - warn   : vence hoy o mañana (≤ 1 día)
 *   - ok     : a tiempo
 * @param {{ estado?: string, fecha_devolucion_esperada?: string|null }} h
 * @returns {"ok"|"warn"|"danger"}
 */
export function prestamoTono(h) {
  if (!h || h.estado !== "prestada" || !h.fecha_devolucion_esperada)
    return "ok";
  const esperada = new Date(h.fecha_devolucion_esperada);
  const ahora = new Date();
  if (esperada < ahora) return "danger";
  const dias = (esperada - ahora) / (1000 * 60 * 60 * 24);
  return dias <= 1 ? "warn" : "ok";
}

/** Tono de préstamo → clase `.pill-*` para el badge de estado del préstamo. */
export function tonoPillCls(tono) {
  if (tono === "danger") return "pill-danger";
  if (tono === "warn") return "pill-warn";
  return "pill-success";
}

/** Tono de préstamo → etiqueta legible del estado del préstamo. */
export function tonoLabel(tono) {
  if (tono === "danger") return "Atrasado";
  if (tono === "warn") return "Próximo a vencer";
  return "Activo";
}

/** Tono de préstamo → variable CSS del color de texto de acento. */
export function tonoTextVar(tono) {
  if (tono === "danger") return "var(--dang-700)";
  if (tono === "warn") return "var(--warn-700)";
  return "var(--succ-700)";
}

/* ───────────────────────────── Filtros ────────────────────────────────── */

/**
 * Filtros de estado del catálogo (Lovable). El valor `estado` coincide con la
 * columna real (o "todas" para no filtrar). `cls` colorea el pill del filtro.
 */
export const STATUS_FILTERS = [
  { id: "todas", estado: null, label: "Todas", cls: "pill-neutral" },
  {
    id: "disponible",
    estado: "disponible",
    label: "Disponibles",
    cls: "pill-success",
  },
  { id: "prestada", estado: "prestada", label: "Prestadas", cls: "pill-warn" },
  {
    id: "en_mantenimiento",
    estado: "en_mantenimiento",
    label: "Mantenimiento",
    cls: "pill-neutral",
  },
  {
    id: "extraviada",
    estado: "extraviada",
    label: "Extraviadas",
    cls: "pill-danger",
  },
];

/* ─────────────────────── Avatar de usuario (Lovable) ───────────────────── */

/** Clases de avatar de Lovable (gradientes definidos en index.css). */
const AVATAR_CLASSES = [
  "hrm-av-DP",
  "hrm-av-AM",
  "hrm-av-SL",
  "hrm-av-CR",
  "hrm-av-ML",
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
 * Clase de avatar estable según el nombre (hash determinista). Reproduce los
 * gradientes `hrm-av-*` de Lovable. Si no hay nombre, devuelve `null` → el
 * caller dibuja un avatar neutro.
 * @param {string|null|undefined} nombre
 * @returns {string|null}
 */
export function avatarClase(nombre) {
  if (!nombre) return null;
  let h = 0;
  for (let i = 0; i < nombre.length; i++) {
    h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
  }
  return AVATAR_CLASSES[h % AVATAR_CLASSES.length];
}

/* ──────────────────────── Derivaciones honestas ───────────────────────── */

/**
 * Días transcurridos desde el préstamo (entero, mín. 0). Derivado del
 * `fecha_prestamo` real. Devuelve `null` si no hay fecha.
 * @param {{ fecha_prestamo?: string|null }} h
 * @returns {number|null}
 */
export function diasEnUso(h) {
  if (!h?.fecha_prestamo) return null;
  const inicio = new Date(h.fecha_prestamo);
  const ahora = new Date();
  return Math.max(0, Math.floor((ahora - inicio) / (1000 * 60 * 60 * 24)));
}

/** Texto "N día(s)" para `diasEnUso` (o "—" si no hay dato). */
export function diasEnUsoTexto(h) {
  const d = diasEnUso(h);
  if (d == null) return "—";
  return `${d} día${d === 1 ? "" : "s"}`;
}

/* ─────────────────────── Agrupación de préstamos ───────────────────────── */

/**
 * Llave del préstamo al que pertenece una unidad.
 *
 * `herramientas_prestamo` guarda UNA FILA POR UNIDAD FÍSICA, así que prestar 5
 * unidades del mismo producto deja 5 filas. Las 5 comparten producto (o
 * nombre+código si es manual), sede, responsable y un `fecha_prestamo` idéntico
 * al microsegundo — el préstamo por lote las marca en un solo UPDATE. Esas
 * cuatro cosas identifican el préstamo real.
 * @param {object} h fila de `herramientas_prestamo`
 * @returns {string}
 */
export function claveGrupoPrestamo(h) {
  // Misma normalización que `agruparHerramientas` del catálogo (#H-2).
  const producto = h?.producto_id
    ? `p:${h.producto_id}`
    : `m:${(h?.herramienta_nombre || "").trim().toLowerCase()}|${(
        h?.herramienta_codigo || ""
      )
        .trim()
        .toLowerCase()}`;
  return [
    producto,
    h?.sede_id ?? "",
    h?.prestada_a ?? "",
    h?.fecha_prestamo ?? "",
  ].join("§");
}

/**
 * Agrupa unidades prestadas en préstamos reales, conservando el orden de
 * entrada (la lista ya viene con los atrasados primero).
 * @param {object[]} prestadas unidades con estado 'prestada'
 * @returns {{clave:string, anchor:object, unidades:object[], cantidad:number}[]}
 */
export function agruparPrestamos(prestadas) {
  const mapa = new Map();
  for (const h of prestadas ?? []) {
    const clave = claveGrupoPrestamo(h);
    const grupo = mapa.get(clave);
    if (grupo) grupo.unidades.push(h);
    else mapa.set(clave, { clave, anchor: h, unidades: [h] });
  }
  return Array.from(mapa.values(), (g) => ({
    ...g,
    cantidad: g.unidades.length,
  }));
}

/**
 * Días que lleva vencida una herramienta atrasada (entero ≥ 0) o `null`.
 * @param {{ estado?: string, fecha_devolucion_esperada?: string|null }} h
 * @returns {number|null}
 */
export function diasVencida(h) {
  if (!prestamoVencido(h)) return null;
  const esperada = new Date(h.fecha_devolucion_esperada);
  const ahora = new Date();
  return Math.max(0, Math.floor((ahora - esperada) / (1000 * 60 * 60 * 24)));
}

/**
 * ¿Se puede devolver esta herramienta desde la interfaz?
 *
 * Tres condiciones, y las tres las exige también el servidor
 * (`fn_devolver_herramienta`), así que si esto dice que sí y la RPC dice que
 * no, hay una desincronización que corregir aquí:
 *   - `puedeOperar`: la herramienta es de tu sede, o eres Admin.
 *   - rol Admin o Bodeguero.
 *   - si es inventariable (tiene producto_id), devolverla la retira del
 *     catálogo, y eso solo lo hace el Admin.
 *
 * Vivía duplicado en LoanRow y LoanCard de Herramientas.jsx; al añadir la
 * condición de sede hubo que tocarlo en dos sitios, que es justo el motivo
 * para tenerlo en uno solo.
 */
export function puedeDevolverHerramienta(h, { esAdmin, esBodega, puedeOperar }) {
  return (
    Boolean(puedeOperar) &&
    (esAdmin || esBodega) &&
    (!h?.producto_id || esAdmin)
  );
}
