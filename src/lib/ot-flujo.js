/**
 * Flujo guiado de Órdenes de Trabajo (OT) — Opción A.
 *
 * Fuente única de verdad del front del módulo OT: modelo de los 7 pasos,
 * derivación del paso actual desde el estado real, máquina de gating
 * (qué falta para avanzar), cálculo de montos (idéntico al backend) y
 * mapeo de estado → color usando los TOKENS del sistema de diseño
 * (`hsl(var(--token))`), nunca colores hardcodeados.
 *
 * No hace fetching: solo lógica/presentación. Lo consumen OrdenDetalle,
 * OrdenStepper, OrdenHistorial y los paneles de paso.
 */

/* ───────────────────────────── Textos (revisados) ─────────────────────────── */
// Centralizados para mantener una voz consistente y fácil de ajustar.
export const TX = {
  modulo: "Órdenes de Trabajo",
  volverTablero: "Volver al tablero",
  soloLectura: (sede) =>
    `Solo lectura. Esta OT es de la sede ${sede}; solo se gestiona desde su propia sede.`,
  // Acciones
  imprimirConstancia: "Imprimir constancia",
  imprimirFactura: "Imprimir factura",
  anularOT: "Anular OT",
  continuar: "Continuar",
  marcarTerminado: "Marcar como terminado",
  convertirVenta: "Convertir a venta y entregar",
  registrar: "Registrar",
  // Recepción
  checklistAyuda:
    "Marca lo que el equipo traía. Lo que no marques no se repara ni se cobra.",
  // Autorización
  clienteAprobo: "El cliente aprobó la cotización",
  clienteNoAutoriza: "El cliente no autoriza la reparación",
  sugerir50: "Sugerir 50%",
  cobroRevision: "Cobro por revisión",
  cobroRevisionAyuda:
    "Si el cliente no autoriza, se cobra solo la revisión del equipo.",
  // Descarga / insumo
  descargarInventario: "Descargar del inventario",
  repuestosDescargados: "Repuestos descargados",
  pausarEsperando: "Pausar: esperando repuesto",
  reanudar: "Reanudar trabajo",
  sinInsumo: (disp, req) =>
    `Stock de insumo insuficiente (hay ${disp}, se necesitan ${req}). Convierte stock de venta a insumo para poder descargarlo.`,
  convertirInsumo: "Convertir venta → insumo",
  // Anular con anticipos
  anularConAnticipo:
    "Esta OT tiene anticipos. Para anularla debes registrar la devolución del dinero al cliente.",
  // Genéricos
  guardado: "Cambios guardados",
  saldo: "Saldo",
  total: "Total",
  anticipos: "Anticipos",
};

/* ───────────────────────────── Modelo de pasos ────────────────────────────── */
// El orden es la columna vertebral del asistente. `estado` es el valor real del
// enum estado_orden al que entra la OT al COMPLETAR pasos previos / estar en él.
export const PASOS = [
  {
    i: 0,
    key: "recepcion",
    label: "Recepción",
    titulo: "Recepción del equipo",
    sub: "Datos del cliente, estado de ingreso y constancia",
    rol: "Vendedora",
  },
  {
    i: 1,
    key: "diagnostico",
    label: "Diagnóstico",
    titulo: "Diagnóstico",
    sub: "El técnico revisa y define qué hacer",
    rol: "Técnico",
  },
  {
    i: 2,
    key: "cotizada",
    label: "Cotización",
    titulo: "Cotización",
    sub: "Repuestos a precio de venta y mano de obra",
    rol: "Vendedora",
  },
  {
    i: 3,
    key: "autorizada",
    label: "Autorización",
    titulo: "Autorización y anticipo",
    sub: "El cliente aprueba; el anticipo es opcional",
    rol: "Vendedora",
  },
  {
    i: 4,
    key: "en_proceso",
    label: "Trabajo",
    titulo: "Descarga de repuestos y trabajo",
    sub: "Salen del inventario y el técnico repara",
    rol: "Técnico",
  },
  {
    i: 5,
    key: "terminada",
    label: "Terminado",
    titulo: "Trabajo terminado",
    sub: "Listo para que el cliente recoja",
    rol: "Técnico",
  },
  {
    i: 6,
    key: "entregada",
    label: "Entrega",
    titulo: "Recogida y venta",
    sub: "Paga el saldo y la orden se convierte en venta",
    rol: "Vendedora",
  },
];

// Estado real → índice de paso (incluye estados legacy de OT viejas).
const ESTADO_A_PASO = {
  recepcion: 0,
  abierta: 0, // legacy
  diagnostico: 1,
  cotizada: 2,
  autorizada: 3,
  en_proceso: 4,
  esperando_repuesto: 4,
  completada: 5, // legacy
  pendiente_recogida: 5, // legacy
  terminada: 5,
  entregada: 6,
  cancelada: 6,
};

