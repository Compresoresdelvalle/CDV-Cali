import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  ArrowLeftCircle,
  User,
  FileText,
  Wallet,
  Link2,
  Activity,
  Printer,
  Download,
  XCircle,
} from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../../lib/utils";
import { useConfirm } from "../../../components/ui/ConfirmDialog";
import { generarReciboPDF } from "../../../lib/pdf/reciboPDF";
import { avisarOk, avisarError } from "../../../lib/notify";
import {
  metodoPagoLabel,
  cuentaBancariaLabel,
  reciboTipo,
  reciboTipoPillStyle,
  construirHistorialRecibo,
} from "../../../lib/recibos-ui";

/**
 * Detalle de un recibo de pago — Fase 14 (re-vestido con diseño Lovable, alta
 * fidelidad). Lógica intacta: carga server-side, PDF real (Descargar /
 * Imprimir) vía generarReciboPDF, anulación server-authoritative vía
 * fn_anular_recibo. El panel derecho es un preview en vivo del PDF (mismo
 * layout que el generado), igual al estándar de VentaDetalle.
 */
export default function ReciboDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();

  const [recibo, setRecibo] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [anulando, setAnulando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const { data: r, error } = await supabase
        .from("recibos")
        .select(
          `id, numero, fecha, sede_id, cliente_nombre, cliente_nit, concepto,
           cotizacion_id, orden_id, subtotal, iva_pct, total, abonos_previos,
           monto_pagado, saldo, metodo_pago, observaciones, anulado, abono_id,
           recibidor:recibido_por(nombre),
           cuenta:cuenta_bancaria_id(banco, tipo, numero, titular)`,
        )
        .eq("id", id)
        .single();
      if (error || !r) throw new Error("Recibo no encontrado");
      const { data: det } = await supabase
        .from("detalle_recibo")
        .select("descripcion, cantidad, precio_unitario, subtotal")
        .eq("recibo_id", id);
      setRecibo(r);
      setItems(det ?? []);
    } catch (err) {
      setErrorMsg(safeError(err, "Error al cargar el recibo"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // #17: un ÚNICO documento PDF alimenta el preview (iframe) Y la impresión,
  // así lo que se ve en pantalla es exactamente lo que se imprime.
  const reciboDoc = useMemo(() => {
    if (!recibo) return null;
    return generarReciboPDF({
      recibo,
      items,
      cuenta: recibo.cuenta ?? null,
      recibidoPor: recibo.recibidor?.nombre ?? "—",
    });
  }, [recibo, items]);

  // URL del blob para el <iframe> de preview (se libera al cambiar/desmontar).
  const [reciboUrl, setReciboUrl] = useState(null);
  useEffect(() => {
    if (!reciboDoc) {
      setReciboUrl(null);
      return;
    }
    const url = URL.createObjectURL(reciboDoc.blob);
    setReciboUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [reciboDoc]);

  // Imprime / descarga EL MISMO documento que muestra el preview.
  const manejarPDF = (accion) => {
    if (!reciboDoc) return;
    try {
      if (accion === "print") reciboDoc.print();
      else reciboDoc.download();
    } catch (err) {
      avisarError(err, "No se pudo generar el PDF del recibo");
    }
  };

  const anular = async () => {
    const ok = await confirm({
      titulo: "Anular recibo",
      mensaje: `Se anulará el recibo #${recibo.numero}. Si registró un abono en una OT, ese abono se eliminará. Esta acción no se puede deshacer.`,
      confirmLabel: "Sí, anular",
      danger: true,
    });
    if (!ok) return;
    setAnulando(true);
    setErrorMsg("");
    try {
      const { error } = await supabase.rpc("fn_anular_recibo", {
        p_recibo_id: id,
      });
      if (error) throw error;
      avisarOk("Recibo anulado");
      await cargar();
    } catch (err) {
      avisarError(err, "Error al anular el recibo");
    } finally {
      setAnulando(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1240px] px-4 py-5 sm:px-7 sm:py-6 animate-pulse">
        <div
          className="h-8 w-1/3 rounded-lg"
          style={{ backgroundColor: "var(--n-100)" }}
        />
        <div
          className="mt-4 space-y-3 rounded-[10px] border p-5"
          style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
        >
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-4 w-3/4 rounded"
              style={{ backgroundColor: "var(--n-100)" }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (!recibo) {
    return (
      <div className="mx-auto w-full max-w-[1240px] px-4 py-5 sm:px-7 sm:py-6">
        <button onClick={() => navigate("/ops/recibos")} className="back-btn">
          <ArrowLeftCircle className="size-3.5" />
          Volver a Recibos
        </button>
        <p className="mt-4 text-sm" style={{ color: "var(--dang-700)" }}>
          {errorMsg || "Recibo no encontrado"}
        </p>
      </div>
    );
  }

  const ivaMonto = Number(recibo.total) - Number(recibo.subtotal);
  const tipo = reciboTipo(recibo);
  const historial = construirHistorialRecibo(recibo, formatDate);

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      <button onClick={() => navigate("/ops/recibos")} className="back-btn">
        <ArrowLeftCircle className="size-3.5" />
        Volver a Recibos
      </button>

      {/* ── Banner de origen (recibo desde cotización) ─────────────────── */}
      {recibo.cotizacion_id && (
        <div className="banner-info mt-4">
          <Link2 className="mt-0.5 size-3.5 shrink-0" />
          <div className="body">
            Este recibo fue generado <b>desde una cotización</b>. Datos del
            cliente y concepto pre-cargados de la cotización origen.
          </div>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        className="mt-4 flex flex-col items-start gap-4 border-b pb-4 md:flex-row md:items-start md:gap-6"
        style={{ borderColor: "var(--n-150)" }}
      >
        <div className="min-w-0 flex-1">
          <div className="ph-eyebrow">Recibo de pago · Consecutivo auto BD</div>
          <div className="ph-num">#{recibo.numero}</div>
          <div className="ph-client">{recibo.cliente_nombre}</div>
          <div className="ph-sub">
            Emitido el{" "}
            <b
              className="font-mono font-medium"
              style={{ color: "var(--n-900)" }}
            >
              {formatDate(recibo.fecha)}
            </b>{" "}
            · Por {recibo.recibidor?.nombre ?? "—"}
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 md:items-end">
          <span className={`ph-state ${recibo.anulado ? "danger" : "succ"}`}>
            <span className="dot" />
            {recibo.anulado ? "Anulado" : "Activo"}
          </span>
          <div className="flex flex-col md:items-end">
            <span className="ph-total-lbl">Total</span>
            <span
              className="ph-total"
              style={
                recibo.anulado
                  ? { textDecoration: "line-through", color: "var(--n-300)" }
                  : undefined
              }
            >
              {formatCOP(recibo.total)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Action bar ─────────────────────────────────────────────────── */}
      <div className="action-bar mt-4">
        <button
          onClick={() => manejarPDF("print")}
          className="btn btn-out"
          style={{ height: 48 }}
        >
          <Printer className="size-3.5" />
          Imprimir
        </button>
        <button
          onClick={() => manejarPDF("download")}
          className="btn btn-out"
          style={{ height: 48 }}
        >
          <Download className="size-3.5" />
          Descargar PDF
        </button>
        {!recibo.anulado && (
          <button
            onClick={anular}
            disabled={anulando}
            className="btn btn-out disabled:opacity-50"
            style={{ height: 48, color: "var(--dang-700)" }}
          >
            <XCircle className="size-3.5" />
            {anulando ? "Anulando…" : "Anular recibo"}
          </button>
        )}
      </div>

      {/* ── Error ──────────────────────────────────────────────────────── */}
      {errorMsg && (
        <div
          role="alert"
          className="mt-4 rounded-[10px] border px-4 py-3 text-sm"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
            color: "var(--dang-700)",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* ── Layout: contenido + preview PDF sticky ─────────────────────── */}
      <div className="mt-4 grid items-start gap-3 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-3">
          {/* Cliente */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <User className="size-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Cliente</div>
            </div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Kv label="Razón social" value={recibo.cliente_nombre} full />
              <Kv label="NIT / Cédula" value={recibo.cliente_nit ?? "—"} mono />
              <Kv
                label="Recibido por"
                value={recibo.recibidor?.nombre ?? "—"}
              />
            </div>
          </div>

          {/* Concepto y monto */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <FileText className="size-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Concepto y monto</div>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <div
                  className="font-mono text-[10px] uppercase tracking-[0.08em]"
                  style={{ color: "var(--n-300)" }}
                >
                  Concepto
                </div>
                <div
                  className="whitespace-pre-line text-[13px] leading-[1.5]"
                  style={{ color: "var(--n-900)" }}
                >
                  {recibo.concepto}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <div
                    className="font-mono text-[10px] uppercase tracking-[0.08em]"
                    style={{ color: "var(--n-300)" }}
                  >
                    Total
                  </div>
                  <div
                    className="mt-1 font-mono text-[18px] font-medium"
                    style={{ color: "var(--n-900)" }}
                  >
                    {formatCOP(recibo.total)}
                  </div>
                </div>
                <div>
                  <div
                    className="font-mono text-[10px] uppercase tracking-[0.08em]"
                    style={{ color: "var(--n-300)" }}
                  >
                    Tipo
                  </div>
                  <div className="mt-1.5">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
                      style={reciboTipoPillStyle(tipo.tone)}
                    >
                      <span
                        className="size-1.5 rounded-full"
                        style={{
                          backgroundColor: "currentColor",
                          opacity: 0.7,
                        }}
                      />
                      {tipo.label}
                    </span>
                  </div>
                </div>
              </div>
              {recibo.observaciones && (
                <div>
                  <div
                    className="font-mono text-[10px] uppercase tracking-[0.08em]"
                    style={{ color: "var(--n-300)" }}
                  >
                    Observaciones
                  </div>
                  <div
                    className="whitespace-pre-line text-[13px] leading-[1.5]"
                    style={{ color: "var(--n-900)" }}
                  >
                    {recibo.observaciones}
                  </div>
                </div>
              )}
            </div>

            {/* Detalle de ítems (si vino de cotización) */}
            {items.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="prod-tbl">
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={idx}>
                        <td>
                          <div className="p-nm">{it.descripcion}</div>
                        </td>
                        <td className="p-pr" style={{ width: 170 }}>
                          ×{it.cantidad} · {formatCOP(it.precio_unitario)}
                        </td>
                        <td className="p-sub" style={{ width: 130 }}>
                          {formatCOP(it.subtotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Totales */}
            <div className="totals">
              <div className="ln">
                <span>Subtotal</span>
                <span className="v">{formatCOP(recibo.subtotal)}</span>
              </div>
              {ivaMonto > 0 && (
                <div className="ln">
                  <span>IVA {Number(recibo.iva_pct)}%</span>
                  <span className="v">{formatCOP(ivaMonto)}</span>
                </div>
              )}
              <div className="ln tot">
                <span>Total</span>
                <span className="v">{formatCOP(recibo.total)}</span>
              </div>
              {Number(recibo.abonos_previos) > 0 && (
                <div className="ln">
                  <span>Abonos previos</span>
                  <span className="v">−{formatCOP(recibo.abonos_previos)}</span>
                </div>
              )}
              <div className="ln">
                <span>Monto recibido</span>
                <span className="v">{formatCOP(recibo.monto_pagado)}</span>
              </div>
              <div className="ln tot">
                <span>Saldo pendiente</span>
                <span className="v">{formatCOP(recibo.saldo)}</span>
              </div>
            </div>
          </div>

          {/* Pago */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico succ">
                <Wallet className="size-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Pago</div>
              <div className="ib-aux">
                {metodoPagoLabel(recibo.metodo_pago)}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Kv label="Método" value={metodoPagoLabel(recibo.metodo_pago)} />
              <Kv
                label="Monto recibido"
                value={formatCOP(recibo.monto_pagado)}
                mono
              />
              {recibo.cuenta && (
                <Kv
                  label="Cuenta destino"
                  value={cuentaBancariaLabel(recibo.cuenta)}
                  full
                  mono
                />
              )}
            </div>
          </div>

          {/* Vinculaciones del ciclo comercial (reales o estado vacío honesto) */}
          <div className="iblock info-tint">
            <div className="ib-head">
              <div className="ib-ico info">
                <Link2 className="size-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Vinculaciones del ciclo comercial</div>
            </div>
            <div className="vinc-link-grid">
              <VincLink
                kind="Cotización origen"
                num={recibo.cotizacion_id ? "Vinculada" : "—"}
                estado={
                  recibo.cotizacion_id
                    ? "Recibo generado desde cotización"
                    : "Sin cotización"
                }
              />
              <VincLink
                kind="OT vinculada"
                num={recibo.orden_id ? "Vinculada" : "—"}
                estado={
                  recibo.orden_id
                    ? recibo.abono_id
                      ? "Con abono registrado"
                      : "Vinculada · sin abono"
                    : "Sin OT"
                }
              />
            </div>
            {recibo.abono_id && Number(recibo.abonos_previos) > 0 && (
              <div
                className="mt-3 text-[11.5px] leading-[1.5]"
                style={{ color: "var(--info-700)" }}
              >
                El abono previo de{" "}
                <b className="font-mono">{formatCOP(recibo.abonos_previos)}</b>{" "}
                de la OT vinculada queda consolidado dentro de este recibo.
                Saldo después del recibo:{" "}
                <b className="font-mono">{formatCOP(recibo.saldo)}</b>.
              </div>
            )}
          </div>

          {/* Historial (timeline real) */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <Activity className="size-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Historial</div>
            </div>
            <div className="timeline">
              {historial.map((h, i) => (
                <div className="tl-row" key={i}>
                  <span className={`tl-dot ${h.tone}`} />
                  <div>
                    <div className="tl-act">{h.act}</div>
                    <div className="tl-meta">{h.meta}</div>
                  </div>
                  {h.time && <span className="tl-time">{h.time}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Preview del PDF (sticky) — #17: ES el PDF real (mismo blob) ── */}
        <aside className="pdf-wrap lg:sticky lg:top-4">
          <header className="pdf-head">
            <div>
              <div className="pdf-eyebrow">Preview del PDF</div>
              <div className="pdf-title">#{recibo.numero} · Recibo de pago</div>
            </div>
          </header>
          <div className="pdf-stage">
            {reciboUrl ? (
              <iframe
                title={`Recibo de pago #${recibo.numero}`}
                src={reciboUrl}
                className="w-full rounded-lg border"
                style={{
                  height: 620,
                  borderColor: "var(--n-150)",
                  backgroundColor: "var(--n-0)",
                }}
              />
            ) : (
              <div
                className="px-4 py-10 text-center text-sm"
                style={{ color: "var(--n-500)" }}
              >
                Generando recibo…
              </div>
            )}
          </div>
        </aside>
      </div>

      <ConfirmDialog />
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function Kv({ label, value, mono, full }) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <div
        className="font-mono text-[10px] uppercase tracking-[0.08em]"
        style={{ color: "var(--n-300)" }}
      >
        {label}
      </div>
      <div
        className={"mt-1 text-[13px] font-medium" + (mono ? " font-mono" : "")}
        style={{ color: "var(--n-900)" }}
      >
        {value}
      </div>
    </div>
  );
}

function VincLink({ kind, num, estado }) {
  return (
    <div className="vinc-link">
      <span className="vlk">{kind}</span>
      <span className="vpill">{num}</span>
      <span className="vst">{estado}</span>
    </div>
  );
}
