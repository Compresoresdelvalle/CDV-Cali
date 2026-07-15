import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, ShoppingCart } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate } from "../../lib/utils";
import { parseRangoFecha } from "../../lib/busquedaFecha";
import {
  METODOS_PAGO_VENTA,
  metodoPagoClass,
  ventaEstadoClass,
  ventaEstadoLabel,
  inicialesNombre,
  avatarVariant,
  resumenProductos,
} from "../../lib/ventas-ui";

const PAGE_SIZE = 20;

export default function VentaHistorial() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";

  const [ventas, setVentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroMetodo, setFiltroMetodo] = useState("Todos");
  const [busqueda, setBusqueda] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const reqIdRef = useRef(0);

  // Si lo escrito en la barra es una fecha (dd/mm/aaaa, mm/aaaa, dd/mm), se
  // filtra server-side por rango; si no, se mantiene la búsqueda de texto.
  const rangoFecha = useMemo(() => parseRangoFecha(busqueda), [busqueda]);

  const cargarVentas = async (reset = false) => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    const currentPage = reset ? 0 : page;

    try {
      // Join read-only a detalle_venta para derivar el resumen de productos
      // (columna del diseño Lovable). NO modifica lógica de escritura.
      let query = supabase
        .from("ventas")
        .select(
          `id, numero, fecha, cliente_nombre, metodo_pago, total, anulada, sede_id,
           vendedor:vendedor_id(nombre),
           detalle_venta(producto:producto_id(nombre))`,
        )
        .order("fecha", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (!esAdmin) query = query.eq("sede_id", perfil.sede_id);
      // #S1-14: `ilike` (insensible a mayúsculas) para que variantes de casing
      // heredadas ('efectivo' vs 'Efectivo') no dejen ventas invisibles al filtrar.
      if (filtroMetodo !== "Todos")
        query = query.ilike("metodo_pago", filtroMetodo);
      if (rangoFecha)
        query = query
          .gte("fecha", rangoFecha.desde)
          .lte("fecha", rangoFecha.hasta);

      const { data, error } = await query;
      if (myReq !== reqIdRef.current) return;
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
      if (myReq === reqIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargarVentas(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroMetodo, rangoFecha?.desde, rangoFecha?.hasta]);

  // Búsqueda client-side sobre lo ya cargado (número, cliente, productos).
  // El listado original no tenía búsqueda; se añade sin tocar la paginación
  // server-side ni el filtro por método de pago.
  const ventasFiltradas = useMemo(() => {
    // Cuando la barra es una fecha, el filtrado ya ocurrió server-side.
    if (rangoFecha) return ventas;
    const needle = busqueda.trim().toLowerCase();
    if (!needle) return ventas;
    return ventas.filter((v) => {
      const num = `#${v.numero}`.toLowerCase();
      const cli = (v.cliente_nombre || "Cliente mostrador").toLowerCase();
      const prods = (resumenProductos(v.detalle_venta, 6) ?? "").toLowerCase();
      return (
        num.includes(needle) || cli.includes(needle) || prods.includes(needle)
      );
    });
  }, [ventas, busqueda, rangoFecha]);

  // KPIs honestos derivados de lo cargado en vista (no inventados).
  const kpis = useMemo(() => {
    // #S1-17: "hoy" se calcula en America/Bogota explícito, no en la zona del
    // dispositivo (tablets industriales sin sincronizar reloj daban conteos mal).
    const diaBogota = (d) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Bogota",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(d));
    const hoyStr = diaBogota(new Date());
    const facturado = ventas
      .filter((v) => !v.anulada)
      .reduce((s, v) => s + Number(v.total ?? 0), 0);
    const hoy = ventas.filter(
      (v) => v.fecha && diaBogota(v.fecha) === hoyStr,
    ).length;
    return { enVista: ventas.length, facturado, hoy };
  }, [ventas]);

  return (
    <div className="flex h-full flex-col animate-fade-in">
      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-start justify-between gap-4 border-b px-4 pb-4 pt-5 sm:px-7 sm:pt-6"
        style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
      >
        <div className="min-w-0 flex-1">
          <h1
            className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--n-950)" }}
          >
            Ventas
          </h1>
          <p
            className="mt-1.5 text-[13px] leading-[1.5]"
            style={{ color: "var(--n-500)" }}
          >
            {loading && ventas.length === 0 ? (
              "cargando…"
            ) : (
              <>
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-700)" }}
                >
                  {kpis.enVista}
                  {hasMore ? "+" : ""}
                </b>{" "}
                en vista ·{" "}
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-700)" }}
                >
                  {formatCOP(kpis.facturado)}
                </b>{" "}
                facturado ·{" "}
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-700)" }}
                >
                  {kpis.hoy}
                </b>{" "}
                hoy
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <button
            onClick={() => navigate("/ops/ventas/nueva")}
            className="btn btn-pri"
            style={{ height: 48 }}
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Nueva venta
          </button>
        </div>
      </div>

      {/* ── Tabs por método de pago ─────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center gap-1.5 border-b px-4 py-3 sm:px-7"
        style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
      >
        {METODOS_PAGO_VENTA.map((m) => {
          const active = filtroMetodo === m;
          return (
            <button
              key={m}
              onClick={() => setFiltroMetodo(m)}
              className="rounded-md px-3 text-[12.5px] font-medium transition-colors"
              style={{
                minHeight: 36,
                backgroundColor: active ? "var(--p-50)" : "transparent",
                color: active ? "var(--p-700)" : "var(--n-500)",
              }}
              onMouseEnter={(e) => {
                if (!active)
                  e.currentTarget.style.backgroundColor = "var(--n-50)";
              }}
              onMouseLeave={(e) => {
                if (!active)
                  e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              {m}
            </button>
          );
        })}
      </div>

      {/* ── Barra de búsqueda ───────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4 py-3 sm:px-7"
        style={{ backgroundColor: "var(--n-25)" }}
      >
        <div
          className="flex h-12 max-w-[560px] flex-1 items-center gap-2.5 rounded-lg border px-3.5"
          style={{
            borderColor: "var(--n-150)",
            backgroundColor: "var(--n-0)",
          }}
        >
          <Search
            className="h-4 w-4 shrink-0"
            strokeWidth={1.5}
            style={{ color: "var(--n-500)" }}
          />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por número, cliente, producto o fecha (23/06/2026)…"
            className="min-w-0 flex-1 border-none bg-transparent text-sm outline-none"
            style={{ color: "var(--n-950)" }}
          />
        </div>
        <span
          className="ml-auto font-mono text-[11px] uppercase tracking-wider"
          style={{ color: "var(--n-500)" }}
        >
          <b className="font-medium" style={{ color: "var(--n-700)" }}>
            {ventasFiltradas.length}
          </b>{" "}
          de{" "}
          <b className="font-medium" style={{ color: "var(--n-700)" }}>
            {kpis.enVista}
            {hasMore ? "+" : ""}
          </b>
        </span>
      </div>

      {/* ── Contenido ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-4 pb-14 pt-3 sm:px-7">
        {loading && ventas.length === 0 ? (
          <SkeletonList />
        ) : ventasFiltradas.length === 0 ? (
          <>
            <EmptyState
              filtrando={busqueda.trim().length > 0}
              hayMas={hasMore && !rangoFecha && busqueda.trim().length > 0}
            />
            {/* #S1-06: la búsqueda de texto es client-side sobre lo cargado; si
                no hay coincidencias pero quedan páginas, dejar seguir cargando
                para que el registro buscado no sea inalcanzable. */}
            {hasMore && !rangoFecha && busqueda.trim() && (
              <button
                onClick={() => cargarVentas(false)}
                disabled={loading}
                className="btn btn-out mt-4 w-full justify-center disabled:opacity-50"
                style={{ height: 48 }}
              >
                {loading
                  ? "Cargando…"
                  : "Cargar más ventas para seguir buscando"}
              </button>
            )}
          </>
        ) : (
          <>
            {/* Móvil/Tablet: cards (< md) */}
            <ul className="md:hidden space-y-2.5" role="list">
              {ventasFiltradas.map((v) => (
                <li key={v.id}>
                  <VentaCard
                    venta={v}
                    esAdmin={esAdmin}
                    onClick={() => navigate(`/ops/ventas/${v.id}`)}
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
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      <Th width={88}>#</Th>
                      <Th width={140}>Fecha</Th>
                      <Th>Cliente</Th>
                      <Th width={220}>Productos</Th>
                      <Th width={150}>Vendedor</Th>
                      <Th width={130}>Método pago</Th>
                      <Th width={130} right>
                        Total
                      </Th>
                      <Th width={110}>Recibo</Th>
                      <Th width={110}>Estado</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {ventasFiltradas.map((v) => (
                      <VentaFila
                        key={v.id}
                        venta={v}
                        onClick={() => navigate(`/ops/ventas/${v.id}`)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div
                className="flex items-center justify-between border-t px-5 py-3.5 text-xs"
                style={{
                  borderColor: "var(--n-150)",
                  backgroundColor: "var(--muted, var(--n-25))",
                  color: "var(--n-500)",
                }}
              >
                <span>
                  Mostrando{" "}
                  <b className="font-mono" style={{ color: "var(--n-700)" }}>
                    {ventasFiltradas.length}
                  </b>{" "}
                  de{" "}
                  <b className="font-mono" style={{ color: "var(--n-700)" }}>
                    {kpis.enVista}
                    {hasMore ? "+" : ""}
                  </b>{" "}
                  ventas
                </span>
                {hasMore && (
                  <span className="font-mono">
                    Carga las siguientes con &ldquo;Cargar más&rdquo;
                  </span>
                )}
              </div>
            </div>

            {/* Cargar más — visible también con búsqueda de texto activa
                (#S1-06): así los registros de páginas no cargadas se alcanzan. */}
            {hasMore && (
              <button
                onClick={() => cargarVentas(false)}
                disabled={loading}
                className="btn btn-out mt-4 w-full justify-center disabled:opacity-50"
                style={{ height: 48 }}
              >
                {loading ? "Cargando…" : "Cargar más"}
              </button>
            )}
          </>
        )}
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
        "whitespace-nowrap border-b px-3 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] " +
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
      className={
        "whitespace-nowrap border-b px-3 py-2.5 align-middle " +
        (right ? "text-right" : "")
      }
      style={{ borderColor: "var(--n-100)" }}
    >
      {children}
    </td>
  );
}

function VentaFila({ venta: v, onClick }) {
  const vendedorNombre = v.vendedor?.nombre ?? "—";
  const resumen = resumenProductos(v.detalle_venta);
  return (
    <tr
      onClick={onClick}
      className="h-12 cursor-pointer transition-colors"
      onMouseEnter={(e) =>
        (e.currentTarget.style.backgroundColor = "var(--n-50)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
    >
      <Td>
        <span
          className="font-mono text-[12.5px] font-medium"
          style={{ color: "var(--p-700)" }}
        >
          #{v.numero}
        </span>
      </Td>
      <Td>
        <span
          className="font-mono text-[11.5px]"
          style={{ color: "var(--n-500)" }}
        >
          {formatDate(v.fecha)}
        </span>
      </Td>
      <Td>
        <span className="font-medium" style={{ color: "var(--n-950)" }}>
          {v.cliente_nombre || "Cliente mostrador"}
        </span>
      </Td>
      <Td>
        <span
          className="block max-w-[200px] truncate text-[12.5px]"
          style={{ color: "var(--n-700)" }}
          title={resumen ?? undefined}
        >
          {resumen ?? "—"}
        </span>
      </Td>
      <Td>
        <span
          className="inline-flex items-center gap-2"
          style={{ color: "var(--n-700)" }}
        >
          <span className={`av-mini ${avatarVariant(vendedorNombre)}`}>
            {inicialesNombre(vendedorNombre)}
          </span>
          {vendedorNombre}
        </span>
      </Td>
      <Td>
        <span className={`pay-pill ${metodoPagoClass(v.metodo_pago)}`}>
          <span className="dot" />
          {v.metodo_pago}
        </span>
      </Td>
      <Td right>
        <span
          className="font-mono font-medium tabular-nums"
          style={{
            color: v.anulada ? "var(--n-300)" : "var(--n-950)",
            textDecoration: v.anulada ? "line-through" : "none",
          }}
        >
          {formatCOP(v.total)}
        </span>
      </Td>
      <Td>
        {/* El backend no emite "recibo" propio de venta (sin tabla ligada a
            ventas); el comprobante real se imprime desde el detalle. Se
            muestra el N.º de venta como referencia del recibo POS. */}
        <span className="rec-pill">Rec #{v.numero}</span>
      </Td>
      <Td>
        <span className={`s-pill ${ventaEstadoClass(v.anulada)}`}>
          <span className="dot" />
          {ventaEstadoLabel(v.anulada)}
        </span>
      </Td>
    </tr>
  );
}

function VentaCard({ venta: v, esAdmin, onClick }) {
  const vendedorNombre = v.vendedor?.nombre ?? "—";
  const resumen = resumenProductos(v.detalle_venta);
  return (
    <button
      onClick={onClick}
      className="w-full rounded-[10px] border px-4 py-3.5 text-left shadow-sm transition-all duration-100 active:scale-[0.985] active:shadow-none"
      style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span
              className="font-mono text-[12px] font-medium"
              style={{ color: "var(--p-700)" }}
            >
              #{v.numero}
            </span>
            <span className={`s-pill ${ventaEstadoClass(v.anulada)}`}>
              <span className="dot" />
              {ventaEstadoLabel(v.anulada)}
            </span>
            <span className={`pay-pill ${metodoPagoClass(v.metodo_pago)}`}>
              <span className="dot" />
              {v.metodo_pago}
            </span>
          </div>
          <p
            className="truncate text-[14px] font-medium leading-tight"
            style={{ color: "var(--n-950)" }}
          >
            {v.cliente_nombre || "Cliente mostrador"}
          </p>
          {resumen && (
            <p
              className="mt-0.5 truncate text-[12px]"
              style={{ color: "var(--n-700)" }}
            >
              {resumen}
            </p>
          )}
          <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--n-500)" }}>
            {formatDate(v.fecha)}
            {esAdmin && v.vendedor && ` · ${vendedorNombre}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className="font-mono text-[15px] font-semibold tabular-nums"
            style={{
              color: v.anulada ? "var(--n-300)" : "var(--n-950)",
              textDecoration: v.anulada ? "line-through" : "none",
            }}
          >
            {formatCOP(v.total)}
          </p>
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
                className="h-4 w-1/4 rounded"
                style={{ backgroundColor: "var(--n-100)" }}
              />
              <div
                className="h-3 w-1/2 rounded"
                style={{ backgroundColor: "var(--n-100)" }}
              />
            </div>
            <div
              className="ml-3 h-6 w-24 rounded"
              style={{ backgroundColor: "var(--n-100)" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ filtrando, hayMas }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div
        className="mb-4 grid h-14 w-14 place-items-center rounded-[12px]"
        style={{ backgroundColor: "var(--p-50)", color: "var(--p-600)" }}
      >
        <ShoppingCart className="h-7 w-7" strokeWidth={1.5} />
      </div>
      <p className="font-semibold" style={{ color: "var(--n-950)" }}>
        {filtrando ? "Sin ventas para la búsqueda" : "Sin ventas registradas"}
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--n-500)" }}>
        {!filtrando
          ? "Las ventas aparecerán aquí una vez creadas"
          : hayMas
            ? "Puede estar en ventas aún no cargadas — toca “Cargar más” abajo"
            : "Prueba con otro número, cliente o producto"}
      </p>
    </div>
  );
}
