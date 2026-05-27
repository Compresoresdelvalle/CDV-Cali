import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeftCircle,
  Truck,
  Package,
  Clock,
  FileText,
  Shield,
  Activity,
  PackageCheck,
  Check,
  Printer,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import {
  compraEstadoPill,
  garantiaEstadoPill,
  construirTimelineCompra,
} from "../../lib/compras-ui";
import ModalAbrirGarantiaCompra from "../../components/garantias/ModalAbrirGarantiaCompra";

/**
 * Detalle de una compra.
 *
 * Reproduce el diseño Lovable (`ops.compras.$id.tsx`): cabecera con eyebrow +
 * número + proveedor, barra de acciones, columna izquierda (proveedor, items,
 * fechas clave, notas) y columna derecha con timeline.
 *
 * RECONCILIACIÓN del flujo de RECEPCIÓN (Lovable `ops.compras.$id.recepcion.tsx`):
 *   El diseño Lovable modela recepción línea-a-línea (parcial / faltante /
 *   excedente). El backend REAL solo soporta recepción TOTAL vía el booleano
 *   `compras.recibida` (UPDATE condicional anti-doble-recepción). Por eso el
 *   panel de recepción eleva el lenguaje visual de Lovable (card con borde
 *   primario, barra de progreso, checklist de items) pero confirma la
 *   recepción de forma total y honesta, sin inventar parciales inexistentes.
 */
