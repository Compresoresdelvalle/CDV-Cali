import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeftCircle,
  Package,
  ShieldAlert,
  CreditCard,
  CheckSquare,
  Check,
  Activity,
  Printer,
  Truck,
  Ban,
} from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { useAuthStore } from "../../../stores/authStore";
import AnularGarantiaModal from "../../../components/garantias/AnularGarantiaModal";
import { formatCOP, formatDate, safeError } from "../../../lib/utils";
import {
  garantiaEstadoLabel,
  garantiaEstadoPillClass,
  resolucionPillClass,
  resolucionLabel,
  construirProcesoCompra,
  construirHistorialCompraGarantia,
} from "../../../lib/garantias-ui";
import {
  ProcesoStepper,
  HistorialTimeline,
  Fact,
  FactBox,
  MotivoBlock,
  PoliticaCard,
} from "../../../components/garantias/GarantiaBits";

/**
 * Detalle de una garantía de compra — F13 (alta fidelidad, diseño Lovable).
 *
 * Reproduce las secciones del diseño Lovable (`ops.garantias.$id.tsx`) sobre
 * datos REALES: cabecera, state machine del proceso, items reclamados (con la
 * acción real de marcar reposición recibida), nota crédito asociada, timeline
 * de historial y política F13.
 *
 * Lógica intacta: RPC `fn_marcar_reposicion_recibida` server-authoritative.
 *
 * RECONCILIACIÓN (Lovable vs. backend real):
 *   - Acciones Aprobar/Rechazar/Solicitar info y la "validación técnica del
 *     defecto" del diseño Lovable NO tienen respaldo en el backend real (la
 *     garantía de compra es server-authoritative; su resolución y estados se
 *     fijan vía RPC). Se omiten en lugar de simularlas. La única acción real
 *     es marcar la reposición física como recibida.
 *   - Fotos del defecto y documentos vinculados no existen en el backend; se
 *     omiten honestamente.
 */
