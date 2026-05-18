import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatDate } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";

const FILTROS = ["Todas", "Cliente", "Proveedor"];
const PAGE_SIZE = 20;

export default function DevolucionHistorial() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [devoluciones, setDevoluciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("Todas");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  // Token de secuencia: descarta respuestas obsoletas (cambio de filtro
  // mientras hay una carga en vuelo) para no mezclar resultados.
  const reqIdRef = useRef(0);

  const cargarDevoluciones = async (reset = false) => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setErrorMsg(null);
    const currentPage = reset ? 0 : page;
    try {
      let query = supabase
        .from("devoluciones")
        .select(
          `id, numero, fecha, reingresa_stock, cantidad, motivo, estado,
           producto:producto_id(nombre, referencia),
           registrador:registrado_por(nombre)`,
        )
        .order("fecha", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (perfil?.rol !== "Admin") query = query.eq("sede_id", perfil?.sede_id);
      // La tabla usa reingresa_stock BOOLEAN (true=cliente, false=proveedor)
      if (filtro === "Cliente") query = query.eq("reingresa_stock", true);
      if (filtro === "Proveedor") query = query.eq("reingresa_stock", false);

      const { data, error } = await query;
      if (myReq !== reqIdRef.current) return; // respuesta obsoleta
      if (error) throw error;

      if (reset) {
        setDevoluciones(data ?? []);
        setPage(1);
      } else {
        setDevoluciones((prev) => [...prev, ...(data ?? [])]);
        setPage((p) => p + 1);
      }
      setHasMore((data ?? []).length === PAGE_SIZE);
    } catch {
      if (myReq === reqIdRef.current)
        setErrorMsg("No se pudieron cargar las devoluciones. Reintenta.");
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargarDevoluciones(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);

  // reingresa_stock=true → devolución de cliente (suma stock)
  // reingresa_stock=false → devolución a proveedor (resta stock)
  const tipoLabel = (reingresa) => (reingresa ? "De cliente" : "A proveedor");

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Devoluciones"
        description={
          !loading
            ? `${devoluciones.length}${hasMore ? "+" : ""} registros`
            : "Cargando…"
        }
        actions={
          <button
            onClick={() => navigate("/ops/devoluciones/nueva")}
            className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium transition-opacity cursor-pointer"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            <PlusIcon />
            Nueva devolución
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

      {errorMsg && (
        <div
          role="alert"
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

      {/* Contenido */}
      {loading && devoluciones.length === 0 ? (
        <SkeletonList />
      ) : devoluciones.length === 0 ? (
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
                    "Tipo",
                    "Producto",
                    "Cantidad",
                    "Motivo",
                    "Estado",
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
                {devoluciones.map((d, idx) => (
                  <tr
                    key={d.id}
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
                        #{d.numero}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <span
                        className="text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {formatDate(d.fecha)}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <span
                        className="text-xs font-medium px-2 py-0.5 rounded-full"
                        style={
                          d.reingresa_stock === true
                            ? {
                                backgroundColor: "hsl(var(--info) / 0.1)",
                                color: "hsl(var(--info))",
                              }
                            : {
                                backgroundColor: "hsl(var(--warning) / 0.1)",
                                color: "hsl(var(--warning))",
                              }
                        }
                      >
                        {tipoLabel(d.reingresa_stock)}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <p
                        className="text-sm font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {d.producto?.nombre ?? "—"}
                      </p>
                      <p
                        className="text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {d.producto?.referencia ?? ""}
                      </p>
                    </td>
                    <td className="px-3 py-3.5">
                      <span
                        className="font-semibold tabular-nums"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {d.reingresa_stock === true ? "+" : "−"}
                        {d.cantidad}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <span
                        className="text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {d.motivo ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <StatusBadge status={d.estado} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="md:hidden space-y-2.5" role="list">
            {devoluciones.map((d) => (
              <li key={d.id}>
                <div
                  className="rounded-xl px-4 py-4 border"
                  style={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                  }}
                >
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="text-xs font-bold font-mono"
                        style={{ color: "hsl(var(--primary))" }}
                      >
                        #{d.numero}
                      </span>
                      <span
                        className="text-xs font-medium px-2 py-0.5 rounded-full"
                        style={
                          d.reingresa_stock === true
                            ? {
                                backgroundColor: "hsl(var(--info) / 0.1)",
                                color: "hsl(var(--info))",
                              }
                            : {
                                backgroundColor: "hsl(var(--warning) / 0.1)",
                                color: "hsl(var(--warning))",
                              }
                        }
                      >
                        {tipoLabel(d.reingresa_stock)}
                      </span>
                      <StatusBadge status={d.estado} />
                    </div>
                    <span
                      className="font-bold text-base tabular-nums shrink-0"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {d.reingresa_stock === true ? "+" : "−"}
                      {d.cantidad}
                    </span>
                  </div>
                  <p
                    className="text-sm font-medium"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {d.producto?.nombre ?? "—"}
                  </p>
                  <p
                    className="text-xs mt-0.5"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {formatDate(d.fecha)}
                    {d.motivo && ` · ${d.motivo}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          {hasMore && (
            <button
              onClick={() => cargarDevoluciones(false)}
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
              className="w-16 h-6 rounded"
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
      <div className="text-5xl mb-4">↩️</div>
      <p className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>
        Sin devoluciones registradas
      </p>
      <p
        className="text-sm mt-1"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        Las devoluciones aparecerán aquí una vez registradas
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
