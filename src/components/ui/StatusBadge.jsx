/**
 * StatusBadge — usa clases .status-badge del CSS (estilo Lovable).
 *
 * Props:
 *   status   : 'success' | 'warning' | 'danger' | 'info' | 'neutral'
 *              | 'OK' | 'Bajo' | 'Agotado' | 'Sobrestock'  ← compat legacy
 *   children : texto personalizado (si se omite, usa label por defecto del status)
 *   className: clases adicionales
 */

const MODIFIER = {
  // Lovable-style
  success: "status-success",
  warning: "status-warning",
  danger: "status-danger",
  info: "status-info",
  neutral: "status-neutral",
  // Legacy stock compat
  OK: "status-success",
  Bajo: "status-warning",
  Agotado: "status-danger",
  Sobrestock: "status-info",
  // Cotización states
  borrador: "status-neutral",
  enviada: "status-info",
  aprobada: "status-success",
  rechazada: "status-danger",
  vencida: "status-neutral",
  // Venta states
  completada: "status-success",
  anulada: "status-danger",
  // Compra states
  recibida: "status-success",
  pendiente: "status-warning",
  // Devolución states
  procesada: "status-success",
};

const DEFAULT_LABEL = {
  success: "Disponible",
  warning: "Stock bajo",
  danger: "Agotado",
  info: "Info",
  neutral: "—",
  OK: "Disponible",
  Bajo: "Stock bajo",
  Agotado: "Agotado",
  Sobrestock: "Sobre",
  borrador: "Borrador",
  enviada: "Enviada",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  vencida: "Vencida",
  completada: "Completada",
  anulada: "Anulada",
  // Compra states
  recibida: "Recibida",
  pendiente: "Pendiente",
  // Devolución states
  procesada: "Procesada",
};

export default function StatusBadge({ status, children, className = "" }) {
  const mod = MODIFIER[status] ?? "status-neutral";
  const label = children ?? DEFAULT_LABEL[status] ?? status;

  return (
    <span className={`status-badge ${mod} ${className}`.trim()}>{label}</span>
  );
}
