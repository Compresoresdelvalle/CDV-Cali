import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import PageHeader from "../../components/layout/PageHeader";

export default function PickingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [traspaso, setTraspaso] = useState(null);
  const [items, setItems] = useState([]);
  const [local, setLocal] = useState({});
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [ultimoGuardado, setUltimoGuardado] = useState(null);
  const autoSaveRef = useRef(null);

  /* ── Cargar datos ─────────────────────────────────────────── */
  useEffect(() => {
    const cargar = async () => {
      setLoading(true);
      try {
        const [{ data: t, error: errT }, { data: d, error: errD }] =
          await Promise.all([
            supabase
              .from("traspasos")
              .select("id, numero, estado, picker_id, sede_origen_id")
              .eq("id", id)
              .single(),
            supabase
              .from("detalle_traspaso")
              .select(
                `id, cantidad_solicitada, cantidad_enviada, picking_completado,
                 producto:producto_id(nombre, referencia, unidad_medida),
                 ubicacion:ubicacion_origen_id(pasillo, estante, nivel, prioridad_picking)`,
              )
              .eq("traspaso_id", id),
          ]);

        if (errT || !t) throw new Error("Traspaso no encontrado");
        if (errD) throw new Error(errD.message);

        // Solo el picker asignado (o Admin) puede hacer picking
        if (t.picker_id !== perfil?.id && perfil?.rol !== "Admin") {
          navigate(`/ops/traspasos/${id}`, { replace: true });
          return;
        }

        // Ordenar por prioridad_picking ASC, nulls last
        const sorted = [...(d ?? [])].sort((a, b) => {
          const pa = a.ubicacion?.prioridad_picking ?? 9999;
          const pb = b.ubicacion?.prioridad_picking ?? 9999;
          return pa - pb;
        });

        setTraspaso(t);
        setItems(sorted);

        // Estado local inicializado desde BD
        const init = {};
        for (const item of sorted) {
          init[item.id] = {
            picking_completado: item.picking_completado ?? false,
            cantidad_enviada:
              item.cantidad_enviada ?? item.cantidad_solicitada ?? 1,
          };
        }
        setLocal(init);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    cargar();
    return () => clearTimeout(autoSaveRef.current);
  }, [id, perfil, navigate]);

  /* ── Guardar progreso vía RPC ─────────────────────────────── */
  const guardarProgreso = useCallback(
    async (localSnapshot) => {
      if (!items.length) return;
      setGuardando(true);
      setError(null);
      try {
        const p_items = items.map((item) => ({
          detalle_id: item.id,
          cantidad_enviada:
            localSnapshot[item.id]?.cantidad_enviada ??
            item.cantidad_solicitada,
          picking_completado:
            localSnapshot[item.id]?.picking_completado ?? false,
        }));

        const { error: rpcErr } = await supabase.rpc("fn_procesar_traspaso", {
          p_traspaso_id: id,
          p_accion: "actualizar_items",
          p_items,
        });
        if (rpcErr) throw new Error(rpcErr.message);
        setUltimoGuardado(new Date());
      } catch (e) {
        setError(e.message);
      } finally {
        setGuardando(false);
      }
    },
    [id, items],
  );

  const scheduleAutoSave = useCallback(
    (nextLocal) => {
      clearTimeout(autoSaveRef.current);
      autoSaveRef.current = setTimeout(() => guardarProgreso(nextLocal), 1500);
    },
    [guardarProgreso],
  );

  /* ── Handlers de interacción ──────────────────────────────── */
  const toggleItem = (itemId) => {
    setLocal((prev) => {
      const next = {
        ...prev,
        [itemId]: {
          ...prev[itemId],
          picking_completado: !prev[itemId]?.picking_completado,
        },
      };
      scheduleAutoSave(next);
      return next;
    });
  };

  const setCantidad = (itemId, value) => {
    const num = Math.max(1, parseInt(value) || 1);
    setLocal((prev) => {
      const next = {
        ...prev,
        [itemId]: { ...prev[itemId], cantidad_enviada: num },
      };
      scheduleAutoSave(next);
      return next;
    });
  };

  const handleFinalizar = async () => {
    clearTimeout(autoSaveRef.current);
    await guardarProgreso(local);
    navigate(`/ops/traspasos/${id}`);
  };

  /* ── Cálculos de progreso ─────────────────────────────────── */
  const totalItems = items.length;
  const itemsCompletos = items.filter(
    (i) => local[i.id]?.picking_completado,
  ).length;
  const pickingCompleto = totalItems > 0 && itemsCompletos === totalItems;
  const progreso = totalItems > 0 ? (itemsCompletos / totalItems) * 100 : 0;

  if (loading) return <LoadingView />;

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in pb-40"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title={`Picking #${traspaso?.numero ?? "—"}`}
        description={`${itemsCompletos} de ${totalItems} items completados`}
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

      {/* Barra de progreso */}
      <div
        className="rounded-xl border p-4"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <p
            className="text-sm font-medium"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Progreso
          </p>
          <p
            className="text-sm font-bold"
            style={{
              color: pickingCompleto
                ? "hsl(var(--success))"
                : "hsl(var(--warning))",
            }}
          >
            {Math.round(progreso)}%
          </p>
        </div>
        <div
          className="h-3 rounded-full overflow-hidden"
          style={{ backgroundColor: "hsl(var(--muted))" }}
        >
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${progreso}%`,
              backgroundColor: pickingCompleto
                ? "hsl(var(--success))"
                : "hsl(var(--warning))",
            }}
          />
        </div>
        {ultimoGuardado && (
          <p
            className="text-xs mt-2"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            ✓ Guardado{" "}
            {ultimoGuardado.toLocaleTimeString("es-CO", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        )}
        {guardando && (
          <p
            className="text-xs mt-2"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Guardando…
          </p>
        )}
      </div>

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

      {/* Lista de items */}
      <div className="space-y-2">
        {items.map((item, idx) => {
          const estado = local[item.id] ?? {
            picking_completado: false,
            cantidad_enviada: item.cantidad_solicitada,
          };
          const completado = estado.picking_completado;
          const loc = item.ubicacion;
          const ubicCode = loc
            ? `${loc.pasillo}-${loc.estante}-${loc.nivel}`
            : null;

          return (
            <div
              key={item.id}
              className="rounded-xl border transition-all"
              style={{
                backgroundColor: completado
                  ? "hsl(var(--success) / 0.06)"
                  : "hsl(var(--card))",
                borderColor: completado
                  ? "hsl(var(--success) / 0.3)"
                  : "hsl(var(--border))",
              }}
            >
              <div className="p-4 flex items-center gap-3">
                {/* Número de ruta */}
                <span
                  className="text-xs font-bold font-mono w-5 text-center shrink-0"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {idx + 1}
                </span>

                {/* Checkbox 48 × 48 px (uso industrial) */}
                <button
                  onClick={() => toggleItem(item.id)}
                  aria-label={
                    completado ? "Desmarcar item" : "Marcar como pickeado"
                  }
                  className="shrink-0 rounded-xl border-2 transition-all cursor-pointer flex items-center justify-center"
                  style={{
                    width: 48,
                    height: 48,
                    minWidth: 48,
                    borderColor: completado
                      ? "hsl(var(--success))"
                      : "hsl(var(--border))",
                    backgroundColor: completado
                      ? "hsl(var(--success))"
                      : "transparent",
                  }}
                >
                  {completado && (
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      stroke="#fff"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={3}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </button>

                {/* Nombre + ubicación */}
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-semibold truncate"
                    style={{
                      color: "hsl(var(--foreground))",
                      textDecoration: completado ? "line-through" : "none",
                      opacity: completado ? 0.6 : 1,
                    }}
                  >
                    {item.producto?.nombre ?? "—"}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className="text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {item.producto?.referencia}
                    </span>
                    {ubicCode && (
                      <span
                        className="text-xs font-mono font-bold px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: "hsl(var(--primary) / 0.1)",
                          color: "hsl(var(--primary))",
                        }}
                      >
                        {ubicCode}
                      </span>
                    )}
                  </div>
                </div>

                {/* Control de cantidad */}
                <div className="shrink-0 flex items-center gap-1.5">
                  <button
                    onClick={() =>
                      setCantidad(item.id, estado.cantidad_enviada - 1)
                    }
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
                    value={estado.cantidad_enviada}
                    onChange={(e) => setCantidad(item.id, e.target.value)}
                    className="text-center text-sm font-bold rounded-lg border"
                    style={{
                      width: 52,
                      height: 36,
                      borderColor: "hsl(var(--border))",
                      backgroundColor: "hsl(var(--background))",
                      color: "hsl(var(--foreground))",
                    }}
                    min={1}
                  />
                  <button
                    onClick={() =>
                      setCantidad(item.id, estado.cantidad_enviada + 1)
                    }
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

              {/* Subtítulo: solicitado */}
              <div className="px-4 pb-3 flex items-center gap-3">
                <span className="w-5 shrink-0" />
                <span className="w-12 shrink-0" />
                <p
                  className="text-xs"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Solicitado:{" "}
                  <strong style={{ color: "hsl(var(--foreground))" }}>
                    {item.cantidad_solicitada}
                  </strong>
                  {item.producto?.unidad_medida &&
                    ` ${item.producto.unidad_medida}`}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Barra de acciones fija al fondo */}
      <div
        className="fixed bottom-0 left-0 right-0 p-4 border-t"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        {!pickingCompleto && (
          <p
            className="text-xs text-center mb-2"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {totalItems - itemsCompletos} item
            {totalItems - itemsCompletos !== 1 ? "s" : ""} pendiente
            {totalItems - itemsCompletos !== 1 ? "s" : ""} — márcalos para
            finalizar
          </p>
        )}
        <div className="flex gap-3 max-w-xl mx-auto">
          <button
            onClick={() => guardarProgreso(local)}
            disabled={guardando}
            className="flex-1 h-12 rounded-xl border text-sm font-medium transition-opacity disabled:opacity-50 cursor-pointer"
            style={{
              borderColor: "hsl(var(--border))",
              backgroundColor: "hsl(var(--muted) / 0.3)",
              color: "hsl(var(--foreground))",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            {guardando ? "Guardando…" : "Guardar progreso"}
          </button>
          <button
            onClick={handleFinalizar}
            disabled={!pickingCompleto || guardando}
            className="flex-1 h-12 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-40 cursor-pointer"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
            onMouseEnter={(e) =>
              !guardando &&
              pickingCompleto &&
              (e.currentTarget.style.opacity = "0.9")
            }
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            ✓ Finalizar picking
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
        {[...Array(6)].map((_, i) => (
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
