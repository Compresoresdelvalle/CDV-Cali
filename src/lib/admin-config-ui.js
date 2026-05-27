/**
 * Helpers de presentación para las páginas de Usuarios y Configuración del
 * Panel Admin (diseño Lovable "cockpit", tema oscuro de `.admin-shell`).
 *
 * Solo presentación: formateo, iniciales y mapeos de tokens semánticos.
 * NO contiene lógica de datos ni fetching. Las páginas siguen consumiendo
 * sus queries/RPC reales (usuarios, parámetros, checklist, cuentas).
 */

/**
 * Token semántico de acento para un rol de usuario.
 * @param {string|null|undefined} rol
 * @returns {string} nombre de variable CSS sin `hsl(var(...))`
 */
export function rolToken(rol) {
  switch (rol) {
    case "Admin":
      return "--primary";
    case "Vendedor":
      return "--info";
    case "Bodeguero":
      return "--warning";
    case "Tecnico":
      return "--success";
    default:
      return "--muted-foreground";
  }
}

/**
 * Iniciales (máx. 2) a partir de un nombre, para avatares de usuario.
 * @param {string|null|undefined} nombre
 * @returns {string}
 */
export function iniciales(nombre) {
  const partes = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "—";
  return partes
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Estilos inline (fondo translúcido + texto + borde) para un pill/badge
 * a partir de un token semántico, respetando el tema oscuro.
 * @param {string} token nombre de variable CSS sin `hsl(var(...))`
 * @returns {{ backgroundColor: string, color: string, borderColor: string }}
 */
export function pillStyle(token) {
  return {
    backgroundColor: `hsl(var(${token}) / 0.12)`,
    color: `hsl(var(${token}))`,
    borderColor: `hsl(var(${token}) / 0.4)`,
  };
}

/**
 * Estilos inline para un input/select en superficie de card (tema oscuro).
 * @returns {{ backgroundColor: string, borderColor: string, color: string }}
 */
export const surfaceInputStyle = {
  backgroundColor: "hsl(var(--background))",
  borderColor: "hsl(var(--border))",
  color: "hsl(var(--foreground))",
};

/** Resumen de permisos por rol (texto plano, sin lógica de autorización). */
const PERMISOS_POR_ROL = {
  Admin: "Acceso completo · /ops + /admin",
  Vendedor:
    "Inventario · Ventas · Cotizaciones · Recibos · Devoluciones · Garantías · Herramientas",
  Bodeguero:
    "Inventario · Compras · Traspasos · Devoluciones · Garantías · Herramientas",
  Tecnico: "Inventario · OT · Ensambles · Herramientas",
};

/**
 * Resumen legible de permisos para un rol.
 * @param {string|null|undefined} rol
 * @returns {string}
 */
export function permisosResumen(rol) {
  return PERMISOS_POR_ROL[rol] ?? "—";
}

/**
 * Token semántico de acento para una sede, derivado de forma determinista
 * del `sede_id` (TEXT legible). El esquema NO tiene columna de color, así que
 * el "dot por sede" del diseño Lovable se reproduce con un mapeo estable.
 * @param {string|null|undefined} sedeId
 * @returns {string} nombre de variable CSS sin `hsl(var(...))`
 */
const SEDE_TOKENS = ["--info", "--success", "--warning", "--primary"];
export function sedeToken(sedeId) {
  const id = sedeId ?? "";
  if (!id) return "--muted-foreground";
  // Hash determinista simple (sin dependencias) → índice de paleta estable.
  let acc = 0;
  for (let i = 0; i < id.length; i += 1) {
    acc = (acc * 31 + id.charCodeAt(i)) >>> 0;
  }
  return SEDE_TOKENS[acc % SEDE_TOKENS.length];
}

/**
 * Formatea `ultimo_login` (ISO/TIMESTAMPTZ) a texto corto en zona Colombia.
 * Reproduce la columna "Última conexión" del diseño Lovable con dato real.
 * Devuelve un estado vacío honesto cuando el usuario nunca ha ingresado.
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function ultimaConexionLabel(iso) {
  if (!iso) return "Nunca";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "—";
  const diffMs = Date.now() - then.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Ahora mismo";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH} h`;
  return then.toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Etiqueta legible (humana) para un parámetro del sistema a partir de su key.
 * El esquema solo guarda `key`/`descripcion`; el diseño Lovable muestra un
 * título humano por parámetro. Se deriva del key (presentación), con fallback
 * a la propia key cuando no hay mapeo.
 * @param {string} key
 * @returns {string}
 */
const PARAM_LABELS = {
  iva_pct: "IVA aplicable a cotizaciones y ventas",
  validez_cotizacion_dias: "Validez de cotización",
  dias_alerta_ot_abandonada: "Alerta de OT sin recoger",
  dias_garantia_venta: "Garantía default en ventas",
  dias_conteo_ciclico: "Cadencia de conteo cíclico",
};
export function paramLabel(key) {
  return PARAM_LABELS[key] ?? key;
}
