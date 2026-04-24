import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useInventario } from "../../hooks/useInventario";
import { useRealtimeInventario } from "../../hooks/useRealtime";
import { useAuthStore } from "../../stores/authStore";
import StatusBadge from "../../components/ui/StatusBadge";
import PageHeader from "../../components/layout/PageHeader";
import QRScanner from "../../components/forms/QRScanner";
import { SEDES } from "../../lib/constants";
import { formatCOP } from "../../lib/utils";

const ESTADOS = ["OK", "Bajo", "Agotado"];

const SEDE_LABELS = {
  [SEDES.BOD_PRINCIPAL]: "Bodega Principal",
  [SEDES.ALM_01]: "Almacén 01",
  [SEDES.ALM_02]: "Almacén 02",
  [SEDES.ALM_03]: "Almacén 03",
};

export default function Inventario() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const [scannerOpen, setScannerOpen] = useState(false);

  const {
    items,
    loading,
    loadingMore,
    hasMore,
    error,
    filtroSede,
    filtroEstado,
    filtroBusqueda,
    setFiltros,
    setBusqueda,
    loadMore,
  } = useInventario();

  // Suscripción Realtime
  useRealtimeInventario();

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
    return () => observer.disconnect();
  }, [loadMore]);

  const handleScanFound = useCallback(
    (productoId) => {
      setScannerOpen(false);
      navigate(`/ops/inventario/${productoId}`);
    },
    [navigate],
  );

  const handleItemClick = (productoId) => {
    navigate(`/ops/inventario/${productoId}`);
  };

  const esVendedor = perfil?.rol === "Vendedor";

  const sedeLabel = filtroSede ? SEDE_LABELS[filtroSede] : "Todas las sedes";

  return (
    <div
      className="flex flex-col min-h-full p-4 sm:p-6 space-y-4"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      {/* ── PageHeader ───────────────────────────────────────────────────── */}
      <PageHeader
        title="Inventario"
        description={
          loading
            ? "Cargando…"
            : `${items.length}${hasMore ? "+" : ""} productos · ${sedeLabel}`
        }
        actions={
          <>
            <button
              onClick={() => setScannerOpen(true)}
              className="flex items-center gap-2 h-9 px-3 rounded-lg border text-sm font-medium transition-all cursor-pointer"
              style={{
                borderColor: "hsl(var(--border))",
                backgroundColor: "hsl(var(--card))",
                color: "hsl(var(--foreground))",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "hsl(var(--primary) / 0.4)";
                e.currentTarget.style.backgroundColor =
                  "hsl(var(--primary) / 0.05)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "hsl(var(--border))";
                e.currentTarget.style.backgroundColor = "hsl(var(--card))";
              }}
            >
              <QRSmallIcon />
              <span className="hidden sm:inline">Escanear QR</span>
            </button>
            {!esVendedor && (
              <button
                onClick={() => navigate("/ops/inventario/nuevo")}
                className="flex items-center gap-2 h-9 px-3 rounded-lg text-sm font-medium transition-all cursor-pointer"
                style={{
                  backgroundColor: "hsl(var(--primary))",
                  color: "hsl(var(--primary-foreground))",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                <PlusIcon />
                <span className="hidden sm:inline">Nuevo producto</span>
              </button>
            )}
          </>
        }
      />

      {/* ── Barra de filtros ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Búsqueda */}
        <div className="relative flex-1 min-w-[180px]">
          <SearchIcon
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "hsl(var(--muted-foreground))" }}
          />
          <input
            type="search"
            placeholder="Buscar por nombre o referencia…"
            value={filtroBusqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full pl-9 pr-4 h-9 rounded-lg border text-sm
                       focus:outline-none transition-all"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          />
          {filtroBusqueda && (
            <button
              onClick={() => setBusqueda("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer"
              style={{ color: "hsl(var(--muted-foreground))" }}
              aria-label="Limpiar búsqueda"
            >
              <XSmallIcon />
            </button>
          )}
        </div>

        {/* Sede selector */}
        {!esVendedor && (
          <select
            value={filtroSede ?? ""}
            onChange={(e) => setFiltros({ filtroSede: e.target.value || null })}
            className="h-9 text-sm rounded-lg border px-3 cursor-pointer
                       focus:outline-none transition-all"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          >
            <option value="">Todas las sedes</option>
            {Object.entries(SEDE_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        )}

        {/* Chips de estado */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setFiltros({ filtroEstado: null })}
            className="h-9 px-3 rounded-lg text-xs font-semibold border transition-all cursor-pointer"
            style={
              !filtroEstado
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
            Todos
          </button>

          {ESTADOS.map((estado) => {
            const active = filtroEstado === estado;
            const activeColors = {
              OK: {
                backgroundColor: "hsl(var(--success))",
                color: "hsl(var(--success-foreground))",
                borderColor: "hsl(var(--success))",
              },
              Bajo: {
                backgroundColor: "hsl(var(--warning))",
                color: "hsl(var(--warning-foreground))",
                borderColor: "hsl(var(--warning))",
              },
              Agotado: {
                backgroundColor: "hsl(var(--destructive))",
                color: "hsl(var(--destructive-foreground))",
                borderColor: "hsl(var(--destructive))",
              },
            };
            const labels = {
              OK: "Disponible",
              Bajo: "Stock bajo",
              Agotado: "Agotado",
            };
            return (
              <button
                key={estado}
                onClick={() =>
                  setFiltros({ filtroEstado: active ? null : estado })
                }
                className="h-9 px-3 rounded-lg text-xs font-semibold border transition-all cursor-pointer"
                style={
                  active
                    ? activeColors[estado]
                    : {
                        backgroundColor: "hsl(var(--card))",
                        color: "hsl(var(--muted-foreground))",
                        borderColor: "hsl(var(--border))",
                      }
                }
              >
                {labels[estado]}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Contenido ────────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        {/* Error */}
        {error && (
          <div
            className="p-4 rounded-xl border"
            style={{
              backgroundColor: "hsl(var(--destructive) / 0.05)",
              borderColor: "hsl(var(--destructive) / 0.2)",
            }}
          >
            <p
              className="text-sm font-medium"
              style={{ color: "hsl(var(--destructive))" }}
            >
              Error al cargar inventario
            </p>
            <p
              className="text-xs mt-1"
              style={{ color: "hsl(var(--destructive) / 0.7)" }}
            >
              {error}
            </p>
          </div>
        )}

        {/* Loading inicial */}
        {loading && (
          <div className="flex flex-col gap-3">
            {[...Array(6)].map((_, i) => (
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
                      className="h-4 rounded w-3/4"
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
                    className="w-12 h-12 rounded-lg ml-3"
                    style={{ backgroundColor: "hsl(var(--muted))" }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sin resultados */}
        {!loading && items.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
            <div className="text-5xl mb-4">📦</div>
            <p
              className="font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Sin resultados
            </p>
            <p
              className="text-sm mt-1"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {filtroBusqueda
                ? `No se encontraron productos para "${filtroBusqueda}"`
                : "No hay productos con los filtros seleccionados"}
            </p>
          </div>
        )}

        {/* ── Vista MÓVIL: Cards (< md) ─────────────────────────────── */}
        {!loading && items.length > 0 && (
          <>
            <ul className="md:hidden space-y-2.5" role="list">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => handleItemClick(item.producto?.id)}
                    className="w-full text-left rounded-xl px-4 py-3.5 border
                               shadow-sm active:scale-[0.985] active:shadow-none
                               transition-all duration-100 cursor-pointer"
                    style={{
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      {/* Info izquierda */}
                      <div className="flex-1 min-w-0">
                        <p
                          className="font-semibold text-sm leading-tight truncate"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {item.producto?.nombre}
                        </p>
                        <p
                          className="text-xs mt-0.5 font-mono"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {item.producto?.referencia}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span
                            className="text-[11px]"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            {item.sede?.nombre}
                          </span>
                          {item.producto?.marca && (
                            <>
                              <span style={{ color: "hsl(var(--border))" }}>
                                ·
                              </span>
                              <span
                                className="text-[11px]"
                                style={{
                                  color: "hsl(var(--muted-foreground))",
                                }}
                              >
                                {item.producto.marca}
                              </span>
                            </>
                          )}
                          {item.producto?.categoria && (
                            <>
                              <span style={{ color: "hsl(var(--border))" }}>
                                ·
                              </span>
                              <span
                                className="text-[11px]"
                                style={{
                                  color: "hsl(var(--muted-foreground))",
                                }}
                              >
                                {item.producto.categoria}
                              </span>
                            </>
                          )}
                        </div>
                        {item.producto?.precio_venta != null && (
                          <p
                            className="text-xs font-semibold mt-1"
                            style={{ color: "hsl(var(--foreground))" }}
                          >
                            {formatCOP(item.producto.precio_venta)}
                          </p>
                        )}
                      </div>
                      {/* Stock + badge derecha */}
                      <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                        <span
                          className="text-2xl font-bold leading-none"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {item.cantidad}
                        </span>
                        <StatusBadge status={item.estado_stock} />
                      </div>
                    </div>
                    {/* Barra de progreso de stock */}
                    <StockBar
                      cantidad={item.cantidad}
                      minimo={item.producto?.stock_minimo ?? 0}
                      maximo={item.producto?.stock_maximo ?? 0}
                      estado={item.estado_stock}
                    />
                  </button>
                </li>
              ))}
            </ul>

            {/* ── Vista DESKTOP: Tabla (≥ md) ─────────────────────────── */}
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
                      "Referencia",
                      "Nombre",
                      "Marca",
                      "Categoría",
                      "Sede",
                      "Precio",
                      "Stock",
                      "Mín / Máx",
                      "Estado",
                    ].map((col) => (
                      <th
                        key={col}
                        className="px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap text-left"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr
                      key={item.id}
                      onClick={() => handleItemClick(item.producto?.id)}
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
                          className="font-mono text-xs"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {item.producto?.referencia}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className="text-sm font-medium"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {item.producto?.nombre}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className="text-xs"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {item.producto?.marca ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className="text-xs"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {item.producto?.categoria}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className="text-xs"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {item.sede?.nombre}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className="text-sm font-semibold tabular-nums"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {item.producto?.precio_venta != null
                            ? formatCOP(item.producto.precio_venta)
                            : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className="text-base font-bold tabular-nums"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {item.cantidad}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className="text-xs tabular-nums"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {item.producto?.stock_minimo} /{" "}
                          {item.producto?.stock_maximo}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={item.estado_stock} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Sentinel infinite scroll */}
        <div ref={sentinelRef} className="h-4" />

        {/* Loading more */}
        {loadingMore && (
          <div className="flex justify-center py-4">
            <div
              className="w-6 h-6 border-2 rounded-full animate-spin"
              style={{
                borderColor: "hsl(var(--primary) / 0.2)",
                borderTopColor: "hsl(var(--primary))",
              }}
            />
          </div>
        )}

        {/* Fin de la lista */}
        {!loading && !loadingMore && !hasMore && items.length > 0 && (
          <p
            className="text-center text-xs py-4"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            — {items.length} productos —
          </p>
        )}
      </div>

      {/* ── Botón flotante QR Scanner ────────────────────────────────────── */}
      <button
        onClick={() => setScannerOpen(true)}
        aria-label="Abrir escáner QR"
        className="fixed right-5 bottom-24 sm:bottom-6 z-20
                   w-14 h-14 rounded-full shadow-lg
                   flex items-center justify-center
                   transition-all duration-200 active:scale-95 cursor-pointer"
        style={{ backgroundColor: "hsl(var(--primary))" }}
      >
        <QRFloatIcon />
      </button>

      {/* ── Modal QR Scanner ─────────────────────────────────────────────── */}
      {scannerOpen && (
        <QRScanner
          onFound={handleScanFound}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  );
}

/* ─── Componentes locales ────────────────────────────────────────────── */

function StockBar({ cantidad, minimo, maximo, estado }) {
  if (!maximo) return null;
  const pct = Math.min(100, Math.round((cantidad / maximo) * 100));
  const color =
    estado === "OK"
      ? "hsl(var(--success))"
      : estado === "Bajo"
        ? "hsl(var(--warning))"
        : "hsl(var(--destructive))";
  return (
    <div
      className="mt-2 h-1 rounded-full overflow-hidden"
      style={{ backgroundColor: "hsl(var(--muted))" }}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

function SearchIcon({ className = "" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={className}
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

function XSmallIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 3 11 11M11 3 3 11"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function QRFloatIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="white"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h.01M18 14h.01M14 18h.01M18 18h.01M14 14v4h4v-4" />
    </svg>
  );
}

function QRSmallIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h.01M18 14h.01M14 18h.01M18 18h.01M14 14v4h4v-4" />
    </svg>
  );
}

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
