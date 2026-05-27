import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeftCircle,
  PackageCheck,
  AlertTriangle,
  Check,
  TriangleAlert,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { safeError } from "../../lib/utils";
import { sedeLabel } from "../../lib/traspasos-ui";

export default function RecepcionTraspaso() {
  const { id } = useParams();
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [traspaso, setTraspaso] = useState(null);
  const [items, setItems] = useState([]);
  const [recibidas, setRecibidas] = useState({});
  const [loading, setLoading] = useState(true);
  const [recibiendo, setRecibiendo] = useState(false);
  const [error, setError] = useState(null);
  const [confirmarDiff, setConfirmarDiff] = useState(false);

  const esAdmin = perfil?.rol === "Admin";

  const recibiendoRef = useRef(false);

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
                `id, numero, estado, sede_origen_id, sede_destino_id,
                 picker:picker_id(nombre), verificador:verificado_por(nombre)`,
              )
              .eq("id", id)
              .single(),
            supabase
              .from("detalle_traspaso")
              .select(
                `id, cantidad_solicitada, cantidad_enviada,
                 producto:producto_id(nombre, referencia, unidad_medida)`,
              )
              .eq("traspaso_id", id)
              .order("created_at"),
          ]);

        if (errT || !t) throw new Error("Traspaso no encontrado");
        if (errD) throw new Error(errD.message);

        // Solo Admin o usuario de sede destino puede recibir
        if (!esAdmin && perfil?.sede_id !== t.sede_destino_id) {
          navigate(`/ops/traspasos/${id}`, { replace: true });
          return;
        }
        // Solo se recibe un traspaso En Tránsito.
        if (t.estado !== "en_transito") {
          navigate(`/ops/traspasos/${id}`, { replace: true });
          return;
        }

        setTraspaso(t);
        setItems(d ?? []);

        // Inicializar cantidades recibidas = cantidades enviadas
        const init = {};
        for (const item of d ?? []) {
          init[item.id] =
            item.cantidad_enviada ?? item.cantidad_solicitada ?? 1;
        }
        setRecibidas(init);
      } catch (e) {
        setError(safeError(e, "Error en recepción de traspaso"));
      } finally {
        setLoading(false);
      }
    };

    cargar();
    // Deps primitivas: depender del objeto `perfil` re-disparaba el fetch.
  }, [id, perfil?.id, perfil?.sede_id, esAdmin, navigate]);

  /* ── Calcular diferencias ─────────────────────────────────── */
  const hayDiferencias = items.some((item) => {
    const recv = recibidas[item.id] ?? 0;
    return recv !== (item.cantidad_enviada ?? 0);
  });

  const totalDiff = items.reduce((acc, item) => {
    const recv = recibidas[item.id] ?? 0;
    const env = item.cantidad_enviada ?? 0;
    return acc + Math.abs(recv - env);
  }, 0);

  const completos = items.filter((item) => {
    const recv = recibidas[item.id] ?? 0;
    return recv === (item.cantidad_enviada ?? 0);
  }).length;
  const conDiferencia = items.length - completos;

  /* ── Acción: recibir ──────────────────────────────────────── */
  const confirmarRecepcion = async () => {
    if (recibiendoRef.current) return;
    recibiendoRef.current = true;
    setRecibiendo(true);
    setError(null);
    try {
      const p_items = items.map((item) => ({
        detalle_id: item.id,
        cantidad_recibida: recibidas[item.id] ?? item.cantidad_enviada ?? 0,
      }));

      const { error: rpcErr } = await supabase.rpc("fn_procesar_traspaso", {
        p_traspaso_id: id,
        p_accion: "recibir",
        p_items,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      navigate(`/ops/traspasos/${id}`);
    } catch (e) {
      setError(safeError(e, "Error en recepción de traspaso"));
      setConfirmarDiff(false);
    } finally {
      setRecibiendo(false);
      recibiendoRef.current = false;
    }
  };

  const handleSubmit = () => {
    if (hayDiferencias) {
      setConfirmarDiff(true);
    } else {
      confirmarRecepcion();
    }
  };

  const setCantidad = (itemId, value) => {
    // Cap entre 0 y cantidad_enviada (no se puede recibir más de lo enviado)
    const item = items?.find((it) => it.id === itemId);
    const max = item?.cantidad_enviada ?? item?.cantidad_solicitada ?? Infinity;
    const num = Math.min(max, Math.max(0, parseInt(value, 10) || 0));
    setRecibidas((prev) => ({ ...prev, [itemId]: num }));
  };

  if (loading) return <LoadingView />;
  if (!traspaso)
    return <NotFoundView onBack={() => navigate(`/ops/traspasos/${id}`)} />;

  const recibidosTotal = items.length;
  const pct =
    recibidosTotal > 0 ? Math.round((completos / recibidosTotal) * 100) : 0;

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-4 py-5 pb-40 sm:px-7 sm:py-6 animate-fade-in">
      <button
        onClick={() => navigate(`/ops/traspasos/${id}`)}
        className="back-btn inline-flex items-center gap-1.5"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver al traspaso
      </button>

      {/* ── Cabecera ────────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-end justify-between gap-4 border-b pb-4"
        style={{ borderColor: "var(--n-100)" }}
      >
        <div>
          <p
            className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em]"
            style={{ color: "var(--n-300)" }}
          >
            Recepción de traspaso
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
        <div className="flex min-w-[220px] flex-col items-end gap-1.5">
          <span
            className="font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--n-500)" }}
          >
            Sin diferencia
          </span>
          <div
            className="font-mono text-[22px] font-medium"
            style={{ color: "var(--n-950)" }}
          >
            <strong style={{ color: "var(--succ-700)" }}>{completos}</strong> /{" "}
            {recibidosTotal} items
          </div>
          <div
            className="h-1.5 w-[220px] overflow-hidden rounded-full"
            style={{ backgroundColor: "var(--n-100)" }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, backgroundColor: "var(--succ-500)" }}
            />
          </div>
        </div>
      </div>

      {/* Banner de contexto */}
      <div
        className="flex items-start gap-3 rounded-[10px] border p-4"
        style={{
          backgroundColor: "var(--succ-50)",
          borderColor: "var(--succ-border)",
        }}
      >
        <PackageCheck
          className="mt-0.5 h-[18px] w-[18px] shrink-0"
          strokeWidth={1.7}
          style={{ color: "var(--succ-700)" }}
        />
        <div>
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--n-950)" }}
          >
            Confirmar cantidades recibidas
          </p>
          <p
            className="mt-0.5 text-xs leading-[1.5]"
            style={{ color: "var(--n-500)" }}
          >
            Ingresa las cantidades realmente recibidas. Si difieren de lo
            enviado, el traspaso quedará marcado como{" "}
            <strong>Con Diferencia</strong>.
          </p>
        </div>
      </div>

      {/* Alerta de diferencias detectadas */}
      {hayDiferencias && (
        <div
          className="flex items-start gap-3 rounded-[10px] border p-3.5"
          style={{
            backgroundColor: "var(--warn-50)",
            borderColor: "var(--warn-border)",
          }}
        >
          <AlertTriangle
            className="mt-0.5 h-[18px] w-[18px] shrink-0"
            strokeWidth={1.7}
            style={{ color: "var(--warn-600)" }}
          />
          <div>
            <p
              className="text-sm font-semibold"
              style={{ color: "var(--warn-700)" }}
            >
              Se detectaron diferencias
            </p>
            <p className="mt-0.5 text-xs" style={{ color: "var(--n-500)" }}>
              {totalDiff} unidad{totalDiff !== 1 ? "es" : ""} con diferencia
              respecto a lo enviado · {conDiferencia} item
              {conDiferencia !== 1 ? "s" : ""} afectado
              {conDiferencia !== 1 ? "s" : ""}.
            </p>
          </div>
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

      {/* Lista de items con inputs */}
      <div className="space-y-2">
        {items.map((item) => {
          const enviado = item.cantidad_enviada ?? 0;
          const recibido = recibidas[item.id] ?? enviado;
          const diff = recibido - enviado;
          const hasDiff = diff !== 0;
          return (
            <div
              key={item.id}
              className="rounded-[10px] border p-4 transition-colors"
              style={{
                backgroundColor: hasDiff ? "var(--dang-50)" : "var(--n-0)",
                borderColor: hasDiff ? "var(--dang-border)" : "var(--n-150)",
              }}
            >
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-semibold"
                    style={{ color: "var(--n-950)" }}
                  >
                    {item.producto?.nombre ?? "—"}
                  </p>
                  <p
                    className="mt-0.5 font-mono text-[11px]"
                    style={{ color: "var(--n-500)" }}
                  >
                    {item.producto?.referencia}
                  </p>
                </div>

                {/* Enviado (referencia) */}
                <div className="hidden shrink-0 text-center sm:block">
                  <p
                    className="font-mono text-[10px] uppercase tracking-[0.08em]"
                    style={{ color: "var(--n-400)" }}
                  >
                    Enviado
                  </p>
                  <p
                    className="mt-0.5 font-mono text-sm font-semibold"
                    style={{ color: "var(--n-950)" }}
                  >
                    {enviado}
                  </p>
                </div>

                {/* Cantidad recibida */}
                <div className="flex shrink-0 flex-col items-center gap-1">
                  <p
                    className="font-mono text-[10px] uppercase tracking-[0.08em]"
                    style={{ color: "var(--p-700)" }}
                  >
                    Recibido
                  </p>
                  <div className="flex items-center gap-1.5">
                    <QtyBtn onClick={() => setCantidad(item.id, recibido - 1)}>
                      −
                    </QtyBtn>
                    <input
                      type="number"
                      value={recibido}
                      onChange={(e) => setCantidad(item.id, e.target.value)}
                      min={0}
                      className="rounded-lg border text-center font-mono text-sm font-bold outline-none"
                      style={{
                        width: 56,
                        height: 40,
                        borderColor: hasDiff
                          ? "var(--dang-border)"
                          : "var(--n-150)",
                        backgroundColor: "var(--n-0)",
                        color: hasDiff ? "var(--dang-700)" : "var(--n-950)",
                      }}
                    />
                    <QtyBtn onClick={() => setCantidad(item.id, recibido + 1)}>
                      +
                    </QtyBtn>
                  </div>
                </div>
              </div>

              {/* Enviado (mobile) + diferencia */}
              <div className="mt-2 flex flex-wrap items-center gap-4">
                <span
                  className="font-mono text-[12px] sm:hidden"
                  style={{ color: "var(--n-500)" }}
                >
                  Enviado:{" "}
                  <strong style={{ color: "var(--n-950)" }}>{enviado}</strong>
                  {item.producto?.unidad_medida &&
                    ` ${item.producto.unidad_medida}`}
                </span>
                {hasDiff ? (
                  <span
                    className="font-mono text-[12px] font-semibold"
                    style={{ color: "var(--dang-700)" }}
                  >
                    Diferencia: {diff > 0 ? "+" : ""}
                    {diff} unidades
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 text-[12px]"
                    style={{ color: "var(--succ-700)" }}
                  >
                    <Check className="h-3 w-3" strokeWidth={2.5} />
                    Sin diferencia
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal de confirmación con diferencias */}
      {confirmarDiff && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <div
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
            onClick={() => setConfirmarDiff(false)}
          />
          <div
            className="relative w-full max-w-md rounded-2xl p-6 shadow-xl"
            style={{
              backgroundColor: "var(--n-0)",
              borderTop: "4px solid var(--dang-500)",
            }}
          >
            <div className="mb-2 flex items-center gap-2">
              <TriangleAlert
                className="h-5 w-5 shrink-0"
                strokeWidth={1.8}
                style={{ color: "var(--dang-600)" }}
              />
              <p
                className="text-base font-bold"
                style={{ color: "var(--n-950)" }}
              >
                Confirmar recepción con diferencias
              </p>
            </div>
            <p
              className="mb-4 text-sm leading-[1.5]"
              style={{ color: "var(--n-500)" }}
            >
              Las cantidades recibidas no coinciden con las enviadas. El
              traspaso quedará marcado como <strong>Con Diferencia</strong> y
              las diferencias quedarán registradas en auditoría.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmarDiff(false)}
                className="btn btn-out flex-1 justify-center"
                style={{ height: 48 }}
              >
                Revisar
              </button>
              <button
                onClick={confirmarRecepcion}
                disabled={recibiendo}
                className="flex flex-1 items-center justify-center rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                style={{ height: 48, backgroundColor: "var(--dang-600)" }}
              >
                {recibiendo ? "Guardando…" : "Confirmar de todas formas"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barra de acción fija */}
      <div
        className="fixed bottom-0 left-0 right-0 border-t p-4"
        style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
      >
        <div className="mx-auto max-w-xl">
          <button
            onClick={handleSubmit}
            disabled={recibiendo}
            className="flex w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
            style={{
              height: 48,
              backgroundColor: hayDiferencias
                ? "var(--warn-600)"
                : "var(--succ-600)",
            }}
            onMouseEnter={(e) => {
              if (!recibiendo) e.currentTarget.style.opacity = "0.9";
            }}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            {hayDiferencias ? (
              <TriangleAlert className="h-4 w-4" strokeWidth={1.8} />
            ) : (
              <Check className="h-4 w-4" strokeWidth={2.5} />
            )}
            {recibiendo
              ? "Registrando…"
              : hayDiferencias
                ? "Confirmar recepción con diferencias"
                : "Confirmar recepción"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function QtyBtn({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center rounded-lg border font-bold"
      style={{
        width: 40,
        height: 40,
        fontSize: 18,
        borderColor: "var(--n-150)",
        backgroundColor: "var(--n-50)",
        color: "var(--n-700)",
      }}
    >
      {children}
    </button>
  );
}

function LoadingView() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-5 sm:px-7 sm:py-6">
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-[10px]"
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
