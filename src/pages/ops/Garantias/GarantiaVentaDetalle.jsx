import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeftCircle,
  ShieldCheck,
  Package,
  Wrench,
  User,
  Activity,
  CheckSquare,
  Printer,
  MessageSquare,
  Ban,
} from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { useAuthStore } from "../../../stores/authStore";
import AnularGarantiaModal from "../../../components/garantias/AnularGarantiaModal";
import { formatCOP, formatDate, safeError } from "../../../lib/utils";
import { getParametroInt } from "../../../hooks/useParametro";
import { avisarOk, avisarError } from "../../../lib/notify";
import {
  garantiaEstadoLabel,
  garantiaEstadoPillClass,
  resolucionPillClass,
  resolucionLabel,
  calcularVigencia,
  construirProcesoVenta,
  construirHistorialVentaGarantia,
} from "../../../lib/garantias-ui";
import {
  VigenciaBox,
  ProcesoStepper,
  HistorialTimeline,
  Fact,
  MotivoBlock,
  PoliticaCard,
} from "../../../components/garantias/GarantiaBits";

/**
 * Detalle de garantía de venta — F13 (alta fidelidad, diseño Lovable).
 *
 * Reproduce las secciones del diseño Lovable (`ops.garantias.$id.tsx`) sobre
 * datos REALES, read-only: cabecera + vigencia derivada, state machine del
 * proceso, origen/cliente, motivo de la reclamación, repuestos entregados,
 * timeline de historial y política F13.
 *
 * RECONCILIACIÓN (Lovable vs. backend real):
 *   - "Días restantes / vence": el backend NO guarda vencimiento; se DERIVA de
 *     la fecha origen (venta.fecha u orden.fecha_entrega) + el parámetro real
 *     `dias_garantia_venta`. Misma fórmula que usa la RPC server-authoritative.
 *   - Acciones Aprobar/Rechazar/Solicitar info, validación técnica, fotos del
 *     defecto y documentos vinculados NO tienen respaldo en el backend real
 *     (la garantía es server-authoritative y se resuelve al abrirse). Se omiten
 *     en lugar de simularlas. El proceso refleja el estado real (abierta/cerrada).
 */
