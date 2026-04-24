import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";

const FILTROS = ["Todas", "Registrada", "Recibida"];
const PAGE_SIZE = 20;

export default function CompraHistorial() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const puedeRecibirCompra =
    perfil?.rol === "Admin" || perfil?.rol === "Bodeguero";

  const [compras, setCompras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("Todas");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [recibiendoId, setRecibiendoId] = useState(null);

  const cargarCompras = async (reset = false) => {
    setLoading(true);
    const currentPage = reset ? 0 : page;
    try {
      let query = supabase
        .from("compras")
        .select(
          `id, numero, fecha, proveedor, factura_proveedor, total, recibida,
           registrador:registrado_por(nombre)`,
        )
        .order("fecha", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (perfil?.rol !== "Admin")
        query = query.eq("sede_destino_id", perfil.sede_id);
      if (filtro === "Registrada") query = query.eq("recibida", false);
      if (filtro === "Recibida") query = query.eq("recibida", true);

      const { data, error } = await query;
      if (error) throw error;

      if (reset) {
        setCompras(data ?? []);
        setPage(1);
      } else {
        setCompras((prev) => [...prev, ...(data ?? [])]);
        setPage((p) => p + 1);
      }
      setHasMore((data ?? []).length === PAGE_SIZE);
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarCompras(true);
  }, [filtro]);

  const marcarRecibida = async (compraId) => {
    setRecibiendoId(compraId);
    try {
      const { error } = await supabase
        .from("compras")
        .update({ recibida: true, fecha_recepcion: new Date().toISOString() })
        .eq("id", compraId);
      if (error) throw error;
      setCompras((prev) =>
        prev.map((c) => (c.id === compraId ? { ...c, recibida: true } : c)),
      );
    } catch {
      // ignore
    } finally {
      setRecibiendoId(null);
    }
  };

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Compras"
        description={
          !loading
            ? `${compras.length}${hasMore ? "+" : ""} registros`
            : "Cargando…"
        }
        actions={
          <button
            onClick={() => navigate("/ops/compras/nueva")}
            className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium transition-opacity cursor-pointer"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            <PlusIcon />
            Nueva compra
          </button>
        }
      />

      {/* Filtros */}
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

      {/* Contenido */}
      {loading && compras.length === 0 ? (
        <SkeletonList />
      ) : compras.length === 0 ? (
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
                    "Proveedor",
                    "Factura",
                    "Total",
                    "Estado",
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
                {compras.map((c, idx) => (
                  <tr
                    key={c.id}
                    style={{
                      borderTop:
                        idx === 0
                          ? "none"
                          : "1px solid hsl(var(--border) / 0.5)",
                    }}
                  >
                    <td className="px-3 py-3.5">
                      <span
                        className="text-xs font-bold font-mono"
                        style={{ color: "hsl(var(--primary))" }}
                      >
                        #{c.numero}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <span
                        className="text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {formatDate(c.fecha)}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <span
                        className="text-sm font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {c.proveedor}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <span
                        className="text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {c.factura_proveedor ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <span
                        className="font-bold tabular-nums"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {formatCOP(c.total)}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <StatusBadge
                        status={c.recibida ? "recibida" : "pendiente"}
                      />
                    </td>
                    <td className="px-3 py-3.5">
                      {!c.recibida && puedeRecibirCompra && (
                        <button
                          onClick={() => marcarRecibida(c.id)}
                          disabled={recibiendoId === c.id}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all disabled:opacity-50 cursor-pointer whitespace-nowrap"
                          style={{
                            borderColor: "hsl(var(--success))",
                            color: "hsl(var(--success))",
                            backgroundColor: "hsl(var(--success) / 0.05)",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.backgroundColor =
                              "hsl(var(--success) / 0.15)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor =
                              "hsl(var(--success) / 0.05)")
                          }
                        >
                          {recibiendoId === c.id ? "..." : "Marcar recibida"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="md:hidden space-y-2.5" role="list">
            {compras.map((c) => (
              <li key={c.id}>
                <div
                  className="rounded-xl px-4 py-4 border"
                  style={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                  }}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span
                          className="text-xs font-bold font-mono"
                          style={{ color: "hsl(var(--primary))" }}
                        >
                          #{c.numero}
                        </span>
                        <StatusBadge
                          status={c.recibida ? "recibida" : "pendiente"}
                        />
                      </div>
                      <p
                        className="text-sm font-medium truncate"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {c.proveedor}
                      </p>
                      <p
                        className="text-xs mt-0.5"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {formatDate(c.fecha)}
                        {c.factura_proveedor &&
                          ` · Fact: ${c.factura_proveedor}`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className="font-bold text-base tabular-nums"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {formatCOP(c.total)}
                      </p>
                    </div>
                  </div>
                  {!c.recibida && puedeRecibirCompra && (
                    <button
                      onClick={() => marcarRecibida(c.id)}
                      disabled={recibiendoId === c.id}
                      className="w-full mt-1 py-2.5 rounded-lg text-sm font-medium border transition-all disabled:opacity-50 cursor-pointer"
                      style={{
                        borderColor: "hsl(var(--success))",
                        color: "hsl(var(--success))",
                        backgroundColor: "hsl(var(--success) / 0.05)",
                      }}
                    >
                      {recibiendoId === c.id
                        ? "Procesando..."
                        : "Marcar como recibida"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {hasMore && (
            <button
              onClick={() => cargarCompras(false)}
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
              className="w-24 h-6 rounded"
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
      <div className="text-5xl mb-4">📦</div>
      <p className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>
        Sin compras registradas
      </p>
      <p
        className="text-sm mt-1"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        Las órdenes de compra aparecerán aquí
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
