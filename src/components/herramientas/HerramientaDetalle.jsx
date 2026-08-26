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
import { useState, useEffect } from "react";
import { formatDate } from "../../lib/utils";
import { supabase } from "../../lib/supabase";
import {
  estadoPill,
  prestamoTono,
  sedeLabel,
  diasEnUsoTexto,
  diasVencida,
} from "../../lib/herramientas-ui";
import { ToolIcon, UserAvatar, Pill } from "./HerramientasBits";

/** Cómo se lee cada evento del historial. */
const EVENTO_TEXTO = {
  prestamo: "Prestada a",
  devolucion: "Devuelta",
  consumo: "Dada de baja",
  extravio: "Reportada como extraviada",
  recuperacion: "Apareció",
  mantenimiento_entrada: "Entró a mantenimiento",
  mantenimiento_salida: "Salió de mantenimiento",
};

/**
 * Bitácora de la herramienta. Antes no existía: cada préstamo PISABA al
 * anterior en la misma fila, así que no había forma de saber quién había tenido
 * una llave. Las filas con `origen='reconstruido'` son las que se pudieron
 * rescatar de los datos viejos: se marcan porque NO son historia completa (lo
 * que se sobrescribió en su momento se perdió y no se puede inventar).
 */
function HistorialHerramienta({ herramientaId }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    supabase
      .from("herramientas_historial")
      .select(
        "id, evento, fecha, observaciones, origen, usuario:usuario_id(nombre), registrador:registrado_por(nombre)",
      )
      .eq("herramienta_id", herramientaId)
      .order("fecha", { ascending: false })
      .then(({ data, error: e }) => {
        if (cancel) return;
        // Un fallo aquí no puede quedar mudo: si no, la ficha diría "sin
        // movimientos" cuando en realidad no se pudo consultar.
        if (e) setError("No se pudo cargar el historial.");
        setFilas(data ?? []);
      });
    return () => {
      cancel = true;
    };
  }, [herramientaId]);

  return (
    <>
      {error && (
        <div className="text-[12.5px]" style={{ color: "var(--dang-700)" }}>
          {error}
        </div>
      )}
      {!error && filas === null && (
        <div className="text-[12.5px]" style={{ color: "var(--n-500)" }}>
          Cargando…
        </div>
      )}
      {!error && filas?.length === 0 && (
        <div className="text-[12.5px]" style={{ color: "var(--n-500)" }}>
          Sin movimientos registrados.
        </div>
      )}
      {!error && filas?.length > 0 && (
        <ul className="space-y-2.5" role="list">
          {filas.map((f) => (
            <li key={f.id} className="text-[12.5px]">
              <div style={{ color: "var(--n-950)" }}>
                <span className="font-medium">
                  {EVENTO_TEXTO[f.evento] ?? f.evento}
                </span>
                {f.evento === "prestamo" && f.usuario?.nombre
                  ? ` ${f.usuario.nombre}`
                  : ""}
              </div>
              <div style={{ color: "var(--n-500)" }}>
                {formatDate(f.fecha)}
                {f.registrador?.nombre ? ` · por ${f.registrador.nombre}` : ""}
                {f.origen === "reconstruido" && " · registro reconstruido"}
                {f.observaciones ? ` · ${f.observaciones}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

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
  esBodega,
  puedeOperar,
  onClose,
  onDevolver,
  onConsumir,
  onPrestar,
  onAgregarUnidades,
  onExtraviar,
  onRecuperar,
  onMantenimiento,
  onFinalizarMantenimiento,
}) {
  const h = herramienta;
  // El badge se calcula sobre `estado`, que en una herramienta regresada a
  // insumo sigue diciendo 'disponible'. Sin este ajuste el detalle la coronaba
  // con un "Disponible" verde pese a estar fuera del catálogo.
  const pill =
    h.activo === false && h.estado !== "consumido"
      ? { cls: "pill-neutral", label: "A insumo", tone: "neut" }
      : estadoPill(h.estado);
  // Una herramienta retirada (activo=false) ya no está en el catálogo: o se dio
  // de baja (consumido) o regresó al stock de insumo. En ambos casos su `estado`
  // puede seguir diciendo 'disponible', que es lo que hacía que el detalle
  // ofreciera "Prestar" sobre algo que físicamente ya no existe como herramienta.
  const estaRetirada = h.activo === false;
  const regresadaAInsumo = estaRetirada && h.estado !== "consumido";
  const esPrestada = h.estado === "prestada";
  const esDisponible = h.estado === "disponible" && !estaRetirada;
  const esExtraviada = h.estado === "extraviada";
  // Bodega y Admin manejan extravío y mantenimiento (mismo patrón que el resto
  // de la sección). Ninguna de las dos toca stock, así que no exigen Admin.
  // El rol dice QUÉ se puede hacer; la sede, DÓNDE. Desde que la lista muestra
  // herramientas de las cuatro sedes, sin la segunda condición saldrían botones
  // que el servidor rechaza por ser de otra sede.
  const puedeGestionar = puedeOperar && (esAdmin || esBodega) && !estaRetirada;
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

        {/* Sin esto, una herramienta de otra sede se ve sin ningún botón y
            sin explicación: la sede aparece arriba, pero nadie conecta "no veo
            acciones" con "es de otra sede". */}
        {!puedeOperar && !esAdmin && (
          <p
            className="mb-3 rounded-lg px-3 py-2 text-[12px]"
            style={{
              backgroundColor: "hsl(var(--muted) / 0.4)",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            Pertenece a {sedeLabel(h.sede_id)}. Solo esa sede o el Admin puede
            operarla desde aquí.
          </p>
        )}

        {/* ── Fila de acciones ─────────────────────────────────────── */}
        <div className="mb-5 flex flex-wrap gap-2">
          {/* Devolver: solo Admin o Bodega. Una inventariable la regresa al insumo
              (retiro) → solo Admin; una manual vuelve a 'disponible'. */}
          {esPrestada &&
            puedeOperar &&
            (esAdmin || esBodega) &&
            (!esInventariable || esAdmin) && (
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
          {/* fn_prestar_herramientas_lote exige sede propia salvo al Admin.
              Antes bastaba con que estuviera disponible porque la lista solo
              traía la sede propia; ahora trae las cuatro. */}
          {esDisponible && puedeOperar && onPrestar && (
            <button
              onClick={onPrestar}
              className="btn btn-pri inline-flex items-center gap-1.5"
              style={{ height: 48 }}
            >
              <UserCheck className="h-3.5 w-3.5" strokeWidth={2} /> Prestar
            </button>
          )}
          {/* Extravío y mantenimiento: hasta ahora la app pintaba estos estados
              pero NINGUNA función los escribía, así que no había forma de marcar
              una herramienta como perdida. Se puede extraviar una PRESTADA (es el
              caso real) y la ficha conserva a quién se le perdió. */}
          {puedeGestionar &&
            onExtraviar &&
            (esDisponible || esPrestada || esMantenimiento) && (
              <button
                onClick={onExtraviar}
                disabled={accionando}
                className="btn btn-out inline-flex items-center gap-1.5 disabled:opacity-50"
                style={{
                  height: 48,
                  borderColor: "var(--dang-border)",
                  color: "var(--dang-700)",
                }}
                title="Reportarla como perdida. Se puede recuperar si aparece."
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} /> Extraviada
              </button>
            )}
          {puedeGestionar && onRecuperar && esExtraviada && (
            <button
              onClick={onRecuperar}
              disabled={accionando}
              className="btn btn-pri inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{ height: 48 }}
              title="Apareció: vuelve al catálogo como disponible"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2} /> Apareció
            </button>
          )}
          {puedeGestionar &&
            onMantenimiento &&
            (esDisponible || esPrestada) && (
              <button
                onClick={onMantenimiento}
                disabled={accionando}
                className="btn btn-out inline-flex items-center gap-1.5 disabled:opacity-50"
                style={{ height: 48 }}
                title="Sale del catálogo mientras se repara. No toca el inventario."
              >
                A mantenimiento
              </button>
            )}
          {puedeGestionar && onFinalizarMantenimiento && esMantenimiento && (
            <button
              onClick={onFinalizarMantenimiento}
              disabled={accionando}
              className="btn btn-pri inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{ height: 48 }}
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2} /> Reparada
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
          {/* Agregar más unidades físicas de esta misma herramienta (para poder
              prestar varias). Solo Admin/Bodega, y solo si sigue vigente: sobre
              una retirada (consumida o regresada a insumo) no tiene sentido. */}
          {/* fn_crear_herramienta_desde_insumo también exige sede propia
              salvo al Admin. */}
          {onAgregarUnidades && puedeOperar && !estaRetirada && (
            <button
              onClick={onAgregarUnidades}
              className="btn btn-out inline-flex items-center gap-1.5"
              style={{ height: 48 }}
              title="Suma más unidades de esta herramienta para poder prestar varias"
            >
              <Boxes className="h-3.5 w-3.5" strokeWidth={2} /> Agregar unidades
            </button>
          )}
          {/* "Reportar daño / Enviar a mantenimiento" ya NO son placeholders sin
              backend: se implementaron arriba como botones reales (extraviar /
              a mantenimiento). Solo queda Imprimir QR pendiente de backend. */}
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
                    : h.estado === "consumido"
                      ? "Dada de baja"
                      : regresadaAInsumo
                        ? "Regresada al stock de insumo"
                        : "Disponible para préstamo"}
                </div>
                <div
                  className="mt-1 text-[12.5px]"
                  style={{ color: "var(--n-500)" }}
                >
                  {h.estado === "extraviada"
                    ? "Reportada como extraviada · no disponible para préstamo."
                    : h.estado === "consumido"
                      ? "Se consumió o se dañó · no regresó al inventario y ya no se puede prestar."
                      : regresadaAInsumo
                        ? "Su unidad volvió al stock de insumo · ya no está en el catálogo de herramientas."
                        : puedeOperar
                          ? "Sin préstamo activo. Puedes prestarla desde la lista de herramientas."
                          : `Disponible en ${sedeLabel(h.sede_id)} · solo esa sede o el Admin puede prestarla.`}
                </div>
              </div>
            )}

            {/* Ya hay backend: `herramientas_historial` (append-only). Antes cada
                préstamo pisaba al anterior en la misma fila y esta tarjeta decía
                que el historial "aún no se registra". */}
            <Card
              icon={<Activity className="h-4 w-4" strokeWidth={1.8} />}
              title="Historial de uso"
            >
              <HistorialHerramienta herramientaId={h.id} />
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
