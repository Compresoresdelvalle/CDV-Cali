import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatDate } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";

const ESTADOS = [
  "Todos",
  "borrador",
  "picking",
  "verificado",
  "en_transito",
  "recibido",
  "con_diferencia",
];

const SEDE_LABELS = {
  "BOD-PRINCIPAL": "Bodega Principal",
  "ALM-01": "Almacén 01",
  "ALM-02": "Almacén 02",
  "ALM-03": "Almacén 03",
};

const PAGE_SIZE = 20;

export default function TraspasoHistorial() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";

  const [traspasos, setTraspasos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState("Todos");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const cargar = async (reset = false) => {
    setLoading(true);
    const currentPage = reset ? 0 : page;
    try {
      let query = supabase
        .from("traspasos")
        .select(
          `id, numero, fecha, estado, sede_origen_id, sede_destino_id, bultos, observaciones,
           solicitante:solicitado_por(nombre),
           picker:picker_id(nombre),
           verificador:verificado_por(nombre)`,
        )
        .order("fecha", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (!esAdmin) {
        // Bodeguero/Vendedor ve traspasos de su sede (origen o destino)
        query = query.or(
          `sede_origen_id.eq.${perfil.sede_id},sede_destino_id.eq.${perfil.sede_id}`,
        );
      }

      if (filtroEstado !== "Todos") {
        query = query.eq("estado", filtroEstado);
      }

      const { data, error } = await query;
      if (error) throw error;

      if (reset) {
        setTraspasos(data ?? []);
        setPage(1);
      } else {
        setTraspasos((prev) => [...prev, ...(data ?? [])]);
        setPage((p) => p + 1);
      }
      setHasMore((data ?? []).length === PAGE_SIZE);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargar(true);
  }, [filtroEstado]);

  const sedeLabel = (id) => SEDE_LABELS[id] ?? id;

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Traspasos"
        description={
          !loading
            ? `${traspasos.length}${hasMore ? "+" : ""} registros`
            : "Cargando…"
        }
        actions={
          <button
            onClick={() => navigate("/ops/traspasos/nuevo")}
            className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium transition-opacity cursor-pointer"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            <PlusIcon />
            Nuevo traspaso
          </button>
        }
      />

      {/* Filtros de estado */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {ESTADOS.map((e) => (
          <button
            key={e}
            onClick={() => setFiltroEstado(e)}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer"
            style={
              filtroEstado === e
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
            {e === "Todos"
              ? "Todos"
              : e === "borrador"
                ? "Pendiente"
                : e === "picking"
                  ? "En Picking"
                  : e === "verificado"
                    ? "Verificado"
                    : e === "en_transito"
                      ? "En Tránsito"
                      : e === "recibido"
                        ? "Recibido"
                        : "Con Diferencia"}
          </button>
        ))}
      </div>

      {/* Contenido */}
      {loading && traspasos.length === 0 ? (
        <SkeletonList />
      ) : traspasos.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Desktop tabla */}
          <div
            className="hidden md:block overflow-x-auto rounded-xl border"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <table className="w-full border-collapse">
              <thead>
                <tr
                  style={{
                    backgroundColor: "hsl(var(--muted) / 0.4)",
                    borderBottom: "1px solid hsl(var(--border))",
                  }}
                >
                  {[
                    "#",
                    "Fecha",
                    "Origen",
                    "Destino",
                    "Estado",
                    "Picker",
                    "",
                  ].map((col) => (
                    <th
                      key={col}
                      className="px-3 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap text-left"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {traspasos.map((t, idx) => (
                  <tr
                    key={t.id}
                    onClick={() => navigate(`/ops/traspasos/${t.id}`)}
                    className="cursor-pointer transition-colors"
                    style={{
                      borderTop:
                        idx === 0
                          ? "none"
                          : "1px solid hsl(var(--border) / 0.5)",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor =
                        "hsl(var(--muted) / 0.3)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "")
                    }
                  >
                    <td className="px-3 py-3.5">
                      <span
                        className="text-xs font-bold font-mono"
                        style={{ color: "hsl(var(--primary))" }}
                      >
                        #{t.numero}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <span
                        className="text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {formatDate(t.fecha)}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <span
                        className="text-xs font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {sedeLabel(t.sede_origen_id)}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <span
                        className="text-xs font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {sedeLabel(t.sede_destino_id)}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <StatusBadge status={t.estado} />
                    </td>
                    <td className="px-3 py-3.5">
                      <span
                        className="text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {t.picker?.nombre ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <ArrowIcon />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="md:hidden space-y-2.5" role="list">
            {traspasos.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => navigate(`/ops/traspasos/${t.id}`)}
                  className="w-full text-left rounded-xl px-4 py-4 border transition-all cursor-pointer"
                  style={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.borderColor =
                      "hsl(var(--primary) / 0.3)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.borderColor = "hsl(var(--border))")
                  }
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <span
                      className="text-xs font-bold font-mono"
                      style={{ color: "hsl(var(--primary))" }}
                    >
                      #{t.numero}
                    </span>
                    <StatusBadge status={t.estado} />
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-sm font-medium"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {sedeLabel(t.sede_origen_id)}
                    </span>
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>
                      →
                    </span>
                    <span
                      className="text-sm font-medium"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {sedeLabel(t.sede_destino_id)}
                    </span>
                  </div>
                  <p
                    className="text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {formatDate(t.fecha)}
                    {t.picker?.nombre && ` · Picker: ${t.picker.nombre}`}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          {hasMore && (
            <button
              onClick={() => cargar(false)}
              disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-medium border transition-all disabled:opacity-50 cursor-pointer"
              style={{
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--muted-foreground))",
                backgroundColor: "transparent",
              }}
            >
              {loading ? "Cargando..." : "Cargar más"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="rounded-xl p-4 animate-pulse border"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          <div className="flex justify-between items-start gap-4">
            <div className="flex-1 space-y-2">
              <div
                className="h-4 rounded w-1/4"
                style={{ backgroundColor: "hsl(var(--muted))" }}
              />
              <div
                className="h-3 rounded w-1/2"
                style={{ backgroundColor: "hsl(var(--muted))" }}
              />
            </div>
            <div
              className="w-20 h-6 rounded"
              style={{ backgroundColor: "hsl(var(--muted))" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-5xl mb-4">🔄</div>
      <p className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>
        Sin traspasos registrados
      </p>
      <p
        className="text-sm mt-1"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        Crea un nuevo traspaso para mover mercancía entre sedes
      </p>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 4v16m8-8H4"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ color: "hsl(var(--muted-foreground))" }}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5l7 7-7 7"
      />
    </svg>
  );
}