export default function CompraDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const puedeRecibir = perfil?.rol === "Admin" || perfil?.rol === "Bodeguero";

  const [compra, setCompra] = useState(null);
  const [items, setItems] = useState([]);
  const [garantias, setGarantias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalAbrir, setModalAbrir] = useState(false);
  const [recibiendo, setRecibiendo] = useState(false);
  const recibiendoRef = useRef(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [compraRes, detRes, garRes] = await Promise.all([
        supabase
          .from("compras")
          .select(
            `id, numero, fecha, fecha_recepcion, proveedor, factura_proveedor,
             observaciones, subtotal, iva, total, recibida, estado, sede_destino_id,
             registrador:registrado_por(nombre)`,
          )
          .eq("id", id)
          .single(),
        supabase
          .from("detalle_compra")
          .select(
            `id, cantidad, costo_unitario, subtotal, producto_id,
             producto:producto_id(nombre, referencia, codigo_interno, unidad_medida)`,
          )
          .eq("compra_id", id),
        supabase
          .from("garantias_compra")
          .select("id, numero, fecha, resolucion, estado, motivo")
          .eq("compra_id", id)
          .order("fecha", { ascending: false }),
      ]);
      // El error de la compra principal es bloqueante; los secundarios
      // (detalle/garantías) solo degradan la vista, no la tumban.
      if (compraRes.error) throw compraRes.error;
      setCompra(compraRes.data);
      setItems(detRes.data ?? []);
      setGarantias(garRes.data ?? []);
      if (detRes.error || garRes.error) {
        setError("Algunos datos no se pudieron cargar completamente.");
      }
    } catch (e) {
      setError(safeError(e, "Error al cargar la compra"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // ── Acción: confirmar recepción (total) ──────────────────────────
  // UPDATE condicional `.eq("recibida", false)`: si otra pestaña/usuario ya
  // la recibió, el segundo UPDATE no afecta filas ni re-dispara el trigger.
  const confirmarRecepcion = async () => {
    if (recibiendoRef.current) return;
    recibiendoRef.current = true;
    setError(null);
    setRecibiendo(true);
    try {
      const { data, error: e } = await supabase
        .from("compras")
        .update({ recibida: true, fecha_recepcion: new Date().toISOString() })
        .eq("id", id)
        .eq("recibida", false)
        .select("id");
      if (e) throw e;
      if (!data || data.length === 0) {
        setError("Esa compra ya estaba recibida.");
      }
      await cargar();
    } catch (e) {
      setError(safeError(e, "No se pudo confirmar la recepción"));
    } finally {
      setRecibiendo(false);
      recibiendoRef.current = false;
    }
  };

  if (loading) return <LoadingView />;
  if (!compra)
    return (
      <NotFoundView error={error} onBack={() => navigate("/ops/compras")} />
    );

  const puedeAbrirGarantia = compra.recibida === true;
  const pendienteRecepcion = !compra.recibida;
  const pill = compraEstadoPill(compra);
  const timeline = construirTimelineCompra(compra, garantias, formatDate);

  return (
    <div className="flex h-full flex-col gap-4 px-4 pb-14 pt-5 sm:px-7 animate-fade-in">
      <button
        onClick={() => navigate("/ops/compras")}
        className="back-btn inline-flex w-fit items-center gap-1.5"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver a Compras
      </button>

      {/* ── Cabecera ─────────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-start gap-5 border-b pb-4"
        style={{ borderColor: "var(--n-100)" }}
      >
        <div className="min-w-0 flex-1">
          <div className="ph-eyebrow">Compra</div>
          <div className="ph-num">#{compra.numero}</div>
          <div className="ph-client">{compra.proveedor}</div>
          <div className="ph-sub">
            {compra.recibida && compra.fecha_recepcion ? (
              <>
                Recibida el{" "}
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-700)" }}
                >
                  {formatDate(compra.fecha_recepcion)}
                </b>{" "}
                · {items.length} item{items.length === 1 ? "" : "s"} ingresados
                al inventario
              </>
            ) : (
              <>
                Registrada el{" "}
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-700)" }}
                >
                  {formatDate(compra.fecha)}
                </b>{" "}
                · pendiente de recepción
              </>
            )}
            {compra.registrador?.nombre && ` · ${compra.registrador.nombre}`}
          </div>
        </div>
        <div className="flex flex-col items-end gap-3">
          <span className={pill.cls} style={{ padding: "6px 14px" }}>
            <span className="dot" />
            {pill.label}
          </span>
          <div className="text-right">
            <div className="ph-total-lbl">Total</div>
            <div className="ph-total">{formatCOP(compra.total)}</div>
          </div>
        </div>
      </div>

      {/* ── Barra de acciones ────────────────────────────────────────── */}
      <div className="action-bar">
        <button
          onClick={() => window.print()}
          className="btn btn-out"
          style={{ height: 48 }}
        >
          <Printer className="h-3.5 w-3.5" strokeWidth={2} />
          Imprimir orden
        </button>
        {puedeAbrirGarantia && (
          <button
            onClick={() => setModalAbrir(true)}
            className="btn btn-out"
            style={{ height: 48, color: "var(--warn-700)" }}
          >
            <Shield className="h-3.5 w-3.5" strokeWidth={2} />
            Devolver por garantía
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-[10px] border px-4 py-3 text-sm"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
            color: "var(--dang-700)",
          }}
        >
          {error}
        </div>
      )}

      {/* ── Panel de recepción (solo si pendiente) ───────────────────── */}
      {pendienteRecepcion && (
        <PanelRecepcion
          items={items}
          puedeRecibir={puedeRecibir}
          recibiendo={recibiendo}
          onConfirmar={confirmarRecepcion}
        />
      )}

      {/* ── Layout: contenido + timeline ─────────────────────────────── */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_360px]">
        {/* Columna izquierda */}
        <div className="flex flex-col gap-3">
          {/* Proveedor */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <Truck className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Proveedor</div>
            </div>
            <div className="grid grid-cols-1 gap-3 gap-x-3.5 sm:grid-cols-2">
              <Fact lk="Razón social" v={compra.proveedor} full />
              <Fact lk="Factura" v={compra.factura_proveedor ?? "—"} mono />
              <Fact lk="Sede destino" v={compra.sede_destino_id ?? "—"} mono />
            </div>
          </div>

          {/* Items */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <Package className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">
                {compra.recibida ? "Items recibidos" : "Items ordenados"}
              </div>
              <div className="ib-aux">
                {items.length} item{items.length === 1 ? "" : "s"}
                {compra.recibida ? " · 100% recibidos" : ""}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="prod-tbl w-full">
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id}>
                      <td style={{ width: 150 }}>
                        <span className="p-sku">
                          {it.producto?.codigo_interno ??
                            it.producto?.referencia ??
                            "—"}
                        </span>
                        <div className="p-meta">
                          {it.producto?.unidad_medida ?? ""}
                        </div>
                      </td>
                      <td>
                        <div className="p-nm">{it.producto?.nombre}</div>
                      </td>
                      <td
                        className="r font-mono text-[13px]"
                        style={{ color: "var(--n-700)" }}
                      >
                        {it.cantidad} × {formatCOP(it.costo_unitario)}
                      </td>
                      <td
                        className="r font-mono text-[13px] font-medium"
                        style={{ color: "var(--n-950)" }}
                      >
                        {formatCOP(it.subtotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="totals">
              <div className="ln">
                <span>Subtotal</span>
                <span className="v">{formatCOP(compra.subtotal)}</span>
              </div>
              <div className="ln">
                <span>IVA</span>
                <span className="v">{formatCOP(compra.iva)}</span>
              </div>
              <div className="ln tot">
                <span>Total</span>
                <span className="v">{formatCOP(compra.total)}</span>
              </div>
            </div>
          </div>

          {/* Notas */}
          {compra.observaciones && (
            <div className="iblock">
              <div className="ib-head">
                <div className="ib-ico">
                  <FileText className="h-3.5 w-3.5" strokeWidth={2} />
                </div>
                <div className="ib-title">Observaciones</div>
              </div>
              <div
                className="rounded-lg border px-3.5 py-3 text-[12.5px] leading-[1.55]"
                style={{
                  borderColor: "var(--n-100)",
                  backgroundColor: "var(--n-50)",
                  color: "var(--n-700)",
                }}
              >
                {compra.observaciones}
              </div>
            </div>
          )}

          {/* Fechas clave */}
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <Clock className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Fechas clave</div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <FactBox lk="Orden registrada" v={formatDate(compra.fecha)} />
              <FactBox
                lk="Recepción"
                v={
                  compra.fecha_recepcion
                    ? formatDate(compra.fecha_recepcion)
                    : "Pendiente"
                }
                tone={compra.fecha_recepcion ? "succ" : undefined}
              />
            </div>
          </div>
        </div>

        {/* Columna derecha · timeline + garantías */}
        <div className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
          <div className="iblock">
            <div className="ib-head">
              <div className="ib-ico">
                <Activity className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Timeline</div>
            </div>
            <div className="timeline">
              {timeline.map((t, i) => (
                <div className="tl-row" key={i}>
                  <span className={`tl-dot ${t.tone}`} />
                  <div>
                    <div className="tl-act">{t.act}</div>
                    <div className="tl-meta">{t.meta}</div>
                  </div>
                  {t.time && <span className="tl-time">{t.time}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Garantías — solo sobre compras ya recibidas */}
          {puedeAbrirGarantia && (
            <div className="iblock">
              <div className="ib-head">
                <div className="ib-ico">
                  <Shield className="h-3.5 w-3.5" strokeWidth={2} />
                </div>
                <div className="ib-title">Garantías</div>
              </div>
              <p
                className="mb-3 text-[12px] leading-[1.5]"
                style={{ color: "var(--n-500)" }}
              >
                ¿Algún item llegó defectuoso? Abre una garantía para devolverlo
                al proveedor.
              </p>
              <button
                onClick={() => setModalAbrir(true)}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border text-[13px] font-medium"
                style={{
                  minHeight: 48,
                  borderColor: "var(--warn-border)",
                  backgroundColor: "var(--n-0)",
                  color: "var(--warn-700)",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = "var(--warn-50)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "var(--n-0)")
                }
              >
                <Shield className="h-3.5 w-3.5" strokeWidth={1.7} />
                Devolver al proveedor por garantía
              </button>

              {garantias.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {garantias.map((g) => {
                    const gPill = garantiaEstadoPill(g.estado);
                    return (
                      <li
                        key={g.id}
                        onClick={() =>
                          navigate(`/ops/garantias/compra/${g.id}`)
                        }
                        className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs transition-colors"
                        style={{
                          backgroundColor: "var(--n-0)",
                          borderColor: "var(--n-150)",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor =
                            "var(--n-50)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.backgroundColor = "var(--n-0)")
                        }
                      >
                        <span style={{ color: "var(--n-700)" }}>
                          <strong
                            className="font-mono"
                            style={{ color: "var(--p-700)" }}
                          >
                            #{g.numero}
                          </strong>{" "}
                          · {g.resolucion} · {formatDate(g.fecha)}
                        </span>
                        <span className={gPill.cls}>
                          <span className="dot" />
                          {g.estado}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {modalAbrir && (
        <ModalAbrirGarantiaCompra
          compra={compra}
          items={items}
          onClose={() => setModalAbrir(false)}
          onCreated={(garantiaId) => {
            // Navegamos directo al detalle de la garantía; no recargamos
            // esta vista (evita setState sobre componente desmontado).
            setModalAbrir(false);
            navigate(`/ops/garantias/compra/${garantiaId}`);
          }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

/**
 * Panel de recepción — eleva el lenguaje visual de la pantalla de recepción
 * de Lovable (card con borde primario, header con gradiente, checklist de
 * items y barra de progreso) a la recepción TOTAL real del backend.
 *
 * NOTA: el backend NO soporta recepción parcial/excedente/faltante por línea;
 * la confirmación marca la compra entera como recibida y suma el stock. Los
 * items se listan como referencia visual (no editables), reflejando esto
 * honestamente.
 */
function PanelRecepcion({ items, puedeRecibir, recibiendo, onConfirmar }) {
  const totalItems = items.length;
  return (
    <div
      className="flex flex-col overflow-hidden rounded-[14px] border-2"
      style={{
        borderColor: "var(--p-cta)",
        backgroundColor: "var(--n-0)",
        boxShadow: "0 4px 12px rgba(45,60,229,.10)",
      }}
    >
      <header
        className="flex items-center gap-3 border-b px-5 py-4"
        style={{
          borderColor: "var(--n-100)",
          background: "linear-gradient(180deg,var(--prog-50),transparent)",
        }}
      >
        <div
          className="grid h-9 w-9 place-items-center rounded-[9px] text-white"
          style={{ backgroundColor: "var(--p-cta)" }}
        >
          <PackageCheck className="h-4 w-4" strokeWidth={2} />
        </div>
        <div className="flex-1">
          <div
            className="text-[14px] font-semibold"
            style={{ color: "var(--n-950)" }}
          >
            Recepción de mercancía
          </div>
          <div
            className="mt-0.5 text-[12px] leading-[1.4]"
            style={{ color: "var(--n-500)" }}
          >
            Verifica los {totalItems} item{totalItems === 1 ? "" : "s"} contra
            la orden y confirma la recepción. El stock se sumará al inventario.
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-3 px-5 py-4">
        {/* Progreso (0% hasta confirmar — recepción total) */}
        <div className="flex flex-col gap-1.5">
          <div
            className="flex items-center justify-between font-mono text-[11.5px]"
            style={{ color: "var(--n-500)" }}
          >
            <span>0 de {totalItems} confirmados</span>
            <span>0%</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full"
            style={{ backgroundColor: "var(--n-100)" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{ width: "0%", backgroundColor: "var(--p-cta)" }}
            />
          </div>
        </div>

        {/* Checklist de items (referencia visual, no editable) */}
        <ul
          className="flex flex-col rounded-lg border"
          style={{ borderColor: "var(--n-150)" }}
        >
          {items.map((it, i) => (
            <li
              key={it.id}
              className="flex items-center gap-3 px-3.5 py-2.5"
              style={{
                borderTop: i === 0 ? "none" : "1px solid var(--n-75)",
              }}
            >
              <span
                className="inline-flex h-[18px] w-[18px] items-center justify-center rounded border-[1.5px]"
                style={{
                  borderColor: "var(--n-300)",
                  color: "transparent",
                }}
              >
                <Check className="h-[11px] w-[11px]" strokeWidth={3} />
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className="truncate text-[12.5px] font-medium leading-tight"
                  style={{ color: "var(--n-950)" }}
                >
                  {it.producto?.nombre ?? "—"}
                </div>
                <div
                  className="font-mono text-[11px]"
                  style={{ color: "var(--n-500)" }}
                >
                  {it.producto?.codigo_interno ??
                    it.producto?.referencia ??
                    "—"}
                </div>
              </div>
              <span
                className="font-mono text-[13px] font-medium"
                style={{ color: "var(--n-700)" }}
              >
                ×{it.cantidad}
              </span>
            </li>
          ))}
        </ul>

        {puedeRecibir ? (
          <button
            onClick={onConfirmar}
            disabled={recibiendo || totalItems === 0}
            className="inline-flex items-center justify-center gap-1.5 rounded-[10px] text-[13.5px] font-medium text-white transition-opacity disabled:opacity-40"
            style={{ height: 48, backgroundColor: "var(--p-cta)" }}
            onMouseEnter={(e) => {
              if (!recibiendo) e.currentTarget.style.opacity = "0.9";
            }}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
            {recibiendo ? "Confirmando…" : "Confirmar recepción"}
          </button>
        ) : (
          <p
            className="text-center text-[12.5px]"
            style={{ color: "var(--n-400)" }}
          >
            Solo Admin o Bodeguero pueden confirmar la recepción.
          </p>
        )}
      </div>
    </div>
  );
}

function Fact({ lk, v, mono, full }) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <div
        className="mb-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--n-300)" }}
      >
        {lk}
      </div>
      <div
        className={"text-[13px] font-medium " + (mono ? "font-mono" : "")}
        style={{ color: "var(--n-950)" }}
      >
        {v}
      </div>
    </div>
  );
}

function FactBox({ lk, v, tone }) {
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border p-3"
      style={{ borderColor: "var(--n-100)", backgroundColor: "var(--n-50)" }}
    >
      <span
        className="font-mono text-[10px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--n-500)" }}
      >
        {lk}
      </span>
      <span
        className="font-mono text-[13.5px] font-medium"
        style={{ color: tone === "succ" ? "var(--succ-700)" : "var(--n-950)" }}
      >
        {v}
      </span>
    </div>
  );
}

function LoadingView() {
  return (
    <div className="flex flex-col gap-4 px-4 pb-14 pt-5 sm:px-7">
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-[10px]"
          style={{ backgroundColor: "var(--n-100)" }}
        />
      ))}
    </div>
  );
}

function NotFoundView({ error, onBack }) {
  return (
    <div className="flex flex-col gap-3 px-4 pb-14 pt-5 sm:px-7">
      <p style={{ color: "var(--dang-700)" }}>
        {error ?? "Compra no encontrada"}
      </p>
      <button
        onClick={onBack}
        className="back-btn inline-flex w-fit items-center gap-1.5"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver a Compras
      </button>
    </div>
  );
}
