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
    <div className="min-h-screen" style={{ backgroundColor: "#F4F1EB" }}>
      {/* Header */}
      <div
        className="sticky top-0 z-10 px-4 py-4 shadow-sm"
        style={{ backgroundColor: "#14352A" }}
      >
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-white font-semibold text-lg">Ventas</h1>
            <button
              onClick={() => navigate("/ops/ventas/nueva")}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
              style={{ backgroundColor: "#C8993E", color: "#fff" }}
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
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {METODOS_PAGO.map((m) => (
              <button
                key={m}
                onClick={() => setFiltroMetodo(m)}
                className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                style={
                  filtroMetodo === m
                    ? {
                        backgroundColor: "#C8993E",
                        color: "#fff",
                        borderColor: "#C8993E",
                      }
                    : {
                        backgroundColor: "transparent",
                        color: "rgba(255,255,255,0.7)",
                        borderColor: "rgba(255,255,255,0.3)",
                      }
                }
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-3">
        {loading && ventas.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm" style={{ color: "#9CA3AB" }}>
              Cargando ventas...
            </p>
          </div>
        ) : ventas.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm" style={{ color: "#9CA3AB" }}>
              No hay ventas registradas
            </p>
          </div>
        ) : (
          <>
            {ventas.map((v) => (
              <button
                key={v.id}
                onClick={() => navigate(`/ops/ventas/${v.id}`)}
                className="w-full bg-white rounded-2xl shadow-sm px-4 py-4 text-left transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="text-xs font-bold"
                        style={{ color: "#14352A" }}
                      >
                        #{v.numero}
                      </span>
                      {v.anulada && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                          Anulada
                        </span>
                      )}
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ backgroundColor: "#EDE9E0", color: "#636B74" }}
                      >
                        {v.metodo_pago}
                      </span>
                    </div>
                    <p
                      className="text-sm font-medium truncate"
                      style={{ color: "#151515" }}
                    >
                      {v.cliente_nombre || "Cliente mostrador"}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "#9CA3AB" }}>
                      {formatDate(v.fecha)}
                      {esAdmin && v.vendedor && ` · ${v.vendedor.nombre}`}
                    </p>
                  </div>
                  <div className="text-right ml-4">
                    <p
                      className="font-bold text-base"
                      style={{ color: v.anulada ? "#9CA3AB" : "#14352A" }}
                    >
                      {formatCOP(v.total)}
                    </p>
                  </div>
                </div>
              </button>
            ))}

            {hasMore && (
              <button
                onClick={() => cargarVentas(false)}
                disabled={loading}
                className="w-full py-3 rounded-2xl text-sm font-medium border transition-colors disabled:opacity-50"
                style={{ borderColor: "#E2DED5", color: "#636B74" }}
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
