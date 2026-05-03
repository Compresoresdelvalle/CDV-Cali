import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import PlusIcon from "../../components/ui/PlusIcon";

const FILTROS = ["Todos", "Pendientes", "Completados"];
const PAGE_SIZE = 20;

export default function EnsambleHistorial() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [ensambles, setEnsambles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("Todos");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cargar = async (reset = false, signal) => {
    if (!mountedRef.current) return;
    setLoading(true);
    setErrorMsg("");
    const currentPage = reset ? 0 : page;
    try {
      let query = supabase
        .from("ensambles")
        .select(
          `id, numero, fecha, cantidad_producida, completado, costo_total,
           producto:producto_resultado_id(referencia, nombre),
           realizador:realizado_por(nombre)`,
        )
        .order("fecha", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (perfil?.rol !== "Admin" && perfil?.sede_id)
        query = query.eq("sede_id", perfil.sede_id);
      if (filtro === "Pendientes") query = query.eq("completado", false);
      if (filtro === "Completados") query = query.eq("completado", true);

      // Timeout duro 15s para evitar UI atorada si la red se cuelga
      const { data, error } = await Promise.race([
        query,
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(new Error("Timeout: la red está lenta o sin respuesta")),
            15000,
          ),
        ),
      ]);
      if (signal?.aborted || !mountedRef.current) return;
      if (error) throw error;

      if (reset) {
        setEnsambles(data ?? []);
        setPage(1);
      } else {
        setEnsambles((prev) => [...prev, ...(data ?? [])]);
        setPage((p) => p + 1);
      }
      setHasMore((data ?? []).length === PAGE_SIZE);
    } catch (err) {
      if (signal?.aborted || !mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar ensambles"));
    } finally {
      // SIEMPRE limpiar loading — incluso si abortado, para no dejar la UI atorada
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    const ac = new AbortController();
    setPage(0);
    setHasMore(true);
    cargar(true, ac.signal);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro, perfil?.sede_id]);

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Ensambles"
        description={
          !loading
            ? `${ensambles.length}${hasMore ? "+" : ""} registros`
            : "Cargando…"
        }
        actions={
          <button
            onClick={() => navigate("/ops/ensambles/nuevo")}
            className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium transition-opacity cursor-pointer"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            <PlusIcon /> Nuevo ensamble
          </button>
        }
      />

      {errorMsg && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.4)",
            color: "hsl(var(--destructive))",
          }}
        >
          {errorMsg}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTROS.map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer"
            style={
              filtro === f
                ? {
                    backgroundColor: "hsl(var(--primary))",
                    color: "hsl(var(--primary-foreground))",
                    borderColor: "hsl(var(--primary))",
                  }
                : {
                    backgroundColor: "transparent",
                    color: "hsl(var(--muted-foreground))",
                    borderColor: "hsl(var(--border))",
                  }
            }
          >
            {f}
          </button>
        ))}
      </div>

      {loading && ensambles.length === 0 ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="rounded-xl p-4 animate-pulse border h-20"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            />
          ))}
        </div>
      ) : ensambles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-5xl mb-4">⚙️</div>
          <p
            className="font-semibold"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Sin ensambles registrados
          </p>
          <p
            className="text-sm mt-1"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Crea el primero con "Nuevo ensamble"
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5" role="list">
          {ensambles.map((e) => (
            <li
              key={e.id}
              className="rounded-xl px-4 py-3.5 border"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span
                      className="text-xs font-bold font-mono"
                      style={{ color: "hsl(var(--primary))" }}
                    >
                      #{e.numero}
                    </span>
                    <StatusBadge
                      status={e.completado ? "completada" : "pendiente"}
                    >
                      {e.completado ? "Completado" : "Pendiente"}
                    </StatusBadge>
                  </div>
                  <p
                    className="text-sm font-medium truncate"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {e.producto?.nombre ?? "—"}{" "}
                    <span
                      className="font-mono text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      ({e.producto?.referencia})
                    </span>
                  </p>
                  <p
                    className="text-xs mt-0.5"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {formatDate(e.fecha)} · {e.realizador?.nombre ?? "—"} · ×
                    {e.cantidad_producida}
                  </p>
                </div>
                <p
                  className="font-bold text-base tabular-nums shrink-0"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {formatCOP(e.costo_total ?? 0)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {hasMore && !loading && (
        <button
          onClick={() => cargar(false)}
          className="w-full py-3 rounded-xl text-sm font-medium border cursor-pointer"
          style={{
            borderColor: "hsl(var(--border))",
            color: "hsl(var(--muted-foreground))",
          }}
        >
          Cargar más
        </button>
      )}
    </div>
  );
}
