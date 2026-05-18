import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";

const SEDE_LABELS = {
  "BOD-PRINCIPAL": "Bodega Principal",
  "ALM-01": "Almacén 01",
  "ALM-02": "Almacén 02",
  "ALM-03": "Almacén 03",
};

function sedeLabel(id) {
  return SEDE_LABELS[id] ?? id;
}

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

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in pb-40"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title={`Recepción #${traspaso.numero}`}
        description={`${sedeLabel(traspaso.sede_origen_id)} → ${sedeLabel(traspaso.sede_destino_id)}`}
        actions={
          <button
            onClick={() => navigate(`/ops/traspasos/${id}`)}
            className="h-9 px-3 rounded-lg border text-sm font-medium cursor-pointer"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
              backgroundColor: "hsl(var(--card))",
            }}
          >
            ← Volver
          </button>
        }
      />

      {/* Banner de contexto */}
      <div
        className="p-4 rounded-xl border"
        style={{
          backgroundColor: "hsl(var(--success) / 0.06)",
          borderColor: "hsl(var(--success) / 0.25)",
        }}
      >
        <div className="flex items-start gap-3">
          <span className="text-xl">📥</span>
          <div>
            <p
              className="text-sm font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Confirmar cantidades recibidas
            </p>
            <p
              className="text-xs mt-0.5"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Ingresa las cantidades realmente recibidas. Si difieren de lo
              enviado, el traspaso quedará marcado como{" "}
              <strong>Con Diferencia</strong>.
            </p>
          </div>
        </div>
      </div>

      {/* Alerta de diferencias detectadas */}
      {hayDiferencias && (
        <div
          className="p-3 rounded-xl border flex items-start gap-3"
          style={{
            backgroundColor: "hsl(var(--warning) / 0.08)",
            borderColor: "hsl(var(--warning) / 0.3)",
          }}
        >
          <span className="text-lg">⚠️</span>
          <div>
            <p
              className="text-sm font-semibold"
              style={{ color: "hsl(var(--warning))" }}
            >
              Se detectaron diferencias
            </p>
            <p
              className="text-xs mt-0.5"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {totalDiff} unidad{totalDiff !== 1 ? "es" : ""} con diferencia
              respecto a lo enviado.
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="p-3 rounded-lg border text-sm"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.3)",
            color: "hsl(var(--destructive))",
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
              className="rounded-xl border p-4 transition-all"
              style={{
                backgroundColor: hasDiff
                  ? "hsl(var(--destructive) / 0.04)"
                  : "hsl(var(--card))",
                borderColor: hasDiff
                  ? "hsl(var(--destructive) / 0.25)"
                  : "hsl(var(--border))",
              }}
            >
              <div className="flex items-center gap-4">
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-semibold truncate"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {item.producto?.nombre ?? "—"}
                  </p>
                  <p
                    className="text-xs mt-0.5"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {item.producto?.referencia}
                  </p>
                </div>

                {/* Enviado (referencia) */}
                <div className="shrink-0 text-center hidden sm:block">
                  <p
                    className="text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    Enviado
                  </p>
                  <p
                    className="text-sm font-bold mt-0.5"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {enviado}
                  </p>
                </div>

                {/* Input de cantidad recibida */}
                <div className="shrink-0 flex flex-col items-center gap-1">
                  <p
                    className="text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    Recibido
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setCantidad(item.id, recibido - 1)}
                      className="rounded-lg border font-bold cursor-pointer"
                      style={{
                        width: 36,
                        height: 36,
                        borderColor: "hsl(var(--border))",
                        backgroundColor: "hsl(var(--muted) / 0.4)",
                        color: "hsl(var(--foreground))",
                        fontSize: 18,
                      }}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      value={recibido}
                      onChange={(e) => setCantidad(item.id, e.target.value)}
                      className="text-center text-sm font-bold rounded-lg border"
                      style={{
                        width: 56,
                        height: 36,
                        borderColor: hasDiff
                          ? "hsl(var(--destructive) / 0.5)"
                          : "hsl(var(--border))",
                        backgroundColor: "hsl(var(--background))",
                        color: hasDiff
                          ? "hsl(var(--destructive))"
                          : "hsl(var(--foreground))",
                      }}
                      min={0}
                    />
                    <button
                      onClick={() => setCantidad(item.id, recibido + 1)}
                      className="rounded-lg border font-bold cursor-pointer"
                      style={{
                        width: 36,
                        height: 36,
                        borderColor: "hsl(var(--border))",
                        backgroundColor: "hsl(var(--muted) / 0.4)",
                        color: "hsl(var(--foreground))",
                        fontSize: 18,
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              {/* Enviado (mobile) + diferencia */}
              <div className="mt-2 flex items-center gap-4 flex-wrap">
                <span
                  className="text-xs sm:hidden"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Enviado:{" "}
                  <strong style={{ color: "hsl(var(--foreground))" }}>
                    {enviado}
                  </strong>
                  {item.producto?.unidad_medida &&
                    ` ${item.producto.unidad_medida}`}
                </span>
                {hasDiff && (
                  <span
                    className="text-xs font-semibold"
                    style={{ color: "hsl(var(--destructive))" }}
                  >
                    Diferencia: {diff > 0 ? "+" : ""}
                    {diff} unidades
                  </span>
                )}
                {!hasDiff && (
                  <span
                    className="text-xs"
                    style={{ color: "hsl(var(--success))" }}
                  >
                    ✓ Sin diferencia
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal de confirmación con diferencias */}
      {confirmarDiff && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
            onClick={() => setConfirmarDiff(false)}
          />
          <div
            className="relative w-full max-w-md rounded-2xl p-6 shadow-xl"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderTop: "4px solid hsl(var(--destructive))",
            }}
          >
            <p
              className="text-base font-bold mb-2"
              style={{ color: "hsl(var(--foreground))" }}
            >
              ⚠️ Confirmar recepción con diferencias
            </p>
            <p
              className="text-sm mb-4"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Las cantidades recibidas no coinciden con las enviadas. El
              traspaso quedará marcado como <strong>Con Diferencia</strong> y
              las diferencias quedarán registradas en auditoría.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmarDiff(false)}
                className="flex-1 h-11 rounded-xl border text-sm font-medium cursor-pointer"
                style={{
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                  backgroundColor: "transparent",
                }}
              >
                Revisar
              </button>
              <button
                onClick={confirmarRecepcion}
                disabled={recibiendo}
                className="flex-1 h-11 rounded-xl text-sm font-semibold cursor-pointer disabled:opacity-60"
                style={{
                  backgroundColor: "hsl(var(--destructive))",
                  color: "#fff",
                }}
              >
                {recibiendo ? "Guardando…" : "Confirmar de todas formas"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barra de acción fija */}
      <div
        className="fixed bottom-0 left-0 right-0 p-4 border-t"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div className="max-w-xl mx-auto">
          <button
            onClick={handleSubmit}
            disabled={recibiendo}
            className="w-full h-12 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-50 cursor-pointer"
            style={{
              backgroundColor: hayDiferencias
                ? "hsl(var(--warning))"
                : "hsl(var(--success))",
              color: "#fff",
            }}
            onMouseEnter={(e) =>
              !recibiendo && (e.currentTarget.style.opacity = "0.9")
            }
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            {recibiendo
              ? "Registrando…"
              : hayDiferencias
                ? "⚠️ Confirmar recepción con diferencias"
                : "✓ Confirmar recepción"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LoadingView() {
  return (
    <div
      className="p-4 sm:p-6 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-xl animate-pulse"
            style={{ backgroundColor: "hsl(var(--muted))" }}
          />
        ))}
      </div>
    </div>
  );
}

function NotFoundView({ onBack }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="text-5xl mb-4">📦</div>
      <p
        className="font-semibold mb-4"
        style={{ color: "hsl(var(--foreground))" }}
      >
        Traspaso no encontrado
      </p>
      <button
        onClick={onBack}
        className="px-4 h-9 rounded-lg text-sm font-medium cursor-pointer"
        style={{
          backgroundColor: "hsl(var(--primary))",
          color: "hsl(var(--primary-foreground))",
        }}
      >
        Volver
      </button>
    </div>
  );
}