// Al pulsar "Continuar" en el paso i, la OT pasa a este estado.
export const SIGUIENTE_ESTADO = [
  "diagnostico", // 0 → 1
  "cotizada", // 1 → 2
  "autorizada", // 2 → 3
  "en_proceso", // 3 → 4
  "terminada", // 4 → 5
  "entregada", // 5 → 6 (se hace vía fn_generar_venta_ot, no update directo)
];

/** Índice (0..6) del paso actual de la OT a partir de su estado. */
export function pasoActual(orden) {
  if (!orden) return 0;
  const p = ESTADO_A_PASO[orden.estado];
  return p == null ? 0 : p;
}

/** ¿La OT está cerrada (entregada o anulada)? */
export function otCerrada(orden) {
  return orden?.estado === "entregada" || orden?.estado === "cancelada";
}

/* ─────────────────────────────── Montos ───────────────────────────────────── */
/**
 * Calcula los montos de la OT. DEBE coincidir con el backend
 * (trg_orden_recalcular_total_mo / fase 2):
 *   base  = mano_obra + repuestos(precio) + valor_revision − descuento
 *   total = base * (1 + iva/100)
 *   saldo = total − anticipos
 *
 * @param {object} orden  fila ordenes_servicio (costo_mano_obra, valor_repuestos,
 *                        valor_revision, descuento_valor, iva_pct)
 * @param {Array} detalles  detalle_orden con precio_unitario/subtotal (opcional;
 *                        si viene, recalcula repuestos desde las líneas)
 * @param {Array} abonos   filas abonos con .monto
 */
export function calcularMontos(orden = {}, detalles = null, abonos = []) {
  const repuestos = detalles
    ? detalles.reduce(
        (s, d) =>
          s +
          (Number(d.subtotal) || Number(d.precio_unitario) * d.cantidad || 0),
        0,
      )
    : Number(orden.valor_repuestos) || 0;
  const mano = Number(orden.costo_mano_obra) || 0;
  const revision = Number(orden.valor_revision) || 0;
  const descuento = Number(orden.descuento_valor) || 0;
  const ivaPct = Number(orden.iva_pct) || 0;

  // Si el cliente NO autorizó, solo se cobra la revisión/diagnóstico: los
  // repuestos y la mano de obra cotizados NO se cobran. Debe coincidir con
  // trg_orden_recalcular_total_mo (backend).
  const noAutoriza = orden.estado_autorizacion === "no_autorizado";
  const base = noAutoriza
    ? Math.max(0, revision)
    : Math.max(0, mano + repuestos + revision - descuento);
  const iva = ivaPct ? base * (ivaPct / 100) : 0;
  const total = Math.round((base + iva) * 100) / 100;
  const anticipos = abonos.reduce((s, a) => s + (Number(a.monto) || 0), 0);
  const saldo = Math.max(0, Math.round((total - anticipos) * 100) / 100);

  return {
    repuestos,
    mano,
    revision,
    descuento,
    ivaPct,
    base,
    iva,
    total,
    anticipos,
    saldo,
  };
}

/* ─────────────────────────────── Gating ───────────────────────────────────── */
/**
 * ¿Está cumplido el requisito del paso `i`? Refleja los gates del backend
 * (trg_orden_validar_transicion, fase 3).
 *
 * @param {number} i  índice del paso
 * @param {object} ctx { orden, detalles, montos, checklistTocado, descargado }
 */
export function gateCumplido(i, ctx) {
  const { orden = {}, detalles = [], montos = {}, checklistTocado } = ctx;
  const noAutoriza = orden.estado_autorizacion === "no_autorizado";
  switch (i) {
    case 0:
      return Boolean(
        (orden.equipo_descripcion || "").trim() && checklistTocado,
      );
    case 1:
      return Boolean((orden.diagnostico || "").trim());
    case 2:
      // La cotización puede quedar VACÍA. Si el cliente no va a autorizar la
      // reparación no hay repuestos ni mano de obra que cobrar, solo la
      // revisión, que se define en el paso de Autorización. Por eso aquí se
      // permite avanzar siempre (el diagnóstico ya se exigió en el paso 1); la
      // exigencia de "algo que cobrar" se valida en Autorización según lo que
      // decida el cliente. Espeja el backend (trg_orden_validar_transicion).
      return true;
    case 3:
      // Según la decisión del cliente: si NO autoriza, exige el valor de la
      // revisión; si autoriza, exige algo cotizado (repuesto o mano de obra).
      // Si aún no decide, no deja avanzar. El anticipo es opcional.
      if (noAutoriza) return (Number(orden.valor_revision) || 0) > 0;
      if (orden.estado_autorizacion === "autorizado")
        return (
          (ctx.draft?.length ?? 0) > 0 ||
          detalles.length > 0 ||
          (Number(orden.costo_mano_obra) || 0) > 0
        );
      return false;
    case 4:
      // Si no autoriza, no hay descarga; basta marcar terminado luego.
      // Si autoriza, no debe quedar ningún repuesto pendiente en el borrador.
      return noAutoriza ? true : (ctx.draft?.length ?? 0) === 0;
    case 5:
      return Boolean((orden.trabajo_realizado || "").trim());
    case 6:
      return (montos.saldo ?? 0) <= 0;
    default:
      return false;
  }
}

