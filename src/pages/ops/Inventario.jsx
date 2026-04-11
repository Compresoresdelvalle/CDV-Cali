import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useInventario } from "../../hooks/useInventario";
import { useRealtimeInventario } from "../../hooks/useRealtime";
import { useAuthStore } from "../../stores/authStore";
import StatusBadge from "../../components/ui/StatusBadge";
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

  return (
    <div
      className="flex flex-col min-h-full"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      {/* ── Barra de filtros ─────────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-10 border-b"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div className="px-4 pt-4 pb-3 space-y-3">
          {/* Título + contador */}
          <div className="flex items-center justify-between">
            <h1
              className="text-lg font-bold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Inventario
            </h1>
            {!loading && (
              <span
                className="text-xs px-2 py-1 rounded-full"
                style={{
                  color: "hsl(var(--muted-foreground))",
                  backgroundColor: "hsl(var(--muted))",
                }}
              >
                {items.length} {hasMore ? "+" : ""} items
              </span>
            )}
          </div>

          {/* Búsqueda */}
          <div className="relative">
            <SearchIcon
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: "hsl(var(--muted-foreground))" }}
            />
            <input
              type="search"
              placeholder="Buscar por nombre o referencia…"
              value={filtroBusqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="w-full pl-10 pr-4 h-11 rounded-xl border text-sm
                         focus:outline-none focus:ring-2 transition-all"
              style={{
                backgroundColor: "hsl(var(--muted) / 0.5)",
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--foreground))",
              }}
            />
            {filtroBusqueda && (
              <button
                onClick={() => setBusqueda("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors cursor-pointer"
                style={{ color: "hsl(var(--muted-foreground))" }}
                aria-label="Limpiar búsqueda"
              >
                <XSmallIcon />
              </button>
            )}
          </div>

          {/* Fila: Sede (dropdown) + Estado (chips) */}
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5 no-scrollbar">
            {/* Sede selector — oculto para Vendedor (solo ve su sede) */}
            {!esVendedor && (
              <select
                value={filtroSede ?? ""}
                onChange={(e) =>
                  setFiltros({ filtroSede: e.target.value || null })
                }
                className="flex-shrink-0 h-9 text-xs font-medium rounded-lg border px-2 pr-6 cursor-pointer
                           focus:outline-none focus:ring-2 transition-all"
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
            <button
              onClick={() => setFiltros({ filtroEstado: null })}
              className="flex-shrink-0 h-9 px-3 rounded-lg text-xs font-semibold border transition-all cursor-pointer"
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
                  backgroundColor: "#0B8A57",
                  color: "#fff",
                  borderColor: "#0B8A57",
                },
                Bajo: {
                  backgroundColor: "#C47F17",
                  color: "#fff",
                  borderColor: "#C47F17",
                },
                Agotado: {
                  backgroundColor: "#C0392B",
                  color: "#fff",
                  borderColor: "#C0392B",
                },
              };
              return (
                <button
                  key={estado}
                  onClick={() =>
                    setFiltros({ filtroEstado: active ? null : estado })
                  }
                  className="flex-shrink-0 h-9 px-3 rounded-lg text-xs font-semibold border transition-all cursor-pointer"
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
                  {estado}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Contenido ────────────────────────────────────────────────────── */}
      <div className="flex-1">
        {/* Error */}
        {error && (
          <div className="mx-4 mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-sm text-red-700 font-medium">
              Error al cargar inventario
            </p>
            <p className="text-xs text-red-500 mt-1">{error}</p>
          </div>
        )}

        {/* Loading inicial */}
        {loading && (
          <div className="flex flex-col gap-3 p-4">
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
            <ul className="md:hidden space-y-2.5 p-4" role="list">
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
                        <div className="flex items-center gap-2 mt-1.5">
                          <span
                            className="text-[11px]"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            {item.sede?.nombre}
                          </span>
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
            <div className="hidden md:block overflow-x-auto px-4 pb-4">
              <table className="w-full border-collapse">
                <thead>
                  <tr
                    className="text-left border-b-2"
                    style={{ borderColor: "hsl(var(--border))" }}
                  >
                    {[
                      "Referencia",
                      "Nombre",
                      "Categoría",
                      "Sede",
                      "Stock",
                      "Mín / Máx",
                      "Estado",
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
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => handleItemClick(item.producto?.id)}
                      className="cursor-pointer transition-colors border-b"
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
                          className="font-mono text-xs transition-colors"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {item.producto?.referencia}
                        </span>
                      </td>
                      <td className="px-3 py-3.5">
                        <span
                          className="text-sm font-medium"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {item.producto?.nombre}
                        </span>
                      </td>
                      <td className="px-3 py-3.5">
                        <span
                          className="text-xs"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {item.producto?.categoria}
                        </span>
                      </td>
                      <td className="px-3 py-3.5">
                        <span
                          className="text-xs"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {item.sede?.nombre}
                        </span>
                      </td>
                      <td className="px-3 py-3.5">
                        <span
                          className="text-base font-bold tabular-nums"
                          style={{ color: "hsl(var(--foreground))" }}
                        >
                          {item.cantidad}
                        </span>
                      </td>
                      <td className="px-3 py-3.5">
                        <span
                          className="text-xs tabular-nums"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {item.producto?.stock_minimo} /{" "}
                          {item.producto?.stock_maximo}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 last:pr-0">
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
              className="w-6 h-6 border-2 border-primary/20 border-t-primary
                            rounded-full animate-spin"
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
    estado === "OK" ? "#0B8A57" : estado === "Bajo" ? "#C47F17" : "#C0392B";
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
