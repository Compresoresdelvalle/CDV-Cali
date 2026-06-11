import {
  ArrowLeftCircle,
  Check,
  AlertOctagon,
  Wrench,
  Printer,
  Hammer,
  UserCheck,
  Activity,
  BarChart3,
  Settings,
  MessageCircle,
  Boxes,
  X,
} from "lucide-react";
import { formatDate } from "../../lib/utils";
import {
  estadoPill,
  prestamoTono,
  sedeLabel,
  diasEnUsoTexto,
  diasVencida,
} from "../../lib/herramientas-ui";
import { ToolIcon, UserAvatar, Pill } from "./HerramientasBits";

/**
 * Detalle de una herramienta (overlay a pantalla completa).
 *
 * Reproduce 1:1 el layout `ops.herramientas.$id.tsx` de Lovable: cabecera con
 * icono + estado, fila de acciones, y grid de 2 columnas (datos + préstamo
 * actual + historial · QR + estadísticas + configuración).
 *
 * Reconciliación honesta: las secciones que Lovable alimenta con datos que el
 * backend no tiene (marca/modelo/serie, foto, historial, estadísticas,
 * toggles de configuración) se conservan con estados vacíos/derivados y se
 * anotan en el reporte de reconciliación; NO se borran.
 */
export default function HerramientaDetalle({
  herramienta,
  accionando,
  esAdmin,
  onClose,
  onDevolver,
  onConsumir,
  onPrestar,
}) {
  const h = herramienta;
  const pill = estadoPill(h.estado);
  const esPrestada = h.estado === "prestada";
  const esDisponible = h.estado === "disponible";
  const esMantenimiento = h.estado === "en_mantenimiento";
  const esInventariable = !!h.producto_id; // vinculada a un insumo del catálogo
  const tono = prestamoTono(h);
  const atrasada = tono === "danger";
  const venc = diasVencida(h);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{ backgroundColor: "var(--n-25)" }}
      onClick={onClose}
    >
      <div
        className="mx-auto min-h-full w-full max-w-[1200px] px-4 py-6 sm:px-7 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="mb-3 inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors"
          style={{ color: "var(--n-500)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--n-700)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--n-500)")}
        >
          <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} /> Volver a
          Herramientas
        </button>

        {/* ── Cabecera ─────────────────────────────────────────────── */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            <ToolIcon size="xl" />
            <div>
              <div
                className="font-mono text-[11px] font-medium uppercase tracking-[0.06em]"
                style={{ color: "var(--n-400)" }}
              >
                Herramienta
              </div>
              <h1
                className="m-0 mb-1.5 text-[24px] sm:text-[26px] font-medium tracking-[-0.01em]"
                style={{ color: "var(--n-950)" }}
              >
                {h.herramienta_nombre}
              </h1>
              <p className="m-0 text-[14px]" style={{ color: "var(--n-500)" }}>
                {h.herramienta_codigo ? (
                  <span
                    className="font-mono font-medium"
                    style={{ color: "var(--n-700)" }}
                  >
                    {h.herramienta_codigo}
                  </span>
                ) : (
                  <span style={{ color: "var(--n-400)" }}>Sin código</span>
                )}{" "}
                · {sedeLabel(h.sede_id)}
              </p>
              {esInventariable && (
                <span className="mt-2 inline-flex">
                  <Pill
                    cls="pill-info"
                    label="Inventariable · vinculada a insumo"
                    small
                  />
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Pill cls={pill.cls} label={pill.label} />
            {atrasada && (
              <span
                className="text-[12px] font-medium"
                style={{ color: "var(--dang-700)" }}
              >
                Atrasada
                {venc != null
                  ? ` · ${venc} día${venc === 1 ? "" : "s"} vencida`
                  : ""}
              </span>
            )}
          </div>
        </div>

        {/* ── Fila de acciones ─────────────────────────────────────── */}
        <div className="mb-5 flex flex-wrap gap-2">
          {/* Devolver una inventariable la regresa al insumo (retiro) → solo Admin.
              Una manual vuelve a 'disponible' y puede hacerlo Bodeguero/misma sede. */}
          {esPrestada && (!esInventariable || esAdmin) && (
            <button
              onClick={onDevolver}
              disabled={accionando}
              className="btn btn-pri inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{ height: 48 }}
              title={
                esInventariable
                  ? "Al devolverla, su unidad regresa al stock de insumo"
                  : undefined
              }
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
              {accionando ? "Procesando…" : "Marcar devuelta"}
            </button>
          )}
          {/* B11: consumido — no regresa al inventario; la herramienta desaparece. Solo Admin. */}
          {esPrestada && onConsumir && esAdmin && (
            <button
              onClick={() => {
                if (
                  window.confirm(
                    `¿Marcar "${h.herramienta_nombre}" como CONSUMIDA? No regresa al inventario y desaparece del listado. Esta acción no se puede deshacer.`,
                  )
                )
                  onConsumir();
              }}
              disabled={accionando}
              className="btn btn-out inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{
                height: 48,
                borderColor: "var(--dang-border)",
                color: "var(--dang-700)",
              }}
              title="No regresa al inventario; se retira definitivamente"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
              Consumido
            </button>
          )}
          {esDisponible && onPrestar && (
            <button
              onClick={onPrestar}
              className="btn btn-pri inline-flex items-center gap-1.5"
              style={{ height: 48 }}
            >
              <UserCheck className="h-3.5 w-3.5" strokeWidth={2} /> Prestar
            </button>
          )}
          {esDisponible && esInventariable && esAdmin && (
            <button
              onClick={onDevolver}
              disabled={accionando}
              className="btn btn-out inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{ height: 48 }}
              title="Devuelve esta unidad al stock de insumo y retira la herramienta"
            >
              <Boxes className="h-3.5 w-3.5" strokeWidth={2} />
              {accionando ? "Procesando…" : "Regresar a insumo"}
            </button>
          )}
          {/* Acciones del diseño Lovable sin backend (reportar daño / enviar a
              mantenimiento): se conservan deshabilitadas con tooltip honesto. */}
          <ActionDisabled
            icon={<AlertOctagon className="h-3.5 w-3.5" strokeWidth={2} />}
            label="Reportar daño"
            tone="warn"
          />
          <ActionDisabled
            icon={<Wrench className="h-3.5 w-3.5" strokeWidth={2} />}
            label="Enviar a mantenimiento"
          />
          <ActionDisabled
            icon={<Printer className="h-3.5 w-3.5" strokeWidth={2} />}
            label="Imprimir QR"
            ghost
          />
        </div>

        {/* ── Grid 2 columnas ──────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* ─ Columna izquierda ─ */}
          <div className="flex min-w-0 flex-col gap-4">
            {/* Datos de la herramienta */}
            <Card
              icon={<Hammer className="h-4 w-4" strokeWidth={1.8} />}
              title="Datos de la herramienta"
              badge="Herramientas"
            >
              <div className="grid grid-cols-2 gap-x-6 gap-y-3.5">
                <DataField label="Código" value={h.herramienta_codigo} mono />
                <div className="flex flex-col gap-0.5">
                  <FieldLabel>Sede asignada</FieldLabel>
                  <span className="w-fit">
                    <Pill
                      cls="pill-success"
                      label={sedeLabel(h.sede_id)}
                      small
                    />
                  </span>
                </div>
                <DataField label="Estado" value={pill.label} />
                <DataField
                  label="Último movimiento"
                  value={
                    h.fecha_devolucion_real
                      ? formatDate(h.fecha_devolucion_real)
                      : h.fecha_prestamo
                        ? formatDate(h.fecha_prestamo)
                        : null
                  }
                  mono
                />
              </div>
              {/* Datos sin backend (marca/modelo/serie/foto): nota honesta. */}
              <p
                className="mt-4 rounded-md px-3 py-2 text-[11.5px] leading-[1.45]"
                style={{
                  backgroundColor: "var(--n-50)",
                  color: "var(--n-500)",
                }}
              >
                El catálogo aún no registra marca, modelo, número de serie ni
                fotos. Se mostrarán aquí cuando el catálogo de herramientas se
                amplíe.
              </p>
            </Card>

            {/* Préstamo actual */}
            {esPrestada ? (
              <div className="hrm-card-warn rounded-xl p-5">
                <div className="mb-3.5 flex items-center gap-2">
                  <UserCheck
                    className="h-4 w-4"
                    strokeWidth={2}
                    style={{ color: "var(--warn-700)" }}
                  />
                  <span
                    className="text-[14px] font-semibold"
                    style={{ color: "var(--warn-700)" }}
                  >
                    Préstamo actual
                  </span>
                  {atrasada && (
                    <span className="ml-auto">
                      <Pill
                        cls="pill-danger"
                        label={`Atrasado${venc != null ? ` · ${venc} días` : ""}`}
                        pulse
                        small
                      />
                    </span>
                  )}
                </div>
                <div
                  className="flex items-center gap-3.5 rounded-md border p-3.5"
                  style={{
                    borderColor: "var(--warn-border)",
                    backgroundColor: "var(--n-0)",
                  }}
                >
                  <UserAvatar nombre={h.usuario?.nombre} size="lg" />
                  <div className="flex-1">
                    <div
                      className="text-[14px] font-semibold"
                      style={{ color: "var(--n-950)" }}
                    >
                      {h.usuario?.nombre ?? "Usuario no disponible"}
                    </div>
                    <div
                      className="mt-0.5 text-[12px]"
                      style={{ color: "var(--n-500)" }}
                    >
                      {sedeLabel(h.sede_id)}
                    </div>
                  </div>
                  {/* "Recordatorio WhatsApp" de Lovable sin backend de mensajería. */}
                  <ActionDisabled
                    icon={<MessageCircle className="h-3 w-3" strokeWidth={2} />}
                    label="Recordatorio"
                    tone="warn"
                    small
                  />
                </div>
                <div className="mt-3.5 grid grid-cols-3 gap-3.5">
                  <LoanStat
                    label="Fecha préstamo"
                    value={
                      h.fecha_prestamo ? formatDate(h.fecha_prestamo) : "—"
                    }
                  />
                  <LoanStat
                    label="Devolución esperada"
                    value={
                      h.fecha_devolucion_esperada
                        ? formatDate(h.fecha_devolucion_esperada)
                        : "—"
                    }
                    dang={atrasada}
                  />
                  <LoanStat
                    label="Días en uso"
                    value={diasEnUsoTexto(h)}
                    dang={atrasada}
                  />
                </div>
                {h.observaciones && (
                  <div
                    className="mt-3.5 rounded-md px-3 py-2.5 text-[12.5px] italic"
                    style={{
                      backgroundColor: "var(--n-50)",
                      color: "var(--n-700)",
                    }}
                  >
                    <b
                      className="not-italic mb-1 block font-mono text-[10.5px] font-normal uppercase tracking-[0.05em]"
                      style={{ color: "var(--n-500)" }}
                    >
                      Notas del préstamo
                    </b>
                    {h.observaciones}
                  </div>
                )}
              </div>
            ) : esMantenimiento ? (
              <div className="hrm-card-maint rounded-xl p-5">
                <div
                  className="text-[14px] font-semibold"
                  style={{ color: "var(--n-950)" }}
                >
                  En mantenimiento técnico
                </div>
                <div
                  className="mt-1 text-[12.5px]"
                  style={{ color: "var(--n-500)" }}
                >
                  Herramienta retirada del catálogo activo · sin préstamos
                  disponibles hasta finalizar la reparación.
                </div>
              </div>
            ) : (
              <div
                className="rounded-xl border p-5"
                style={{
                  borderColor: "var(--n-150)",
                  backgroundColor: "var(--n-0)",
                }}
              >
                <div
                  className="text-[14px] font-semibold"
                  style={{ color: "var(--n-950)" }}
                >
                  {h.estado === "extraviada"
                    ? "Herramienta extraviada"
                    : "Disponible para préstamo"}
                </div>
                <div
                  className="mt-1 text-[12.5px]"
                  style={{ color: "var(--n-500)" }}
                >
                  {h.estado === "extraviada"
                    ? "Reportada como extraviada · no disponible para préstamo."
                    : "Sin préstamo activo. Puedes prestarla desde la lista de herramientas."}
                </div>
              </div>
            )}

            {/* Historial de uso — sin backend (no hay tabla de historial). */}
            <Card
              icon={<Activity className="h-4 w-4" strokeWidth={1.8} />}
              title="Historial de uso"
            >
              <EmptyInline text="El historial de préstamos por herramienta aún no se registra. Se mostrará aquí cuando se habilite el registro de movimientos de herramientas." />
            </Card>
          </div>

          {/* ─ Columna derecha ─ */}
          <div className="flex flex-col gap-4">
            {/* QR de identificación (placeholder visual hasta integrar QR real). */}
            <div
              className="rounded-xl border p-5 text-center"
              style={{
                borderColor: "var(--n-150)",
                backgroundColor: "var(--n-0)",
              }}
            >
              <div
                className="mb-3.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em]"
                style={{ color: "var(--n-500)" }}
              >
                QR de identificación
              </div>
              <div className="hrm-qr-canvas">
                <div
                  className="grid h-full w-full place-items-center font-mono text-[10px]"
                  style={{ color: "var(--n-400)" }}
                >
                  {h.herramienta_codigo || "Sin código"}
                </div>
              </div>
              <div
                className="mb-3.5 font-mono text-[14px] font-semibold tracking-[0.04em]"
                style={{ color: "var(--n-950)" }}
              >
                {h.herramienta_codigo || "—"}
              </div>
              <ActionDisabled
                icon={<Printer className="h-3.5 w-3.5" strokeWidth={2} />}
                label="Imprimir etiqueta"
                full
              />
            </div>

            {/* Estadísticas de uso — sin backend (derivable a futuro). */}
            <Card
              icon={<BarChart3 className="h-4 w-4" strokeWidth={1.8} />}
              title="Estadísticas de uso"
            >
              <EmptyInline text="Las métricas de uso (total de préstamos, duración promedio, usuario frecuente) se calcularán cuando exista el historial de préstamos." />
            </Card>

            {/* Configuración — toggles de Lovable sin backend de preferencias. */}
            <Card
              icon={<Settings className="h-4 w-4" strokeWidth={1.8} />}
              title="Configuración"
            >
              <Toggle
                label="Requiere autorización Admin para préstamo"
                sub="Útil para herramientas de alto valor o calibración crítica."
              />
              <Toggle
                label="Notificar vencimiento al usuario"
                sub="Mensaje automático el día anterior al vencimiento."
              />
              <Toggle
                label="Notificar al supervisor si atrasa más de 2 días"
                sub="Escalamiento automático al Admin del taller."
              />
              <p
                className="mt-2 text-[11px] italic"
                style={{ color: "var(--n-400)" }}
              >
                Preferencias por herramienta aún no persistidas en el backend.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Subcomponentes ─────────────────────────── */

function Card({ icon, title, badge, children }) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
    >
      <div className="mb-3.5 flex items-center gap-2">
        <span style={{ color: "var(--n-500)" }}>{icon}</span>
        <span
          className="text-[14px] font-semibold"
          style={{ color: "var(--n-950)" }}
        >
          {title}
        </span>
        {badge && (
          <span
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-2.5"
            style={{
              height: 22,
              fontSize: 11,
              fontWeight: 500,
              backgroundColor: "var(--cat-hrm-bg)",
              color: "var(--cat-hrm-text)",
              borderColor: "var(--cat-hrm-border)",
            }}
          >
            <span
              className="rounded-[2px]"
              style={{ width: 8, height: 8, backgroundColor: "var(--cat-hrm)" }}
            />
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function FieldLabel({ children }) {
  return (
    <span
      className="font-mono text-[11px] font-medium uppercase tracking-[0.05em]"
      style={{ color: "var(--n-500)" }}
    >
      {children}
    </span>
  );
}

function DataField({ label, value, mono }) {
  return (
    <div className="flex flex-col gap-0.5">
      <FieldLabel>{label}</FieldLabel>
      <span
        className={`text-[13px] font-medium ${mono ? "font-mono" : ""}`}
        style={{ color: value ? "var(--n-950)" : "var(--n-400)" }}
      >
        {value || "—"}
      </span>
    </div>
  );
}

function LoanStat({ label, value, dang }) {
  return (
    <div className={`hrm-loan-stat${dang ? " dang" : ""}`}>
      <span className="l">{label}</span>
      <span className="v" style={{ fontSize: 13 }}>
        {value}
      </span>
    </div>
  );
}

function Toggle({ label, sub }) {
  return (
    <div
      className="flex items-start gap-3 border-b py-2.5 last:border-0"
      style={{ borderColor: "var(--n-100)" }}
    >
      <div className="flex-1">
        <div
          className="text-[13px] font-medium"
          style={{ color: "var(--n-950)" }}
        >
          {label}
        </div>
        <div
          className="mt-0.5 text-[11.5px] leading-[1.45]"
          style={{ color: "var(--n-500)" }}
        >
          {sub}
        </div>
      </div>
      <div className="hrm-toggle" aria-hidden />
    </div>
  );
}

function EmptyInline({ text }) {
  return (
    <p
      className="rounded-md px-3 py-3 text-[12px] leading-[1.5]"
      style={{ backgroundColor: "var(--n-50)", color: "var(--n-500)" }}
    >
      {text}
    </p>
  );
}

/**
 * Botón de acción presente en el diseño Lovable pero sin backend todavía.
 * Se renderiza deshabilitado con `title` honesto para conservar la fidelidad
 * visual sin prometer una acción que no existe.
 */
function ActionDisabled({ icon, label, tone, ghost, full, small }) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium disabled:cursor-not-allowed";
  const sizeStyle = small
    ? { padding: "4px 10px", fontSize: 12 }
    : { height: 40, padding: "0 14px", fontSize: 13 };
  const color =
    tone === "warn"
      ? "var(--warn-700)"
      : ghost
        ? "var(--n-500)"
        : "var(--n-700)";
  const border =
    tone === "warn"
      ? "var(--warn-border)"
      : ghost
        ? "transparent"
        : "var(--n-150)";
  return (
    <button
      type="button"
      disabled
      title="Disponible en una próxima fase"
      className={`${base}${full ? " w-full" : ""}`}
      style={{
        ...sizeStyle,
        color,
        border: `1px solid ${border}`,
        backgroundColor: ghost ? "transparent" : "var(--n-0)",
        opacity: 0.55,
      }}
    >
      {icon}
      {label}
    </button>
  );
}
