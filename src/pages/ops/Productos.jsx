import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, X, Package } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../stores/authStore";
import { useDebounce } from "../../hooks/useDebounce";
import StatusBadge from "../../components/ui/StatusBadge";
import TipoProductoBadge from "../../components/inventario/TipoProductoBadge";
import { formatCOP, safeError } from "../../lib/utils";
import { applyKeywordSearch } from "../../lib/search";
import { categoriaClass } from "../../lib/inventario-ui";

const PAGE_SIZE = 30;

// Columnas del producto maestro — mismas que consulta ProductoDetalle.jsx
// (catálogo, sin stock por sede).
const SELECT_COLS =
  "id, referencia, codigo_interno, codigo_proveedor, tipo, nombre, " +
  "categoria, marca, modelo, precio_venta, unidad_medida, activo";

/**
 * Catálogo maestro de productos — una fila por producto (sin stock por sede).
 * Lee la tabla real `productos` respetando RLS (sesión authenticated).
 */
export default function Productos() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [soloActivos, setSoloActivos] = useState(true);

  const debouncedBusqueda = useDebounce(busqueda, 400);

  // Token de versión para descartar respuestas obsoletas (carrera de filtros).
  const fetchTokenRef = useRef(0);
  const pageRef = useRef(0);

  const fetchProductos = useCallback(
    async (append) => {
      const token = ++fetchTokenRef.current;
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        pageRef.current = 0;
      }
      setError(null);

      try {
        const offset = append ? pageRef.current * PAGE_SIZE : 0;
        let q = supabase
          .from("productos")
          .select(SELECT_COLS)
          .order("nombre", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        if (soloActivos) q = q.eq("activo", true);

        // #32: búsqueda por palabras clave en nombre/referencia/códigos.
        if (debouncedBusqueda.trim()) {
          q = applyKeywordSearch(q, debouncedBusqueda, [
            "nombre",
            "referencia",
            "codigo_interno",
            "codigo_proveedor",
          ]);
        }

        const { data, error: qErr } = await q;
        if (qErr) throw qErr;

        // Descarta si llegó una respuesta más nueva mientras esperábamos.
        if (token !== fetchTokenRef.current) return;

        const rows = data ?? [];
        if (append) {
          setItems((prev) => [...prev, ...rows]);
          pageRef.current += 1;
        } else {
          setItems(rows);
          pageRef.current = 1;
        }
        setHasMore(rows.length === PAGE_SIZE);
      } catch (err) {
        if (token !== fetchTokenRef.current) return;
        setError(safeError(err, "No se pudo cargar el catálogo"));
        if (!append) setItems([]);
        setHasMore(false);
      } finally {
        if (token === fetchTokenRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [debouncedBusqueda, soloActivos],
  );

  // Re-fetch al cambiar búsqueda (debounced) o filtro de activos.
  useEffect(() => {
    fetchProductos(false);
  }, [fetchProductos]);

  const loadMore = useCallback(() => {
    if (hasMore && !loadingMore && !loading) fetchProductos(true);
  }, [hasMore, loadingMore, loading, fetchProductos]);

  // Infinite scroll
  const sentinelRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => {
      observer.unobserve(el);
      observer.disconnect();
    };
  }, [loadMore]);

  const handleItemClick = (id) => {
    if (id) navigate(`/ops/inventario/${id}`);
  };

  // Bloque 1 (#4): crear producto es exclusivo de Admin.
  const esAdmin = perfil?.rol === "Admin";

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-[18px] px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ color: "var(--n-300)" }}
          >
            Operaciones · Catálogo maestro ·{" "}
            {loading
              ? "cargando…"
              : `${items.length}${hasMore ? "+" : ""} productos`}{" "}
            · {soloActivos ? "activos" : "todos"}
          </p>
          <h1
            className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.018em]"
            style={{ color: "var(--n-950)" }}
          >
            Productos
          </h1>
        </div>
        {esAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/ops/inventario/nuevo")}
              className="btn btn-pri"
              style={{ height: 48 }}
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              Nuevo producto
            </button>
          </div>
        )}
      </div>

      {/* ── Búsqueda ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-12 flex-1 items-center gap-2.5 rounded-lg border px-3.5"
          style={{ borderColor: "var(--n-200)", backgroundColor: "var(--n-0)" }}
        >
          <Search
            className="h-4 w-4 shrink-0"
            strokeWidth={1.5}
            style={{ color: "var(--n-500)" }}
          />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o referencia…"
            className="flex-1 border-none bg-transparent text-[14px] outline-none"
            style={{ color: "var(--n-950)" }}
          />
          {busqueda && (
            <button
              onClick={() => setBusqueda("")}
              aria-label="Limpiar búsqueda"
              className="grid h-6 w-6 place-items-center rounded"
              style={{ color: "var(--n-500)" }}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>

      {/* ── Grid: filtros + tabla ───────────────────────────────────── */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Panel de filtros */}
        <aside
          className="flex flex-col gap-4 self-start rounded-[10px] border p-3.5 text-[12.5px]"
          style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
        >
          <div>
            <div
              className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
              style={{ color: "var(--n-500)" }}
            >
              Estado
            </div>
            <div className="flex flex-col gap-px">
              <FilterRow on={soloActivos} onClick={() => setSoloActivos(true)}>
                <Check on={soloActivos} />
                Solo activos
              </FilterRow>
              <FilterRow
                on={!soloActivos}
                onClick={() => setSoloActivos(false)}
              >
                <Check on={!soloActivos} />
                Incluir inactivos
              </FilterRow>
            </div>
          </div>
        </aside>

        {/* Contenido */}
        <div className="min-w-0">
          {error && (
            <div
              className="mb-3 rounded-[10px] border p-4"
              style={{
                backgroundColor: "var(--dang-50)",
                borderColor: "var(--dang-border)",
              }}
            >
              <p
                className="text-sm font-medium"
                style={{ color: "var(--dang-700)" }}
              >
                Error al cargar el catálogo
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--dang-600)" }}>
                {error}
              </p>
            </div>
          )}

          {loading && <SkeletonList />}

          {!loading && items.length === 0 && !error && (
            <EmptyState filtroBusqueda={debouncedBusqueda} />
          )}

          {!loading && items.length > 0 && (
            <>
              {/* Móvil/Tablet: cards (< md) */}
              <ul className="md:hidden space-y-2.5" role="list">
                {items.map((p) => (
                  <li key={p.id}>
                    <ProductoCard
                      producto={p}
                      onClick={() => handleItemClick(p.id)}
                    />
                  </li>
                ))}
              </ul>

              {/* Desktop: tabla (≥ md) */}
              <div
                className="hidden md:block min-w-0 overflow-hidden rounded-[10px] border"
                style={{
                  borderColor: "var(--n-150)",
                  backgroundColor: "var(--n-0)",
                }}
              >
                <div
                  className="flex flex-wrap items-center gap-3 border-b px-4 py-3 text-[12.5px]"
                  style={{ borderColor: "var(--n-100)", color: "var(--n-500)" }}
                >
                  <span>
                    <strong
                      className="font-mono font-semibold"
                      style={{ color: "var(--n-950)" }}
                    >
                      {items.length}
                      {hasMore ? "+" : ""}
                    </strong>{" "}
                    productos
                  </span>
                  <span>·</span>
                  <span>{soloActivos ? "activos" : "todos"}</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr>
                        <Th width={140}>Referencia</Th>
                        <Th>Producto</Th>
                        <Th width={130}>Categoría</Th>
                        <Th width={150}>Marca / Modelo</Th>
                        <Th width={110}>Estado</Th>
                        <Th width={120} right>
                          Precio
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((p) => (
                        <ProductoFila
                          key={p.id}
                          producto={p}
                          onClick={() => handleItemClick(p.id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Sentinel infinite scroll */}
          <div ref={sentinelRef} className="h-4" />

          {loadingMore && (
            <div className="flex justify-center py-4">
              <div
                className="h-6 w-6 animate-spin rounded-full border-2"
                style={{
                  borderColor: "var(--p-200)",
                  borderTopColor: "var(--p-600)",
                }}
              />
            </div>
          )}

          {!loading && !loadingMore && !hasMore && items.length > 0 && (
            <p
              className="py-4 text-center font-mono text-[11px]"
              style={{ color: "var(--n-300)" }}
            >
              — {items.length} productos —
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function Th({ children, width, right }) {
  return (
    <th
      style={{ width, backgroundColor: "var(--n-50)", color: "var(--n-500)" }}
      className={
        "border-b px-2.5 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] " +
        (right ? "text-right" : "text-left")
      }
    >
      {children}
    </th>
  );
}

function Td({ children, right }) {
  return (
    <td
      className={"border-b px-2.5 py-2.5 " + (right ? "text-right" : "")}
      style={{ borderColor: "var(--n-100)" }}
    >
      {children}
    </td>
  );
}

function FilterRow({ on, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={
        "relative flex min-h-[44px] items-center justify-between gap-1.5 rounded-[5px] px-2 py-2.5 text-left text-[12.5px] leading-tight transition-colors lg:min-h-0 lg:py-1.5 " +
        (on
          ? "font-medium before:absolute before:left-[-8px] before:top-1 before:bottom-1 before:w-[2.5px] before:rounded-[1px]"
          : "")
      }
      style={
        on
          ? { backgroundColor: "var(--p-50)", color: "var(--p-700)" }
          : { color: "var(--n-700)" }
      }
      onMouseEnter={(e) => {
        if (!on) e.currentTarget.style.backgroundColor = "var(--n-50)";
      }}
      onMouseLeave={(e) => {
        if (!on) e.currentTarget.style.backgroundColor = "";
      }}
    >
      <span className="flex min-w-0 items-center gap-2">{children}</span>
      {on && (
        <span
          aria-hidden="true"
          className="absolute left-[-8px] top-1 bottom-1 w-[2.5px] rounded-[1px]"
          style={{ backgroundColor: "var(--p-500)" }}
        />
      )}
    </button>
  );
}

function Check({ on }) {
  return (
    <span
      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border-[1.5px]"
      style={
        on
          ? {
              borderColor: "var(--p-600)",
              backgroundColor: "var(--p-600)",
              color: "#fff",
            }
          : { borderColor: "var(--n-300)", backgroundColor: "var(--n-0)" }
      }
    >
      {on && <span className="text-[9px] font-bold leading-none">✓</span>}
    </span>
  );
}

function marcaModelo(p) {
  const parts = [p.marca, p.modelo].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

function ProductoFila({ producto: p, onClick }) {
  const inactivo = !p.activo;
  const ref = p.codigo_interno ?? p.referencia ?? "—";
  return (
    <tr
      onClick={onClick}
      className="cursor-pointer transition-colors"
      onMouseEnter={(e) =>
        (e.currentTarget.style.backgroundColor = "var(--n-50)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
    >
      <Td>
        <span
          className="whitespace-nowrap font-mono text-[12.5px] font-medium tracking-[-0.005em]"
          style={{ color: inactivo ? "var(--n-300)" : "var(--n-950)" }}
          title={
            p.codigo_proveedor ? `Proveedor: ${p.codigo_proveedor}` : undefined
          }
        >
          {ref}
          {p.codigo_proveedor && (
            <span style={{ color: "var(--n-300)" }}>
              {" "}
              / {p.codigo_proveedor}
            </span>
          )}
        </span>
      </Td>
      <Td>
        <div
          className={
            "font-medium leading-tight " + (inactivo ? "opacity-60" : "")
          }
          style={{ color: "var(--n-950)" }}
        >
          {p.nombre}
          <span
            className="mt-px block font-mono text-[11px] font-normal tracking-[0.04em]"
            style={{ color: "var(--n-500)" }}
          >
            {p.referencia ?? "—"}
          </span>
        </div>
      </Td>
      <Td>
        <span className={`bdg ${categoriaClass(p.categoria)}`}>
          {p.categoria ?? "—"}
        </span>
      </Td>
      <Td>
        <span style={{ color: "var(--n-700)" }}>{marcaModelo(p)}</span>
      </Td>
      <Td>
        <div className="flex items-center gap-1.5">
          {p.activo ? (
            <StatusBadge status="success">Activo</StatusBadge>
          ) : (
            <StatusBadge status="neutral">Inactivo</StatusBadge>
          )}
          <TipoProductoBadge tipo={p.tipo} />
        </div>
      </Td>
      <Td right>
        <span
          className="font-mono font-medium"
          style={{ color: inactivo ? "var(--n-300)" : "var(--n-950)" }}
        >
          {p.precio_venta != null ? formatCOP(p.precio_venta) : "—"}
        </span>
      </Td>
    </tr>
  );
}

function ProductoCard({ producto: p, onClick }) {
  const inactivo = !p.activo;
  const ref = p.codigo_interno ?? p.referencia ?? "—";
  return (
    <button
      onClick={onClick}
      className="w-full rounded-[10px] border px-4 py-3.5 text-left shadow-sm transition-all duration-100 active:scale-[0.985] active:shadow-none"
      style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className={
              "truncate text-[14px] font-medium leading-tight " +
              (inactivo ? "opacity-60" : "")
            }
            style={{ color: "var(--n-950)" }}
          >
            {p.nombre}
          </p>
          <p
            className="mt-0.5 font-mono text-[11px] tracking-[0.04em]"
            style={{ color: "var(--n-500)" }}
          >
            {ref}
            {p.codigo_proveedor && (
              <span style={{ opacity: 0.7 }}> · {p.codigo_proveedor}</span>
            )}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`bdg ${categoriaClass(p.categoria)}`}>
              {p.categoria ?? "—"}
            </span>
            <span className="text-[11px]" style={{ color: "var(--n-500)" }}>
              {marcaModelo(p)}
            </span>
          </div>
          {p.precio_venta != null && (
            <p
              className="mt-1.5 font-mono text-[13px] font-semibold"
              style={{ color: "var(--n-950)" }}
            >
              {formatCOP(p.precio_venta)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {p.activo ? (
            <StatusBadge status="success">Activo</StatusBadge>
          ) : (
            <StatusBadge status="neutral">Inactivo</StatusBadge>
          )}
          <TipoProductoBadge tipo={p.tipo} />
        </div>
      </div>
    </button>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-3">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-[10px] border p-4"
          style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
        >
          <div className="flex justify-between">
            <div className="flex-1 space-y-2">
              <div
                className="h-4 w-3/4 rounded"
                style={{ backgroundColor: "var(--n-100)" }}
              />
              <div
                className="h-3 w-1/2 rounded"
                style={{ backgroundColor: "var(--n-100)" }}
              />
              <div
                className="h-3 w-1/3 rounded"
                style={{ backgroundColor: "var(--n-100)" }}
              />
            </div>
            <div
              className="ml-3 h-12 w-12 rounded-lg"
              style={{ backgroundColor: "var(--n-100)" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ filtroBusqueda }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div
        className="mb-4 grid h-14 w-14 place-items-center rounded-[12px]"
        style={{ backgroundColor: "var(--p-50)", color: "var(--p-600)" }}
      >
        <Package className="h-7 w-7" strokeWidth={1.5} />
      </div>
      <p className="font-semibold" style={{ color: "var(--n-950)" }}>
        Sin resultados
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--n-500)" }}>
        {filtroBusqueda
          ? `No se encontraron productos para "${filtroBusqueda}"`
          : "No hay productos en el catálogo"}
      </p>
    </div>
  );
}