export default function GarantiaCompraDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [garantia, setGarantia] = useState(null);
  const [detalles, setDetalles] = useState([]);
  const [notaCredito, setNotaCredito] = useState(null);
  const [seleccion, setSeleccion] = useState({}); // { detalle_id: true }
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";
  const [anulOpen, setAnulOpen] = useState(false);
  const [anulBusy, setAnulBusy] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const [
        { data: g, error: gErr },
        { data: d, error: dErr },
        { data: n, error: nErr },
      ] = await Promise.all([
        supabase
          .from("garantias_compra")
          .select(
            `id, numero, fecha, resolucion, estado, motivo, fecha_cierre,
             compra:compra_id(id, numero, proveedor, fecha)`,
          )
          .eq("id", id)
          .single(),
        supabase
          .from("detalle_garantia_compra")
          .select(
            `id, cantidad, costo_unitario, reposicion_recibida_at,
             producto:producto_id(nombre, codigo_interno, referencia)`,
          )
          .eq("garantia_id", id),
        supabase
          .from("notas_credito_proveedor")
          .select("id, numero, monto, saldo_restante, fecha, observaciones")
          .eq("garantia_compra_id", id)
          .maybeSingle(),
      ]);
      if (gErr) throw gErr;
      if (dErr) throw dErr;
      if (nErr) throw nErr;
      setGarantia(g);
      setDetalles(d ?? []);
      setNotaCredito(n);
    } catch (err) {
      setErrorMsg(safeError(err, "Error al cargar garantía"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const marcarReposicion = async () => {
    const seleccionados = detalles.filter(
      (d) => seleccion[d.id] && !d.reposicion_recibida_at,
    );
    if (seleccionados.length === 0) {
      setErrorMsg("Selecciona al menos un item para marcar recibido");
      return;
    }
    setSubmitting(true);
    setErrorMsg("");
    try {
      const { error } = await supabase.rpc("fn_marcar_reposicion_recibida", {
        p_garantia_id: id,
        p_items: seleccionados.map((d) => ({ detalle_id: d.id })),
      });
      if (error) throw error;
      setSeleccion({});
      await cargar();
    } catch (err) {
      setErrorMsg(safeError(err, "Error al marcar reposición"));
    } finally {
      setSubmitting(false);
    }
  };

  const anularGarantia = async (motivo) => {
    setAnulBusy(true);
    setErrorMsg("");
    try {
      const { error } = await supabase.rpc("fn_anular_garantia_compra", {
        p_garantia_id: id,
        p_motivo: motivo,
      });
      if (error) throw error;
      setAnulOpen(false);
      await cargar();
    } catch (err) {
      setAnulOpen(false);
      setErrorMsg(safeError(err, "No se pudo anular la garantía"));
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

  if (!garantia) {
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

  const puedeRecibir = garantia.estado === "reposicion_pendiente";
  const total = detalles.reduce(
    (acc, d) => acc + Number(d.cantidad) * Number(d.costo_unitario),
    0,
  );
  const pasos = construirProcesoCompra(garantia, formatDate);
  const historial = construirHistorialCompraGarantia(
    garantia,
    notaCredito,
    formatDate,
  );
  const politica = [
    "Garantía de compra: devolución al proveedor por defecto de fábrica o vicio oculto.",
    "Resoluciones posibles: reposición física del producto o nota de crédito.",
    "El stock reclamado sale del inventario al abrir la garantía (movimiento auditado).",
    "La reposición física debe confirmarse al recibirla; reingresa al inventario.",
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
            Garantía de compra · Reclamo al proveedor
          </div>
          <div className="ph-num">#{garantia.numero}</div>
          <div className="ph-client">{garantia.compra?.proveedor ?? "—"}</div>
          <div className="ph-sub">
            Abierta el{" "}
            <b
              className="font-mono font-medium"
              style={{ color: "var(--n-700)" }}
            >
              {formatDate(garantia.fecha)}
            </b>
            {garantia.fecha_cierre &&
              ` · Cerrada el ${formatDate(garantia.fecha_cierre)}`}
          </div>
        </div>
        <div className="flex flex-col items-end gap-3">
          <span
            className={garantiaEstadoPillClass(garantia.estado)}
            style={{ padding: "6px 14px" }}
          >
            <span className="dot" />
            {garantiaEstadoLabel(garantia.estado)}
          </span>
          <div className="text-right">
            <div className="ph-total-lbl">Monto reclamado</div>
            <div className="ph-total">{formatCOP(total)}</div>
          </div>
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
        {garantia.compra && (
          <button
            onClick={() => navigate(`/ops/compras/${garantia.compra.id}`)}
            className="btn btn-out"
            style={{ height: 48 }}
          >
            <Truck className="h-3.5 w-3.5" strokeWidth={2} />
            Ver compra origen
          </button>
        )}
        {esAdmin && garantia.estado !== "anulada" && (
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
        tipo="compra"
        busy={anulBusy}
        onClose={() => setAnulOpen(false)}
        onConfirm={anularGarantia}
      />

      {/* ── State machine ───────────────────────────────────────────── */}
      <ProcesoStepper pasos={pasos} />

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-3">
          {/* Datos de la reclamación */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <ShieldAlert className="h-3.5 w-3.5" />
              </div>
              <div className="ib-title">Datos de la reclamación</div>
              <div className="ib-aux">
                <span className={resolucionPillClass(garantia.resolucion)}>
                  <span className="dot" />
                  {resolucionLabel(garantia.resolucion)}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 gap-x-3.5">
              <Fact
                lk="Compra origen"
                v={
                  <button
                    onClick={() =>
                      navigate(`/ops/compras/${garantia.compra?.id}`)
                    }
                    className="link-pill"
                  >
                    Compra #{garantia.compra?.numero}
                  </button>
                }
              />
              <Fact lk="Proveedor" v={garantia.compra?.proveedor ?? "—"} />
              {garantia.compra?.fecha && (
                <Fact
                  lk="Fecha de compra"
                  v={formatDate(garantia.compra.fecha)}
                  mono
                />
              )}
            </div>
            {garantia.motivo ? (
              <MotivoBlock motivo={garantia.motivo} />
            ) : (
              <p
                className="mt-3 text-[12.5px]"
                style={{ color: "var(--n-500)" }}
              >
                No se registró un motivo para esta reclamación.
              </p>
            )}
          </div>

          {/* Items reclamados */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <Package className="h-3.5 w-3.5" />
              </div>
              <div className="ib-title">Items reclamados</div>
              <div className="ib-aux">
                {detalles.length} item{detalles.length === 1 ? "" : "s"}
              </div>
            </div>
            <ul className="flex flex-col gap-1.5">
              {detalles.map((d) => {
                const recibido = !!d.reposicion_recibida_at;
                return (
                  <li
                    key={d.id}
                    className="flex items-center gap-3 rounded-lg border px-3.5 py-2.5"
                    style={{
                      borderColor: seleccion[d.id]
                        ? "var(--p-400)"
                        : "var(--n-100)",
                      backgroundColor: seleccion[d.id]
                        ? "var(--p-50)"
                        : "var(--n-0)",
                    }}
                  >
                    {puedeRecibir && !recibido && (
                      <input
                        type="checkbox"
                        checked={!!seleccion[d.id]}
                        onChange={() =>
                          setSeleccion((p) => ({ ...p, [d.id]: !p[d.id] }))
                        }
                        className="h-4 w-4 cursor-pointer"
                        style={{ accentColor: "var(--p-600)" }}
                      />
                    )}
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
                    <div className="text-right">
                      <p
                        className="font-mono text-[13px]"
                        style={{ color: "var(--n-700)" }}
                      >
                        {d.cantidad} × {formatCOP(d.costo_unitario)}
                      </p>
                      {recibido ? (
                        <p
                          className="inline-flex items-center gap-1 text-[10.5px] font-semibold"
                          style={{ color: "var(--succ-700)" }}
                        >
                          <Check className="h-3 w-3" strokeWidth={3} />
                          recibido {formatDate(d.reposicion_recibida_at)}
                        </p>
                      ) : puedeRecibir ? (
                        <p
                          className="text-[10.5px]"
                          style={{ color: "var(--n-500)" }}
                        >
                          pendiente
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            {puedeRecibir && (
              <button
                onClick={marcarReposicion}
                disabled={submitting}
                className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium text-white disabled:opacity-50"
                style={{ minHeight: 48, backgroundColor: "var(--succ-500)" }}
              >
                <CheckSquare className="h-4 w-4" strokeWidth={1.8} />
                {submitting
                  ? "Procesando…"
                  : "Marcar items seleccionados como recibidos"}
              </button>
            )}
          </div>
        </div>

        {/* Columna lateral · nota crédito + historial + política */}
        <div className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
          {notaCredito ? (
            <div className="iblock">
              <div className="ib-head">
                <div className="ib-ico succ">
                  <CreditCard className="h-3.5 w-3.5" />
                </div>
                <div className="ib-title">
                  Nota crédito #{notaCredito.numero}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2.5">
                <FactBox lk="Monto" v={formatCOP(notaCredito.monto)} />
                <FactBox
                  lk="Saldo disponible"
                  v={formatCOP(notaCredito.saldo_restante)}
                  tone="succ"
                />
                <FactBox lk="Emitida" v={formatDate(notaCredito.fecha)} />
              </div>
              <p
                className="mt-3 text-[12px] leading-[1.5]"
                style={{ color: "var(--n-500)" }}
              >
                Aplicable en próximas compras al mismo proveedor (función
                disponible en el módulo de compras).
              </p>
            </div>
          ) : (
            <div
              className="rounded-[10px] border p-4 text-[12.5px] leading-[1.5]"
              style={{
                borderColor: "var(--n-150)",
                backgroundColor: "var(--n-0)",
                color: "var(--n-500)",
              }}
            >
              {garantia.resolucion === "nota_credito"
                ? "Nota crédito aún no registrada."
                : "Resolución por reposición física — sin nota crédito."}
            </div>
          )}

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
        </div>
      </div>
    </div>
  );
}
