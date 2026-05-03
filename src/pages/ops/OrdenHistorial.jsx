import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import PlusIcon from "../../components/ui/PlusIcon";

const FILTROS = [
  "Todas",
  "Abiertas",
  "En proceso",
  "Esperando repuesto",
  "Completadas",
  "Entregadas",
];
const FILTRO_TO_ESTADO = {
  Abiertas: "abierta",
  "En proceso": "en_proceso",
  "Esperando repuesto": "esperando_repuesto",
  Completadas: "completada",
  Entregadas: "entregada",
};
const PAGE_SIZE = 20;

export default function OrdenHistorial() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [ordenes, setOrdenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("Todas");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const abortRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const cargar = async (reset = false) => {
    // Abortar cualquier carga previa en vuelo (evita race en clicks rápidos)
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    if (!mountedRef.current) return;
    setLoading(true);
    setErrorMsg("");
    const currentPage = reset ? 0 : page;
    try {
      let query = supabase
        .from("ordenes_servicio")
        .select(
          `id, numero, fecha, cliente_nombre, equipo_descripcion, estado, total,
           tecnico:tecnico_id(nombre)`,
        )
        .order("fecha", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (perfil?.rol !== "Admin" && perfil?.sede_id)
        query = query.eq("sede_id", perfil.sede_id);

      const estado = FILTRO_TO_ESTADO[filtro];
      if (estado) query = query.eq("estado", estado);

      const { data, error } = await query;
      if (ac.signal.aborted || !mountedRef.current) return;
      if (error) throw error;

      if (reset) {
        setOrdenes(data ?? []);
        setPage(1);
      } else {
        setOrdenes((p) => [...p, ...(data ?? [])]);
        setPage((p) => p + 1);
      }
      setHasMore((data ?? []).length === PAGE_SIZE);
    } catch (err) {
      if (ac.signal.aborted || !mountedRef.current) return;
      console.error("[OrdenHistorial]", err);
      setErrorMsg(safeError(err, "Error al cargar órdenes"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    setPage(0);
    setHasMore(true);
    cargar(true);
  }, [filtro, perfil?.sede_id]);

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Órdenes de Servicio"
        description={
          !loading
            ? `${ordenes.length}${hasMore ? "+" : ""} registros`
            : "Cargando…"
        }
        actions={
          <button
            onClick={() => navigate("/ops/ordenes/nueva")}
            className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium transition-opacity cursor-pointer"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            <PlusIcon /> Nueva orden
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

      {loading && ordenes.length === 0 ? (
        <Skeleton />
      ) : ordenes.length === 0 ? (
        <Empty />
      ) : (
        <ul className="space-y-2.5" role="list">
          {ordenes.map((o) => (
            <li key={o.id}>
              <button
                onClick={() => navigate(`/ops/ordenes/${o.id}`)}
                className="w-full text-left rounded-xl px-4 py-3.5 border transition-all cursor-pointer hover:opacity-95"
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
                        #{o.numero}
                      </span>
                      <StatusBadge status={o.estado} />
                    </div>
                    <p
                      className="text-sm font-medium truncate"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {o.cliente_nombre}
                    </p>
                    <p
                      className="text-xs mt-0.5 truncate"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {o.equipo_descripcion}
                    </p>
                    <p
                      className="text-xs mt-0.5"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {formatDate(o.fecha)}
                      {o.tecnico?.nombre && ` · ${o.tecnico.nombre}`}
                    </p>
                  </div>
                  <p
                    className="font-bold text-base tabular-nums shrink-0"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {formatCOP(o.total ?? 0)}
                  </p>
                </div>
              </button>
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

function Skeleton() {
  return (
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
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-5xl mb-4">🛠️</div>
      <p className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>
        Sin órdenes registradas
      </p>
      <p
        className="text-sm mt-1"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        Crea la primera con "Nueva orden"
      </p>
    </div>
  );
}
