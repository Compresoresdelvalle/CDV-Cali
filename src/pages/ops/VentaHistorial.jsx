import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate } from "../../lib/utils";

const METODOS_PAGO = [
  "Todos",
  "Efectivo",
  "Transferencia",
  "Tarjeta",
  "Crédito",
];

export default function VentaHistorial() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";

  const [ventas, setVentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroMetodo, setFiltroMetodo] = useState("Todos");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 20;

  const cargarVentas = async (reset = false) => {
    setLoading(true);
    const currentPage = reset ? 0 : page;

    try {
      let query = supabase
        .from("ventas")
        .select(
          `id, numero, fecha, cliente_nombre, metodo_pago, total, anulada, sede_id,
           vendedor:vendedor_id(nombre)`,
        )
        .order("fecha", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (!esAdmin) {
        query = query.eq("sede_id", perfil.sede_id);
      }

      if (filtroMetodo !== "Todos") {
        query = query.eq("metodo_pago", filtroMetodo);
      }

      const { data, error } = await query;
      if (error) throw error;

      if (reset) {
        setVentas(data ?? []);
        setPage(1);
      } else {
        setVentas((prev) => [...prev, ...(data ?? [])]);
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
    cargarVentas(true);
  }, [filtroMetodo]);

  return (
    <div
      className="flex flex-col min-h-full"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-10 border-b"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div className="px-4 sm:px-6 pt-4 pb-3 space-y-3 max-w-5xl mx-auto">
          <div className="module-header !mb-0 !pb-0 !border-b-0">
            <div>
              <h1
                className="text-xl font-bold"
                style={{ color: "hsl(var(--foreground))" }}
              >
                Ventas
              </h1>
              {!loading && (
                <p
                  className="text-xs mt-0.5"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {ventas.length}
                  {hasMore ? "+" : ""} registros
                </p>
              )}
            </div>
            <button
              onClick={() => navigate("/ops/ventas/nueva")}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
              style={{
                backgroundColor: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Nueva venta
            </button>
          </div>

          {/* Filtro método de pago */}
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {METODOS_PAGO.map((m) => (
              <button
                key={m}
                onClick={() => setFiltroMetodo(m)}
                className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer"
                style={
                  filtroMetodo === m
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
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Lista ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 px-4 sm:px-6 py-4 max-w-5xl mx-auto w-full">
        {loading && ventas.length === 0 ? (
          /* Skeleton */
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
                    <div
                      className="h-3 rounded w-1/3"
                      style={{ backgroundColor: "hsl(var(--muted))" }}
                    />
                  </div>
                  <div
                    className="w-24 h-6 rounded"
                    style={{ backgroundColor: "hsl(var(--muted))" }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : ventas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-5xl mb-4">🧾</div>
            <p
              className="font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Sin ventas registradas
            </p>
            <p
              className="text-sm mt-1"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Las ventas aparecerán aquí una vez creadas
            </p>
          </div>
        ) : (
          <>
            {/* Desktop: tabla */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr
                    className="border-b-2 text-left"
                    style={{ borderColor: "hsl(var(--border))" }}
                  >
                    {[
                      "#",
                      "Fecha",
                      "Cliente",
                      "Método",
                      "Vendedor",
                      "Total",
                      "",
                    ].map((col) => (
                      <th
                        key={col}
                        className="px-3 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap first:pl-0 last:pr-0"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ventas.map((v) => (
                    <tr
                      key={v.id}
                      onClick={() => navigate(`/ops/ventas/${v.id}`)}
                      className="border-b cursor-pointer transition-colors group"
                      style={{ borderColor: "hsl(var(--border) / 0.5)" }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          "hsl(var(--muted) / 0.5)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = "")
                      }
                    >
                      <td className="px-3 py-3.5 first:pl-0">
                        <span
                          className="text-xs font-bold font-mono"
                          style={{ color: "hsl(var(--primary))" }}
                        >
                          #{v.numero}
                        </span>
                      </td>
                      <td className="px-3 py-3.5">
                        <span
                          className="text-xs"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {formatDate(v.fecha)}
                        </span>
                      </td>
                      <td className="px-3 py-3.5">
                        <span
                          className="text-sm font-medium"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {v.cliente_nombre || "Cliente mostrador"}
                        </span>
                      </td>
                      <td className="px-3 py-3.5">
                        <span className="status-badge status-neutral text-[11px]">
                          {v.metodo_pago}
                        </span>
                      </td>
                      <td className="px-3 py-3.5">
                        <span
                          className="text-xs"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {v.vendedor?.nombre ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3.5">
                        <span
                          className="font-bold tabular-nums"
                          style={{
                            color: v.anulada
                              ? "hsl(var(--muted-foreground))"
                              : "hsl(var(--foreground))",
                          }}
                        >
                          {formatCOP(v.total)}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 last:pr-0">
                        {v.anulada && (
                          <span className="status-badge status-danger text-[11px]">
                            Anulada
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: cards */}
            <ul className="md:hidden space-y-2.5" role="list">
              {ventas.map((v) => (
                <li key={v.id}>
                  <button
                    onClick={() => navigate(`/ops/ventas/${v.id}`)}
                    className="w-full text-left rounded-xl px-4 py-4 border transition-shadow hover:shadow-md active:scale-[0.985] cursor-pointer"
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
                            #{v.numero}
                          </span>
                          {v.anulada && (
                            <span className="status-badge status-danger text-[11px]">
                              Anulada
                            </span>
                          )}
                          <span className="status-badge status-neutral text-[11px]">
                            {v.metodo_pago}
                          </span>
                        </div>
                        <p
                          className="text-sm font-medium truncate"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {v.cliente_nombre || "Cliente mostrador"}
                        </p>
                        <p
                          className="text-xs mt-0.5"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {formatDate(v.fecha)}
                          {esAdmin && v.vendedor && ` · ${v.vendedor.nombre}`}
                        </p>
                      </div>
                      <div className="text-right ml-2 shrink-0">
                        <p
                          className="font-bold text-base tabular-nums"
                          style={{
                            color: v.anulada
                              ? "hsl(var(--muted-foreground))"
                              : "hsl(var(--foreground))",
                          }}
                        >
                          {formatCOP(v.total)}
                        </p>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            {/* Cargar más */}
            {hasMore && (
              <button
                onClick={() => cargarVentas(false)}
                disabled={loading}
                className="w-full mt-4 py-3 rounded-xl text-sm font-medium border transition-colors disabled:opacity-50 cursor-pointer"
                style={{
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                {loading ? "Cargando..." : "Cargar más"}
              </button>
            )}
          </>
        )}
        <div className="h-6" />
      </div>
    </div>
  );
}