export default function GarantiaVentaDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [g, setG] = useState(null);
  const [detalles, setDetalles] = useState([]);
  const [diasGarantia, setDiasGarantia] = useState(90);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";
  const [anulOpen, setAnulOpen] = useState(false);
  const [anulBusy, setAnulBusy] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const cargar = async () => {
      setLoading(true);
      setErrorMsg("");
      try {
        const [{ data: gar, error: garErr }, { data: det, error: detErr }] =
          await Promise.all([
            supabase
              .from("garantias_venta")
              .select(
                `id, numero, fecha, resolucion, estado, motivo, monto_devuelto,
               venta:venta_id(id, numero, cliente_nombre, fecha, total, vendedor:vendedor_id(nombre)),
               orden:orden_servicio_id(id, numero, cliente_nombre, cliente_telefono, fecha_entrega, total),
               ot_reparacion:ot_reparacion_id(id, numero, estado, tipo)`,
              )
              .eq("id", id)
              .single(),
            supabase
              .from("detalle_garantia_venta")
              .select(
                `id, cantidad, producto:producto_id(nombre, codigo_interno, referencia)`,
              )
              .eq("garantia_id", id),
          ]);
        if (garErr) throw garErr;
        if (detErr) throw detErr;
        setG(gar);
        setDetalles(det ?? []);
        // Vigencia real: parámetro de sistema (misma clave que la RPC).
        const dias = await getParametroInt("dias_garantia_venta", 90);
        setDiasGarantia(dias);
      } catch (err) {
        setErrorMsg(safeError(err, "Error al cargar garantía"));
      } finally {
        setLoading(false);
      }
    };
    cargar();
  }, [id, reloadTick]);

  const anularGarantia = async (motivo) => {
    setAnulBusy(true);
    setErrorMsg("");
    try {
      const { error } = await supabase.rpc("fn_anular_garantia_venta", {
        p_garantia_id: id,
        p_motivo: motivo,
      });
      if (error) throw error;
      setAnulOpen(false);
      avisarOk("Garantía anulada");
      setReloadTick((t) => t + 1);
    } catch (err) {
      setAnulOpen(false);
      avisarError(err, "No se pudo anular la garantía");
    } finally {
      setAnulBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1100px] px-4 py-5 sm:px-7 sm:py-6">
        <div
          className="h-12 animate-pulse rounded-[10px]"
          style={{ backgroundColor: "var(--n-100)" }}
        />
      </div>
    );
  }

  if (!g) {
    return (
      <div className="mx-auto w-full max-w-[1100px] space-y-3 px-4 py-5 sm:px-7 sm:py-6">
        <p style={{ color: "var(--dang-700)" }}>
          {errorMsg || "Garantía no encontrada"}
        </p>
        <button
          onClick={() => navigate("/ops/garantias")}
          className="back-btn inline-flex items-center gap-1.5"
        >
          <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
          Volver a Garantías
        </button>
      </div>
    );
  }

  const origen = g.venta
    ? {
        tipo: "Venta",
        num: g.venta.numero,
        cliente: g.venta.cliente_nombre,
        fecha: g.venta.fecha,
        total: g.venta.total,
        vendedor: g.venta.vendedor?.nombre ?? null,
        telefono: null,
        route: `/ops/ventas/${g.venta.id}`,
        pillClass: "link-pill v",
      }
    : g.orden
      ? {
          tipo: "OT",
          num: g.orden.numero,
          cliente: g.orden.cliente_nombre,
          fecha: g.orden.fecha_entrega,
          total: g.orden.total,
          vendedor: null,
          telefono: g.orden.cliente_telefono ?? null,
          route: `/ops/ordenes/${g.orden.id}`,
          pillClass: "link-pill ot",
        }
      : null;

  const vigencia = calcularVigencia(origen?.fecha, diasGarantia);
  const pasos = construirProcesoVenta(g, formatDate);
  const historial = construirHistorialVentaGarantia(g, formatDate);
  const politica = [
    `Garantía de venta: ${diasGarantia} días desde la fecha de ${
      g.orden ? "entrega de la OT" : "venta"
    }.`,
    "Cubre: defectos de fábrica reproducibles y fallas prematuras.",
    "No cubre: uso fuera de especificación, daño por instalación o modificaciones.",
    "Resoluciones posibles: reparación, cambio de pieza o reembolso (reembolso solo Admin).",
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      <button
        onClick={() => navigate("/ops/garantias")}
        className="back-btn inline-flex w-fit items-center gap-1.5"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver a Garantías
      </button>

      {/* ── Cabecera ────────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-start justify-between gap-5 border-b pb-4"
        style={{ borderColor: "var(--n-100)" }}
      >
        <div className="min-w-0 flex-1">
          <div className="ph-eyebrow">
            Garantía de venta · Reclamo del cliente
          </div>
          <div className="ph-num">#{g.numero}</div>
          <div className="ph-client">{origen?.cliente ?? "—"}</div>
          <div className="ph-sub">
            Reportada el{" "}
            <b
              className="font-mono font-medium"
              style={{ color: "var(--n-700)" }}
            >
              {formatDate(g.fecha)}
            </b>
            {origen && (
              <>
                {" "}
                · {origen.tipo} #{origen.num}
              </>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-3">
          <span
            className={garantiaEstadoPillClass(g.estado)}
            style={{ padding: "6px 14px" }}
          >
            <span className="dot" />
            {garantiaEstadoLabel(g.estado)}
          </span>
          <VigenciaBox
            vence={vigencia.vence}
            diasRestantes={vigencia.diasRestantes}
            tone={vigencia.tone}
            fmtDate={formatDate}
          />
        </div>
      </div>

      {/* ── Barra de acciones ───────────────────────────────────────── */}
      <div className="action-bar">
        <button
          onClick={() => window.print()}
          className="btn btn-out"
          style={{ height: 48 }}
        >
          <Printer className="h-3.5 w-3.5" strokeWidth={2} />
          Imprimir comprobante
        </button>
        {origen && (
          <button
            onClick={() => navigate(origen.route)}
            className="btn btn-out"
            style={{ height: 48 }}
          >
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
            Ver {origen.tipo.toLowerCase()} origen
          </button>
        )}
        {esAdmin && g.estado !== "anulada" && (
          <button
            onClick={() => setAnulOpen(true)}
            className="btn btn-out"
            style={{
              height: 48,
              color: "hsl(var(--destructive))",
              borderColor: "hsl(var(--destructive) / 0.4)",
            }}
          >
            <Ban className="h-3.5 w-3.5" strokeWidth={2} />
            Anular garantía
          </button>
        )}
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-[10px] border px-4 py-3 text-sm"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
            color: "var(--dang-700)",
          }}
        >
          {errorMsg}
        </div>
      )}

      <AnularGarantiaModal
        open={anulOpen}
        tipo="venta"
        busy={anulBusy}
        onClose={() => setAnulOpen(false)}
        onConfirm={anularGarantia}
      />

      {/* ── State machine ───────────────────────────────────────────── */}
      <ProcesoStepper pasos={pasos} />

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-3">
          {/* Cliente y venta origen */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <User className="h-3.5 w-3.5" />
              </div>
              <div className="ib-title">Cliente y origen</div>
            </div>
            <div className="grid grid-cols-2 gap-3 gap-x-3.5">
              <Fact lk="Cliente" v={origen?.cliente ?? "—"} />
              <Fact
                lk="Origen"
                v={
                  origen ? (
                    <button
                      onClick={() => navigate(origen.route)}
                      className={origen.pillClass}
                    >
                      {origen.tipo} #{origen.num}
                    </button>
                  ) : (
                    "—"
                  )
                }
              />
              {origen?.telefono && (
                <Fact lk="Teléfono" v={origen.telefono} mono />
              )}
              {origen?.vendedor && <Fact lk="Vendedor" v={origen.vendedor} />}
              {origen?.fecha && (
                <Fact lk="Fecha origen" v={formatDate(origen.fecha)} mono />
              )}
              {origen?.total != null && (
                <Fact lk="Monto origen" v={formatCOP(origen.total)} mono />
              )}
            </div>
            <div
              className="mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-[12.5px]"
              style={{
                borderColor:
                  vigencia.tone === "expired"
                    ? "var(--dang-border)"
                    : "var(--succ-border)",
                backgroundColor:
                  vigencia.tone === "expired"
                    ? "var(--dang-50)"
                    : "var(--succ-50)",
                color:
                  vigencia.tone === "expired"
                    ? "var(--dang-700)"
                    : "var(--succ-700)",
              }}
            >
              <ShieldCheck className="h-4 w-4 shrink-0" />
              {vigencia.diasRestantes == null ? (
                <span>Vigencia no disponible (sin fecha de origen).</span>
              ) : vigencia.tone === "expired" ? (
                <span>
                  Fuera de garantía · venció el {formatDate(vigencia.vence)}.
                </span>
              ) : (
                <span>
                  Dentro de garantía · faltan{" "}
                  <b>{vigencia.diasRestantes} días</b> (
                  {formatDate(vigencia.vence)}).
                </span>
              )}
            </div>
          </div>

          {/* Reclamación / motivo */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <MessageSquare className="h-3.5 w-3.5" />
              </div>
              <div className="ib-title">Reclamación y resolución</div>
              <div className="ib-aux">
                <span className={resolucionPillClass(g.resolucion)}>
                  <span className="dot" />
                  {resolucionLabel(g.resolucion)}
                </span>
              </div>
            </div>
            {g.motivo ? (
              <MotivoBlock motivo={g.motivo} />
            ) : (
              <p className="text-[12.5px]" style={{ color: "var(--n-500)" }}>
                No se registró un motivo para esta reclamación.
              </p>
            )}
            {g.ot_reparacion && (
              <div className="mt-3">
                <Fact
                  lk="OT de reparación"
                  v={
                    <button
                      onClick={() =>
                        navigate(`/ops/ordenes/${g.ot_reparacion.id}`)
                      }
                      className="link-pill ot"
                    >
                      <Wrench className="h-3 w-3" />#{g.ot_reparacion.numero}
                    </button>
                  }
                />
              </div>
            )}
            {g.monto_devuelto != null && (
              <div className="mt-3">
                <Fact
                  lk="Monto devuelto"
                  v={formatCOP(g.monto_devuelto)}
                  mono
                />
              </div>
            )}
          </div>

          {/* Repuestos entregados (cambiar_pieza) */}
          {detalles.length > 0 && (
            <div className="iblock">
              <div className="ib-head">
                <div className="ib-ico">
                  <Package className="h-3.5 w-3.5" />
                </div>
                <div className="ib-title">Repuestos entregados</div>
                <div className="ib-aux">{detalles.length} items</div>
              </div>
              <ul className="flex flex-col gap-1.5">
                {detalles.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center gap-3 rounded-lg border px-3.5 py-2.5"
                    style={{
                      borderColor: "var(--n-100)",
                      backgroundColor: "var(--n-0)",
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[12.5px] font-medium leading-tight"
                        style={{ color: "var(--n-950)" }}
                      >
                        {d.producto?.nombre}
                      </p>
                      <p
                        className="font-mono text-[11px]"
                        style={{ color: "var(--n-500)" }}
                      >
                        {d.producto?.codigo_interno ?? d.producto?.referencia}
                      </p>
                    </div>
                    <span
                      className="font-mono text-[13px] font-medium"
                      style={{ color: "var(--n-700)" }}
                    >
                      × {d.cantidad}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Columna lateral · historial + política */}
        <div className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <Activity className="h-3.5 w-3.5" />
              </div>
              <div className="ib-title">Historial</div>
            </div>
            <HistorialTimeline eventos={historial} />
          </div>

          <PoliticaCard items={politica} />

          <div
            className="flex items-start gap-2.5 rounded-[10px] border p-4 text-[12px] leading-[1.5]"
            style={{
              borderColor: "var(--n-150)",
              backgroundColor: "var(--n-0)",
              color: "var(--n-500)",
            }}
          >
            <CheckSquare className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Garantía server-authoritative: la resolución se fija al abrir la
              reclamación y no se edita desde aquí.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
