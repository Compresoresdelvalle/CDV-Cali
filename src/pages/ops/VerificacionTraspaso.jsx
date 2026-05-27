import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeftCircle,
  CheckCircle2,
  AlertTriangle,
  Check,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { safeError } from "../../lib/utils";
import { sedeLabel } from "../../lib/traspasos-ui";

export default function VerificacionTraspaso() {
  const { id } = useParams();
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [traspaso, setTraspaso] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState(null);

  const esAdmin = perfil?.rol === "Admin";
  const esBodeguero = perfil?.rol === "Bodeguero";

  const verificandoRef = useRef(false);

  /* ── Cargar datos ─────────────────────────────────────────── */
  useEffect(() => {
    const cargar = async () => {
      setLoading(true);
      try {
        const [{ data: t, error: errT }, { data: d, error: errD }] =
          await Promise.all([
            supabase
              .from("traspasos")
              .select(
                `id, numero, estado, picker_id, sede_origen_id, sede_destino_id,
                 picker:picker_id(nombre)`,
              )
              .eq("id", id)
              .single(),
            supabase
              .from("detalle_traspaso")
              .select(
                `id, cantidad_solicitada, cantidad_enviada, picking_completado,
                 producto:producto_id(nombre, referencia, unidad_medida),
                 ubicacion:ubicacion_origen_id(pasillo, estante, nivel)`,
              )
              .eq("traspaso_id", id)
              .order("created_at"),
          ]);

        if (errT || !t) throw new Error("Traspaso no encontrado");
        if (errD) throw new Error(errD.message);

        // Solo Admin o Bodeguero que NO sea el picker puede verificar
        if (!esAdmin && !esBodeguero) {
          navigate(`/ops/traspasos/${id}`, { replace: true });
          return;
        }
        if (t.picker_id === perfil?.id && !esAdmin) {
          navigate(`/ops/traspasos/${id}`, { replace: true });
          return;
        }
        // Solo se verifica un traspaso En Picking.
        if (t.estado !== "picking") {
          navigate(`/ops/traspasos/${id}`, { replace: true });
          return;
        }

        setTraspaso(t);
        setItems(d ?? []);
      } catch (e) {
        setError(safeError(e, "Error en verificación de traspaso"));
      } finally {
        setLoading(false);
      }
    };

    cargar();
    // Deps primitivas: depender del objeto `perfil` re-disparaba el fetch.
  }, [id, perfil?.id, esAdmin, esBodeguero, navigate]);

  /* ── Acción: verificar ────────────────────────────────────── */
  const verificar = async () => {
    if (verificandoRef.current) return;
    verificandoRef.current = true;
    setVerificando(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc("fn_procesar_traspaso", {
        p_traspaso_id: id,
        p_accion: "verificar",
        p_items: null,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      navigate(`/ops/traspasos/${id}`);
    } catch (e) {
      setError(safeError(e, "Error en verificación de traspaso"));
    } finally {
      setVerificando(false);
      verificandoRef.current = false;
    }
  };

  if (loading) return <LoadingView />;
  if (!traspaso)
    return <NotFoundView onBack={() => navigate(`/ops/traspasos/${id}`)} />;

  // Validación frontend: todos los items deben estar pickeados
  const totalItems = items.length;
  const itemsCompletos = items.filter((i) => i.picking_completado).length;
  const pickingOk = totalItems > 0 && itemsCompletos === totalItems;
  const esMiPropioPicking =
    !!traspaso.picker_id && traspaso.picker_id === perfil?.id;

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-4 py-5 pb-36 sm:px-7 sm:py-6 animate-fade-in">
      <button
        onClick={() => navigate(`/ops/traspasos/${id}`)}
        className="back-btn inline-flex items-center gap-1.5"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver al traspaso
      </button>

      {/* ── Cabecera ────────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-end justify-between gap-3 border-b pb-4"
        style={{ borderColor: "var(--n-100)" }}
      >
        <div>
          <p
            className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em]"
            style={{ color: "var(--n-300)" }}
          >
            Verificación de picking
          </p>
          <h1
            className="font-mono text-[28px] font-medium leading-none tracking-[-0.01em]"
            style={{ color: "var(--n-950)" }}
          >
            #{traspaso.numero}
          </h1>
          <p className="mt-2 text-[13px]" style={{ color: "var(--n-500)" }}>
            {sedeLabel(traspaso.sede_origen_id)} →{" "}
            {sedeLabel(traspaso.sede_destino_id)}
          </p>
        </div>
        <span
          className="font-mono text-[12px]"
          style={{ color: "var(--n-500)" }}
        >
          {itemsCompletos}/{totalItems} pickeados
        </span>
      </div>

      {/* Banner de contexto */}
      <div
        className="flex items-start gap-3 rounded-[10px] border p-4"
        style={{
          backgroundColor: "var(--info-50)",
          borderColor: "var(--info-border)",
        }}
      >
        <CheckCircle2
          className="mt-0.5 h-[18px] w-[18px] shrink-0"
          strokeWidth={1.7}
          style={{ color: "var(--info-700)" }}
        />
        <div>
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--n-950)" }}
          >
            Verificación de picking
          </p>
          <p
            className="mt-0.5 text-xs leading-[1.5]"
            style={{ color: "var(--n-500)" }}
          >
            Pickeado por <strong>{traspaso.picker?.nombre ?? "—"}</strong>.
            Revisa las cantidades y confirma si todo está correcto.
          </p>
        </div>
      </div>

      {/* Picking incompleto */}
      {!pickingOk && (
        <div
          className="flex items-start gap-3 rounded-[10px] border p-3.5 text-sm"
          style={{
            backgroundColor: "var(--warn-50)",
            borderColor: "var(--warn-border)",
            color: "var(--warn-700)",
          }}
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0"
            strokeWidth={1.7}
          />
          El picking no está completo ({itemsCompletos}/{totalItems} items). El
          picker debe terminar antes de verificar.
        </div>
      )}

      {error && (
        <div
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

      {/* Desktop: tabla */}
      <div
        className="hidden overflow-hidden rounded-[10px] border md:block"
        style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
      >
        <div className="overflow-x-auto">
          <table className="prod-tbl w-full">
            <thead>
              <tr>
                <th>Producto</th>
                <th style={{ width: 130 }}>Ubicación</th>
                <th className="r" style={{ width: 100 }}>
                  Solicitado
                </th>
                <th className="r" style={{ width: 110 }}>
                  Enviado
                </th>
                <th style={{ width: 130 }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const loc = item.ubicacion;
                const ubicCode = loc
                  ? `${loc.pasillo}-${loc.estante}-${loc.nivel}`
                  : "—";
                const diff =
                  (item.cantidad_enviada ?? 0) - item.cantidad_solicitada;
                return (
                  <tr
                    key={item.id}
                    style={{
                      backgroundColor: item.picking_completado
                        ? "transparent"
                        : "var(--warn-50)",
                    }}
                  >
                    <td>
                      <p
                        className="text-[12.5px] font-medium leading-tight"
                        style={{ color: "var(--n-950)" }}
                      >
                        {item.producto?.nombre ?? "—"}
                      </p>
                      <p
                        className="font-mono text-[11px]"
                        style={{ color: "var(--n-500)" }}
                      >
                        {item.producto?.referencia ?? "—"}
                      </p>
                    </td>
                    <td>
                      <span
                        className="font-mono text-[11px] font-semibold"
                        style={{ color: "var(--p-700)" }}
                      >
                        {ubicCode}
                      </span>
                    </td>
                    <td className="r">
                      <span
                        className="font-mono text-[13px]"
                        style={{ color: "var(--n-700)" }}
                      >
                        {item.cantidad_solicitada}
                      </span>
                    </td>
                    <td className="r">
                      <span
                        className="font-mono text-[13px] font-semibold"
                        style={{
                          color:
                            diff !== 0 ? "var(--warn-700)" : "var(--n-950)",
                        }}
                      >
                        {item.cantidad_enviada ?? "—"}
                        {diff !== 0 && item.cantidad_enviada != null && (
                          <span>
                            {" "}
                            ({diff > 0 ? "+" : ""}
                            {diff})
                          </span>
                        )}
                      </span>
                    </td>
                    <td>
                      <EstadoPicking ok={item.picking_completado} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile: cards */}
      <ul className="md:hidden space-y-2.5" role="list">
        {items.map((item) => {
          const loc = item.ubicacion;
          const ubicCode = loc
            ? `${loc.pasillo}-${loc.estante}-${loc.nivel}`
            : null;
          const diff =
            item.cantidad_enviada != null
              ? item.cantidad_enviada - item.cantidad_solicitada
              : null;
          return (
            <li key={item.id}>
              <div
                className="rounded-[10px] border px-4 py-3.5"
                style={{
                  backgroundColor: item.picking_completado
                    ? "var(--n-0)"
                    : "var(--warn-50)",
                  borderColor: item.picking_completado
                    ? "var(--n-150)"
                    : "var(--warn-border)",
                }}
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <p
                    className="min-w-0 flex-1 text-sm font-medium"
                    style={{ color: "var(--n-950)" }}
                  >
                    {item.producto?.nombre ?? "—"}
                  </p>
                  <EstadoPicking ok={item.picking_completado} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="font-mono text-[11px]"
                    style={{ color: "var(--n-500)" }}
                  >
                    {item.producto?.referencia}
                  </span>
                  {ubicCode && (
                    <span
                      className="font-mono text-[11px] font-semibold"
                      style={{ color: "var(--p-700)" }}
                    >
                      {ubicCode}
                    </span>
                  )}
                </div>
                <div
                  className="mt-2 flex items-center gap-4 font-mono text-[12px]"
                  style={{ color: "var(--n-500)" }}
                >
                  <span>
                    Sol.{" "}
                    <strong style={{ color: "var(--n-950)" }}>
                      {item.cantidad_solicitada}
                    </strong>
                  </span>
                  <span>
                    Env.{" "}
                    <strong
                      style={{
                        color:
                          diff !== null && diff !== 0
                            ? "var(--warn-700)"
                            : "var(--n-950)",
                      }}
                    >
                      {item.cantidad_enviada ?? "—"}
                    </strong>
                    {diff !== null && diff !== 0 && (
                      <span style={{ color: "var(--warn-700)" }}>
                        {" "}
                        ({diff > 0 ? "+" : ""}
                        {diff})
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Barra de acción fija */}
      <div
        className="fixed bottom-0 left-0 right-0 border-t p-4"
        style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
      >
        <div className="mx-auto max-w-xl space-y-2">
          <p
            className="text-center text-xs"
            style={{ color: pickingOk ? "var(--n-500)" : "var(--warn-700)" }}
          >
            {pickingOk
              ? "Todos los items fueron pickeados. Al verificar, el traspaso pasará a Verificado."
              : "El picking no está completo. No es posible verificar aún."}
          </p>
          <button
            onClick={verificar}
            disabled={!pickingOk || verificando || esMiPropioPicking}
            title={
              esMiPropioPicking
                ? "No puedes verificar tu propio picking"
                : undefined
            }
            className="flex w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-40"
            style={{ height: 48, backgroundColor: "var(--p-600)" }}
            onMouseEnter={(e) => {
              if (pickingOk && !verificando && !esMiPropioPicking)
                e.currentTarget.style.opacity = "0.9";
            }}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            <Check className="h-4 w-4" strokeWidth={2.5} />
            {verificando ? "Verificando…" : "Confirmar verificación"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function EstadoPicking({ ok }) {
  return (
    <span className={"pill shrink-0 " + (ok ? "pill-success" : "pill-warn")}>
      <span className="dot" />
      {ok ? "Pickeado" : "Pendiente"}
    </span>
  );
}

function LoadingView() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-5 sm:px-7 sm:py-6">
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-[10px]"
            style={{ backgroundColor: "var(--n-100)" }}
          />
        ))}
      </div>
    </div>
  );
}

function NotFoundView({ onBack }) {
  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-3 px-4 py-5 sm:px-7 sm:py-6">
      <p style={{ color: "var(--dang-700)" }}>Traspaso no encontrado</p>
      <button
        onClick={onBack}
        className="back-btn inline-flex items-center gap-1.5"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver
      </button>
    </div>
  );
}
