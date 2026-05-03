import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";

const ESTADOS = [
  "Todos",
  "borrador",
  "enviada",
  "aprobada",
  "rechazada",
  "vencida",
];
const ESTADO_LABELS = {
  borrador: "Borrador",
  enviada: "Enviada",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  vencida: "Vencida",
};

const PAGE_SIZE = 20;

export default function CotizacionHistorial() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";

  const [cotizaciones, setCotizaciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState("Todos");
  const [busqueda, setBusqueda] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const [convirtiendo, setConvirtiendo] = useState(null);
  const [errorConversion, setErrorConversion] = useState(null);

  const cargarCotizaciones = async (reset = false) => {
    setLoading(true);
    const currentPage = reset ? 0 : page;

    try {
      let query = supabase
        .from("cotizaciones")
        .select(
          `id, numero, fecha, cliente_nombre, estado, total, vigencia_dias,
           vendedor:vendedor_id(nombre)`,
        )
        .order("fecha", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (!esAdmin) query = query.eq("sede_id", perfil.sede_id);
      if (filtroEstado !== "Todos") query = query.eq("estado", filtroEstado);

      const { data, error } = await query;
      if (error) throw error;

      if (reset) {
        setCotizaciones(data ?? []);
        setPage(1);
      } else {
        setCotizaciones((prev) => [...prev, ...(data ?? [])]);
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
    cargarCotizaciones(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroEstado]);

  const convertirEnVenta = async (e, cotizacionId) => {
    e.stopPropagation();
    setConvirtiendo(cotizacionId);
    setErrorConversion(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc(
        "fn_convertir_cotizacion",
        { p_cotizacion_id: cotizacionId },
      );
      if (rpcErr) throw new Error(rpcErr.message);
      navigate(`/ops/ventas/${data.venta_id}`);
    } catch (e) {
      setErrorConversion({
        id: cotizacionId,
        msg: safeError(e, "Error al convertir"),
      });
    } finally {
      setConvirtiendo(null);
    }
  };

  // Client-side search filter
  const filtradas = busqueda.trim()
    ? cotizaciones.filter(
        (c) =>
          c.cliente_nombre?.toLowerCase().includes(busqueda.toLowerCase()) ||
          String(c.numero).includes(busqueda),
      )
    : cotizaciones;

  return (
    <div
      className="flex flex-col min-h-full p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      {/* ── PageHeader ── */}
      <PageHeader
        title="Cotizaciones"
        description={`${cotizaciones.length}${hasMore ? "+" : ""} cotizaciones`}
        actions={
          <button
            onClick={() => navigate("/ops/cotizaciones/nueva")}
            className="flex items-center gap-2 h-9 px-3 rounded-lg text-sm font-medium transition-all cursor-pointer"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            <PlusIcon />
            <span className="hidden sm:inline">Nueva cotización</span>
            <span className="sm:hidden">Nueva</span>
          </button>
        }
      />

      {/* ── Filtros ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Búsqueda */}
        <div className="relative flex-1 min-w-[180px]">
          <SearchIcon
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "hsl(var(--muted-foreground))" }}
          />
          <input
            type="search"
            placeholder="Buscar por cliente o #..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full pl-9 pr-4 h-9 rounded-lg border text-sm focus:outline-none transition-all"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          />
        </div>

        {/* Estado chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {ESTADOS.map((e) => {
            const active = filtroEstado === e;
            return (
              <button
                key={e}
                onClick={() => setFiltroEstado(e)}
                className="h-9 px-3 rounded-lg text-xs font-semibold border transition-all cursor-pointer capitalize"
                style={
                  active
                    ? {
                        backgroundColor: "hsl(var(--primary))",
                        color: "hsl(var(--primary-foreground))",
                        borderColor: "hsl(var(--primary))",
                      }
                    : {
                        backgroundColor: "hsl(var(--card))",
                        color: "hsl(var(--muted-foreground))",
                        borderColor: "hsl(var(--border))",
                      }
                }
              >
                {e === "Todos" ? "Todos" : (ESTADO_LABELS[e] ?? e)}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Contenido ── */}
      <div className="flex-1 min-w-0">
        {/* Loading */}
        {loading && cotizaciones.length === 0 && (
          <div className="flex flex-col gap-3">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="rounded-xl p-4 animate-pulse border"
                style={{
                  backgroundColor: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                }}
              >
                <div className="flex justify-between">
                  <div className="space-y-2 flex-1">
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
                    className="h-6 w-20 rounded"
                    style={{ backgroundColor: "hsl(var(--muted))" }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sin resultados */}
        {!loading && filtradas.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-5xl mb-4">📋</div>
            <p
              className="font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Sin cotizaciones
            </p>
            <p
              className="text-sm mt-1"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {busqueda
                ? `Sin resultados para "${busqueda}"`
                : filtroEstado !== "Todos"
                  ? `No hay cotizaciones ${ESTADO_LABELS[filtroEstado]?.toLowerCase()}`
                  : "Crea la primera cotización"}
            </p>
          </div>
        )}

        {filtradas.length > 0 && (
          <>
            {/* ── Vista MÓVIL: Cards ── */}
            <ul className="md:hidden space-y-2.5" role="list">
              {filtradas.map((c) => {
                const esteError =
                  errorConversion?.id === c.id ? errorConversion.msg : null;
                const puedeConvertir =
                  c.estado !== "rechazada" &&
                  c.estado !== "vencida" &&
                  c.estado !== "aprobada";
                return (
                  <li key={c.id}>
                    <div
                      onClick={() => navigate(`/ops/cotizaciones/${c.id}`)}
                      className="rounded-xl px-4 py-3.5 border shadow-sm cursor-pointer transition-all duration-100"
                      style={{
                        backgroundColor: "hsl(var(--card))",
                        borderColor: "hsl(var(--border))",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.borderColor =
                          "hsl(var(--primary) / 0.3)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.borderColor =
                          "hsl(var(--border))")
                      }
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className="text-xs font-bold font-mono"
                              style={{ color: "hsl(var(--primary))" }}
                            >
                              #{c.numero}
                            </span>
                            <StatusBadge status={c.estado} />
                          </div>
                          <p
                            className="text-sm font-medium truncate"
                            style={{ color: "hsl(var(--foreground))" }}
                          >
                            {c.cliente_nombre || "Sin nombre"}
                          </p>
                          <p
                            className="text-xs mt-0.5"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            {formatDate(c.fecha)}
                            {esAdmin && c.vendedor && ` · ${c.vendedor.nombre}`}
                            {" · "}
                            {c.vigencia_dias}d vigencia
                          </p>
                        </div>
                        <p
                          className="font-bold text-base tabular-nums"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {formatCOP(c.total)}
                        </p>
                      </div>
                      {esteError && (
                        <p
                          className="text-xs mt-2"
                          style={{ color: "hsl(var(--destructive))" }}
                        >
                          {esteError}
                        </p>
                      )}
                      {puedeConvertir && (
                        <button
                          onClick={(e) => convertirEnVenta(e, c.id)}
                          disabled={convirtiendo === c.id}
                          className="mt-3 w-full py-2 rounded-lg text-xs font-medium border transition-all disabled:opacity-50 cursor-pointer"
                          style={{
                            borderColor: "hsl(var(--primary))",
                            color: "hsl(var(--primary))",
                          }}
                        >
                          {convirtiendo === c.id
                            ? "Convirtiendo..."
                            : "Convertir en venta"}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* ── Vista DESKTOP: Tabla ── */}
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
                      "Cliente",
                      "Estado",
                      "Vendedor",
                      "Vigencia",
                      "Total",
                      "",
                    ].map((col) => (
                      <th
                        key={col}
                        className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-left whitespace-nowrap"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((c, idx) => {
                    const puedeConvertir =
                      c.estado !== "rechazada" &&
                      c.estado !== "vencida" &&
                      c.estado !== "aprobada";
                    const esteError =
                      errorConversion?.id === c.id ? errorConversion.msg : null;
                    return (
                      <tr
                        key={c.id}
                        onClick={() => navigate(`/ops/cotizaciones/${c.id}`)}
                        className="cursor-pointer transition-colors"
                        style={{
                          borderTop:
                            idx === 0
                              ? "none"
                              : "1px solid hsl(var(--border) / 0.5)",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor =
                            "hsl(var(--muted) / 0.4)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.backgroundColor = "")
                        }
                      >
                        <td className="px-4 py-3.5">
                          <span
                            className="font-mono text-xs font-bold"
                            style={{ color: "hsl(var(--primary))" }}
                          >
                            #{c.numero}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className="text-xs"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            {formatDate(c.fecha)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className="text-sm font-medium"
                            style={{ color: "hsl(var(--foreground))" }}
                          >
                            {c.cliente_nombre || "Sin nombre"}
                          </span>
                          {esteError && (
                            <p
                              className="text-xs mt-0.5"
                              style={{ color: "hsl(var(--destructive))" }}
                            >
                              {esteError}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusBadge status={c.estado} />
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className="text-xs"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            {c.vendedor?.nombre ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className="text-xs"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            {c.vigencia_dias}d
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className="text-sm font-semibold tabular-nums"
                            style={{ color: "hsl(var(--foreground))" }}
                          >
                            {formatCOP(c.total)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          {puedeConvertir && (
                            <button
                              onClick={(e) => convertirEnVenta(e, c.id)}
                              disabled={convirtiendo === c.id}
                              className="h-8 px-3 rounded-lg text-xs font-medium border transition-all disabled:opacity-50 cursor-pointer whitespace-nowrap"
                              style={{
                                borderColor: "hsl(var(--primary) / 0.4)",
                                color: "hsl(var(--primary))",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor =
                                  "hsl(var(--primary) / 0.08)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = "";
                              }}
                            >
                              {convirtiendo === c.id
                                ? "Convirtiendo..."
                                : "→ Venta"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Cargar más */}
        {hasMore && !busqueda && (
          <button
            onClick={() => cargarCotizaciones(false)}
            disabled={loading}
            className="mt-4 w-full py-3 rounded-xl text-sm font-medium border transition-all disabled:opacity-50 cursor-pointer"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
              backgroundColor: "hsl(var(--card))",
            }}
          >
            {loading ? "Cargando..." : "Cargar más"}
          </button>
        )}

        {!loading && !hasMore && cotizaciones.length > 0 && (
          <p
            className="text-center text-xs py-4"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            — {cotizaciones.length} cotizaciones —
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── Íconos locales ── */
function PlusIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SearchIcon({ className = "", style }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="m10.5 10.5 2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
