import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ScanLine, Plus, X, Package } from "lucide-react";
import { useInventario } from "../../hooks/useInventario";
import { useRealtimeInventario } from "../../hooks/useRealtime";
import { useAuthStore } from "../../stores/authStore";
import StatusBadge from "../../components/ui/StatusBadge";
import TipoProductoBadge from "../../components/inventario/TipoProductoBadge";
import QRScanner from "../../components/forms/QRScanner";
import { SEDES } from "../../lib/constants";
import { formatCOP } from "../../lib/utils";
import { categoriaClass, estadoStockClass } from "../../lib/inventario-ui";

const ESTADOS = [
  { v: "OK", label: "Disponible", dot: "s" },
  { v: "Bajo", label: "Stock bajo", dot: "w" },
  { v: "Agotado", label: "Agotado", dot: "d" },
];

const TIPOS = [
  { v: null, label: "Todos" },
  { v: "nuevo", label: "Nuevo" },
  { v: "segunda_mano", label: "Segunda mano" },
];

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
    filtroTipo,
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
    return () => {
      observer.unobserve(el);
      observer.disconnect();
    };
  }, [loadMore]);

  const handleScanFound = useCallback(
    (productoId) => {
      setScannerOpen(false);
      navigate(`/ops/inventario/${productoId}`);
    },
    [navigate],
  );

  const handleItemClick = (productoId) => {
    if (productoId) navigate(`/ops/inventario/${productoId}`);
  };

  const esVendedor = perfil?.rol === "Vendedor";
  // Bloque 1 (#4): crear producto es exclusivo de Admin.
  const esAdmin = perfil?.rol === "Admin";
  const sedeLabel = filtroSede ? SEDE_LABELS[filtroSede] : "Todas las sedes";

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-[18px] px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ color: "var(--n-300)" }}
          >
            Operaciones · Catálogo y stock ·{" "}
            {loading
              ? "cargando…"
              : `${items.length}${hasMore ? "+" : ""} productos`}{" "}
            · {sedeLabel}
          </p>
          <h1
            className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.018em]"
            style={{ color: "var(--n-950)" }}
          >
            Inventario
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

      {/* ── Fila de búsqueda + escáner ──────────────────────────────── */}
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
            value={filtroBusqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, referencia o código…"
            className="flex-1 border-none bg-transparent text-[14px] outline-none"
            style={{ color: "var(--n-950)" }}
          />
          {filtroBusqueda && (
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
        <button
          onClick={() => setScannerOpen(true)}
          className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-lg px-4 font-sans text-[13px] font-semibold text-white"
          style={{ backgroundColor: "var(--p-600)" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.backgroundColor = "var(--p-700)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.backgroundColor = "var(--p-600)")
          }
        >
          <ScanLine className="h-4 w-4" strokeWidth={1.7} />
          <span className="hidden sm:inline">Escanear QR</span>
        </button>
      </div>

      {/* ── Grid: filtros + tabla ───────────────────────────────────── */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Panel de filtros */}
        <FiltrosPanel
          esVendedor={esVendedor}
          filtroSede={filtroSede}
          filtroEstado={filtroEstado}
          filtroTipo={filtroTipo}
          setFiltros={setFiltros}
        />

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
                Error al cargar inventario
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--dang-600)" }}>
                {error}
              </p>
            </div>
          )}

          {loading && <SkeletonList />}

          {!loading && items.length === 0 && !error && (
            <EmptyState filtroBusqueda={filtroBusqueda} />
          )}

          {!loading && items.length > 0 && (
            <>
              {/* Móvil/Tablet: cards (< md) */}
              <ul className="md:hidden space-y-2.5" role="list">
                {items.map((item) => (
                  <li key={item.id}>
                    <InventarioCard
                      item={item}
                      onClick={() => handleItemClick(item.producto?.id)}
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
                  style={{
                    borderColor: "var(--n-100)",
                    color: "var(--n-500)",
                  }}
                >
                  <span>
                    <strong
                      className="font-mono font-semibold"
                      style={{ color: "var(--n-950)" }}
                    >
                      {items.length}
                      {hasMore ? "+" : ""}
                    </strong>{" "}
                    registros
                  </span>
                  <span>·</span>
                  <span>{sedeLabel}</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr>
                        <Th width={140}>Referencia</Th>
                        <Th>Producto</Th>
                        <Th width={130}>Categoría</Th>
                        <Th width={120}>Sede</Th>
                        <Th width={120}>Stock</Th>
                        <Th width={120} right>
                          Precio
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <InventarioFila
                          key={item.id}
                          item={item}
                          onClick={() => handleItemClick(item.producto?.id)}
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
              — {items.length} registros —
            </p>
          )}
        </div>
      </div>

      {/* ── FAB QR Scanner ──────────────────────────────────────────── */}
      <button
        onClick={() => setScannerOpen(true)}
        aria-label="Abrir escáner QR"
        className="fixed bottom-24 right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform active:scale-95 lg:bottom-6"
        style={{ backgroundColor: "var(--p-600)" }}
      >
        <ScanLine className="h-6 w-6 text-white" strokeWidth={1.75} />
      </button>

      {/* ── Modal QR Scanner ────────────────────────────────────────── */}
      {scannerOpen && (
        <QRScanner
          onFound={handleScanFound}
          onClose={() => setScannerOpen(false)}
        />
      )}
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

function FiltrosPanel({
  esVendedor,
  filtroSede,
  filtroEstado,
  filtroTipo,
  setFiltros,
}) {
  return (
    <aside
      className="flex flex-col gap-4 self-start rounded-[10px] border p-3.5 text-[12.5px]"
      style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
    >
      {/* Sede */}
      {!esVendedor && (
        <FilterBlock
          title="Sede"
          clearable={!!filtroSede}
          onClear={() => setFiltros({ filtroSede: null })}
        >
          <FilterRow
            on={!filtroSede}
            onClick={() => setFiltros({ filtroSede: null })}
          >
            <Check on={!filtroSede} />
            Todas las sedes
          </FilterRow>
          {Object.entries(SEDE_LABELS).map(([id, label]) => (
            <FilterRow
              key={id}
              on={filtroSede === id}
              onClick={() => setFiltros({ filtroSede: id })}
            >
              <Check on={filtroSede === id} />
              {label}
            </FilterRow>
          ))}
        </FilterBlock>
      )}

      {/* Estado de stock */}
      <FilterBlock
        title="Estado de stock"
        clearable={!!filtroEstado}
        onClear={() => setFiltros({ filtroEstado: null })}
      >
        <FilterRow
          on={!filtroEstado}
          onClick={() => setFiltros({ filtroEstado: null })}
        >
          <span className="dot-stk n" />
          Todos
        </FilterRow>
        {ESTADOS.map((e) => (
          <FilterRow
            key={e.v}
            on={filtroEstado === e.v}
            onClick={() =>
              setFiltros({ filtroEstado: filtroEstado === e.v ? null : e.v })
            }
          >
            <span className={`dot-stk ${e.dot}`} />
            {e.label}
          </FilterRow>
        ))}
      </FilterBlock>

      {/* Tipo de producto */}
      <FilterBlock
        title="Tipo"
        clearable={!!filtroTipo}
        onClear={() => setFiltros({ filtroTipo: null })}
      >
        {TIPOS.map((t) => (
          <FilterRow
            key={t.label}
            on={(filtroTipo ?? null) === t.v}
            onClick={() => setFiltros({ filtroTipo: t.v })}
          >
            <Check on={(filtroTipo ?? null) === t.v} />
            {t.label}
          </FilterRow>
        ))}
      </FilterBlock>
    </aside>
  );
}

function FilterBlock({ title, children, clearable, onClear }) {
  return (
    <div>
      <div
        className="mb-2 flex items-center justify-between font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--n-500)" }}
      >
        <span>{title}</span>
        {clearable && (
          <button
            onClick={onClear}
            className="cursor-pointer text-[10px] font-medium normal-case tracking-normal hover:underline"
            style={{ color: "var(--p-600)" }}
          >
            limpiar
          </button>
        )}
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  );
}

function FilterRow({ on, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={
        "relative flex items-center justify-between gap-1.5 rounded-[5px] px-2 py-1.5 text-left text-[12.5px] leading-tight transition-colors " +
        (on
          ? "font-medium before:absolute before:left-[-8px] before:top-1 before:bottom-1 before:w-[2.5px] before:rounded-[1px]"
          : "")
      }
      style={
        on
          ? {
              backgroundColor: "var(--p-50)",
              color: "var(--p-700)",
            }
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

function InventarioFila({ item, onClick }) {
  const p = item.producto ?? {};
  const agotado = item.estado_stock === "Agotado";
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
          style={{ color: "var(--n-950)" }}
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
            "font-medium leading-tight " + (agotado ? "opacity-60" : "")
          }
          style={{ color: "var(--n-950)" }}
        >
          {p.nombre}
          <span
            className="mt-px block font-mono text-[11px] font-normal tracking-[0.04em]"
            style={{ color: "var(--n-500)" }}
          >
            {p.marca ?? "—"}
          </span>
        </div>
      </Td>
      <Td>
        <span className={`bdg ${categoriaClass(p.categoria)}`}>
          {p.categoria ?? "—"}
        </span>
      </Td>
      <Td>
        <span style={{ color: "var(--n-700)" }}>
          {item.sede?.nombre ?? "—"}
        </span>
      </Td>
      <Td>
        <div className="flex items-center gap-1.5">
          <span className={`stk-pill ${estadoStockClass(item.estado_stock)}`}>
            {item.cantidad}
          </span>
          <TipoProductoBadge tipo={p.tipo} />
        </div>
      </Td>
      <Td right>
        <span
          className="font-mono font-medium"
          style={{ color: agotado ? "var(--n-300)" : "var(--n-950)" }}
        >
          {p.precio_venta != null ? formatCOP(p.precio_venta) : "—"}
        </span>
      </Td>
    </tr>
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

function InventarioCard({ item, onClick }) {
  const p = item.producto ?? {};
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
            className="truncate text-[14px] font-medium leading-tight"
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
              {item.sede?.nombre}
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
          <span
            className="font-mono text-[26px] font-semibold leading-none"
            style={{ color: "var(--n-950)" }}
          >
            {item.cantidad}
          </span>
          <StatusBadge status={item.estado_stock} />
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
          : "No hay productos con los filtros seleccionados"}
      </p>
    </div>
  );
}