/** Mensaje de "qué falta" (o confirmación) para el paso `i`. Textos revisados. */
export function mensajeGate(i, ctx) {
  const ok = gateCumplido(i, ctx);
  const { orden = {} } = ctx;
  const noAutoriza = orden.estado_autorizacion === "no_autorizado";
  const FALTA = {
    0: "Describe el equipo y marca cómo llegó en el checklist.",
    1: "Escribe el diagnóstico del técnico.",
    2: "Cotiza repuestos y mano de obra. Si el cliente no va a autorizar, continúa sin cotizar y cobra solo la revisión en el paso siguiente.",
    3: noAutoriza
      ? "Indica el valor a cobrar por la revisión."
      : orden.estado_autorizacion === "autorizado"
        ? "Agrega al menos un repuesto o define la mano de obra para la reparación."
        : "Marca si el cliente autoriza o no la reparación.",
    4: "Descarga los repuestos del inventario.",
    5: "Describe el trabajo realizado en el equipo.",
    6: "Registra el pago del saldo pendiente.",
  };
  const OK = {
    0: "Recepción completa.",
    1: "Diagnóstico registrado.",
    2: "Continúa a la autorización del cliente.",
    3: noAutoriza
      ? "Cliente no autoriza: se cobra la revisión."
      : "Autorizada. El anticipo es opcional.",
    4: noAutoriza
      ? "Sin descarga: el cliente no autorizó."
      : "Repuestos descargados.",
    5: "Trabajo terminado.",
    6: "Saldo cubierto. Lista para entregar.",
  };
  return ok ? OK[i] : FALTA[i];
}

/* ──────────────────────── Estado → color (tokens) ─────────────────────────── */
// Mapea cada estado a un token del sistema de diseño. Se usa con alpha:
// `hsl(var(--info) / 0.12)`. Nunca hex hardcodeado.
const ESTADO_TONO = {
  recepcion: "info",
  abierta: "info",
  diagnostico: "info",
  cotizada: "primary",
  autorizada: "primary",
  en_proceso: "warning",
  esperando_repuesto: "warning",
  completada: "success",
  pendiente_recogida: "success",
  terminada: "success",
  entregada: "muted-foreground",
  cancelada: "destructive",
};

export const ESTADO_LABEL = {
  recepcion: "Recepción",
  abierta: "Recepción",
  diagnostico: "Diagnóstico",
  cotizada: "Cotizada",
  autorizada: "Autorizada",
  en_proceso: "En proceso",
  esperando_repuesto: "Esperando repuesto",
  completada: "Lista p/ recoger",
  pendiente_recogida: "Lista p/ recoger",
  terminada: "Lista p/ recoger",
  entregada: "Entregada",
  cancelada: "Anulada",
};

/** Estilos de píldora de estado, derivados de tokens (objeto de strings CSS). */
export function estadoEstilo(estado) {
  const t = ESTADO_TONO[estado] || "muted-foreground";
  return {
    bg: `hsl(var(--${t}) / 0.12)`,
    fg: `hsl(var(--${t}))`,
    border: `hsl(var(--${t}) / 0.3)`,
    dot: `hsl(var(--${t}))`,
    label: ESTADO_LABEL[estado] || estado || "—",
  };
}

/* ─────────────────────────── Sedes / varios ───────────────────────────────── */
export const SEDE_LABEL = {
  BODEGA: "Bodega Principal",
  CV: "Almacén CV",
  L3: "Almacén L3",
  CHV: "Almacén CHV",
};

export const METODO_PAGO = [
  { v: "efectivo", l: "Efectivo" },
  { v: "transferencia", l: "Transferencia" },
  { v: "tarjeta", l: "Tarjeta" },
  { v: "otro", l: "Otro" },
];

/** Umbral de "vencida": días en taller sin recoger. */
export const OT_DIAS_VENCIDA = 30;

/** ¿Puede el usuario MANIPULAR esta OT? (Admin todo; Ventas en su sede). */
export function puedeManipular(perfil, orden) {
  if (!perfil || !orden) return false;
  if (perfil.rol === "Admin") return true;
  // Los técnicos solo se ASIGNAN a las OT (lo hace Ventas); no ejecutan el flujo
  // (recepción, diagnóstico, cotización, autorización, descarga, entrega/factura).
  // Ven la OT en solo-lectura.
  if (perfil.rol === "Tecnico") return false;
  return orden.sede_id === perfil.sede_id;
}

/** ¿Puede anular? Solo Admin, OT no cerrada. */
export function puedeAnular(perfil, orden) {
  return perfil?.rol === "Admin" && !otCerrada(orden);
}
