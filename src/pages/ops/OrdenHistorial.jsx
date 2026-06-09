import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, List, LayoutGrid, X, Wrench } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import {
  OT_TABS,
  OT_KANBAN_COLS,
  ordenEstadoPill,
  autorizacionPill,
  tecnicoAvatar,
  diasEnEstado,
} from "../../lib/ordenes-ui";

const PAGE_SIZE = 20;

export default function OrdenHistorial() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [ordenes, setOrdenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(null); // estado real o null = todas
  const [view, setView] = useState("lista"); // 'lista' | 'tablero'
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const abortRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const cargar = async (reset = false) => {
    // Abortar cualquier carga previa en vuelo (evita race en clicks rápidos)
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    if (!mountedRef.current) return;
    setLoading(true);
    setErrorMsg("");
    const currentPage = reset ? 0 : page;
    try {
      let query = supabase
        .from("ordenes_servicio")
        .select(
          `id, numero, fecha, cliente_nombre, cliente_telefono, equipo_descripcion,
           equipo_serie, estado, estado_autorizacion, total, tipo,
           pendiente_recogida_at, fecha_entrega,
           tecnico:tecnico_id(nombre)`,
        )
        .order("fecha", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      // B1: Admin y Vendedor ven las OT de todas las sedes; Técnico y Bodeguero
      // siguen viendo solo su sede. (La edición sigue restringida por sede.)
      const veTodas = perfil?.rol === "Admin" || perfil?.rol === "Vendedor";
      if (!veTodas && perfil?.sede_id)
        query = query.eq("sede_id", perfil.sede_id);

      if (tab) query = query.eq("estado", tab);

      const { data, error } = await query;
      if (ac.signal.aborted || !mountedRef.current) return;
      if (error) throw error;

      if (reset) {
        setOrdenes(data ?? []);
        setPage(1);
      } else {
        setOrdenes((p) => [...p, ...(data ?? [])]);
        setPage((p) => p + 1);
      }
      setHasMore((data ?? []).length === PAGE_SIZE);
    } catch (err) {
      if (ac.signal.aborted || !mountedRef.current) return;
      console.error("[OrdenHistorial]", err);
      setErrorMsg(safeError(err, "Error al cargar órdenes"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    setPage(0);
    setHasMore(true);
    cargar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, perfil?.sede_id]);

  // Filtro de búsqueda en cliente, sobre lo cargado (la búsqueda server-side
  // requeriría debounce + endpoint; aquí se filtra el set paginado).
  const filtradas = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return ordenes;
    return ordenes.filter(
      (o) =>
        String(o.numero).toLowerCase().includes(needle) ||
        (o.cliente_nombre ?? "").toLowerCase().includes(needle) ||
        (o.equipo_descripcion ?? "").toLowerCase().includes(needle) ||
        (o.equipo_serie ?? "").toLowerCase().includes(needle),
    );
  }, [ordenes, q]);

  // KPIs del encabezado — derivados de datos reales (sin números inventados).
  const kpis = useMemo(() => {
    const abiertas = ordenes.filter((o) => o.estado === "abierta").length;
    const vencidas = ordenes.filter((o) => diasEnEstado(o).vencida).length;
    const tecnicos = new Set(
      ordenes.map((o) => o.tecnico?.nombre).filter(Boolean),
    ).size;
    return { abiertas, vencidas, tecnicos };
  }, [ordenes]);

  // Conteo por estado para las pestañas (sobre lo cargado en vista).
  const counts = useMemo(() => {
    const map = { all: ordenes.length };
    for (const o of ordenes) map[o.estado] = (map[o.estado] ?? 0) + 1;
    return map;
  }, [ordenes]);

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-[18px] px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.08em]"
            style={{ color: "var(--n-300)" }}
          >
            Operaciones · Taller ·{" "}
            {loading
              ? "cargando…"
              : `${ordenes.length}${hasMore ? "+" : ""} registros`}
          </p>
          <h1
            className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.018em]"
            style={{ color: "var(--n-950)" }}
          >
            Órdenes de Trabajo
          </h1>
          <p
            className="mt-1.5 text-[13px] leading-[1.5]"
            style={{ color: "var(--n-500)" }}
          >
            <b className="font-medium" style={{ color: "var(--n-950)" }}>
              {kpis.abiertas} abiertas
            </b>{" "}
            · {kpis.tecnicos} técnico{kpis.tecnicos === 1 ? "" : "s"} en vista
            {kpis.vencidas > 0 && (
              <>
                {" · "}
                <span
                  className="font-medium"
                  style={{ color: "var(--dang-700)" }}
                >
                  {kpis.vencidas} vencida{kpis.vencidas === 1 ? "" : "s"}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="viewtog">
            <button
              className={view === "lista" ? "on" : ""}
              onClick={() => setView("lista")}
            >
              <List className="h-3 w-3" /> Lista
            </button>
            <button
              className={view === "tablero" ? "on" : ""}
              onClick={() => setView("tablero")}
            >
              <LayoutGrid className="h-3 w-3" /> Tablero
            </button>
          </div>
          <button
            onClick={() => navigate("/ops/ordenes/nueva")}
            className="btn btn-pri"
            style={{ height: 48 }}
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Nueva orden
          </button>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-[10px] border px-4 py-3 text-sm"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
            color: "var(--dang-700)",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* ── Tabs de estado (con conteo) ─────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {OT_TABS.map((t) => {
          const on = (tab ?? null) === t.estado;
          const ct = t.estado == null ? counts.all : (counts[t.estado] ?? 0);
          return (
            <button
              key={t.v}
              onClick={() => setTab(t.estado)}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors"
              style={
                on
                  ? { backgroundColor: "var(--n-100)", color: "var(--n-950)" }
                  : { backgroundColor: "transparent", color: "var(--n-500)" }
              }
              onMouseEnter={(e) => {
                if (!on) e.currentTarget.style.backgroundColor = "var(--n-50)";
              }}
              onMouseLeave={(e) => {
                if (!on) e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              {t.v}
              <span
                className="font-mono text-[10.5px]"
                style={{ color: "var(--n-400)" }}
              >
                {ct}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Búsqueda (solo vista lista) ─────────────────────────────── */}
      {view === "lista" && (
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex h-12 max-w-[560px] flex-1 items-center gap-2.5 rounded-lg border px-3.5"
            style={{
              borderColor: "var(--n-200)",
              backgroundColor: "var(--n-0)",
            }}
          >
            <Search
              className="h-4 w-4 shrink-0"
              strokeWidth={1.5}
              style={{ color: "var(--n-500)" }}
            />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar OT, cliente, equipo o serie…"
              className="min-w-0 flex-1 border-none bg-transparent text-[14px] outline-none"
              style={{ color: "var(--n-950)" }}
            />
            {q ? (
              <button
                onClick={() => setQ("")}
                aria-label="Limpiar búsqueda"
                className="grid h-6 w-6 place-items-center rounded"
                style={{ color: "var(--n-500)" }}
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            ) : (
              <span
                className="hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] sm:inline"
                style={{
                  borderColor: "var(--n-200)",
                  backgroundColor: "var(--n-50)",
                  color: "var(--n-500)",
                }}
              >
                ⌘K
              </span>
            )}
          </div>
          <span
            className="ml-auto hidden font-mono text-[11px] uppercase tracking-wider sm:inline"
            style={{ color: "var(--n-500)" }}
          >
            Ordenado por ·{" "}
            <b className="font-medium" style={{ color: "var(--n-950)" }}>
              Recepción ↓
            </b>
          </span>
        </div>
      )}

      {/* ── Contenido ───────────────────────────────────────────────── */}
      {loading && ordenes.length === 0 ? (
        <Skeleton />
      ) : filtradas.length === 0 ? (
        <Empty q={q} />
      ) : view === "lista" ? (
        <ListView
          rows={filtradas}
          total={ordenes.length}
          abiertas={kpis.abiertas}
          hasMore={hasMore}
          onOpen={(id) => navigate(`/ops/ordenes/${id}`)}
        />
      ) : (
        <KanbanView
          rows={filtradas}
          onOpen={(id) => navigate(`/ops/ordenes/${id}`)}
        />
      )}

      {hasMore && !loading && (
        <button
          onClick={() => cargar(false)}
          className="w-full rounded-[10px] border py-3 text-sm font-medium"
          style={{
            borderColor: "var(--n-200)",
            color: "var(--n-500)",
            backgroundColor: "var(--n-0)",
          }}
        >
          Cargar más
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────── Vista lista (desktop tabla / mobile cards) ── */

function ListView({ rows, total, abiertas, hasMore, onOpen }) {
  return (
    <>
      {/* Móvil/Tablet: cards (< md) */}
      <ul className="md:hidden space-y-2.5" role="list">
        {rows.map((o) => (
          <li key={o.id}>
            <OrdenCard orden={o} onClick={() => onOpen(o.id)} />
          </li>
        ))}
      </ul>

      {/* Desktop: tabla (≥ md) */}
      <div
        className="hidden md:block overflow-hidden rounded-[10px] border"
        style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th width={90}>#</Th>
                <Th width={210}>Cliente</Th>
                <Th>Equipo</Th>
                <Th width={150}>Técnico</Th>
                <Th width={140}>Autorización</Th>
                <Th width={180}>Estado</Th>
                <Th width={90} right>
                  Días
                </Th>
                <Th width={130} right>
                  Total
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <OrdenFila key={o.id} orden={o} onClick={() => onOpen(o.id)} />
              ))}
            </tbody>
          </table>
        </div>
        <div
          className="flex items-center justify-between border-t px-5 py-3.5 text-xs"
          style={{
            borderColor: "var(--n-100)",
            backgroundColor: "var(--n-50)",
            color: "var(--n-500)",
          }}
        >
          <span>
            Mostrando{" "}
            <b className="font-mono" style={{ color: "var(--n-950)" }}>
              {rows.length}
            </b>{" "}
            de{" "}
            <b className="font-mono" style={{ color: "var(--n-950)" }}>
              {total}
              {hasMore ? "+" : ""}
            </b>{" "}
            órdenes
          </span>
          <span className="font-mono">
            {abiertas} abierta{abiertas === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </>
  );
}

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
        "whitespace-nowrap border-b px-3 py-2.5 align-middle text-[13px] " +
        (right ? "text-right" : "text-left")
      }
      style={{ borderColor: "var(--n-100)" }}
    >
      {children}
    </td>
  );
}

function OrdenFila({ orden, onClick }) {
  const pill = ordenEstadoPill(orden.estado);
  const aPill = autorizacionPill(orden.estado_autorizacion);
  const tec = tecnicoAvatar(orden.tecnico?.nombre);
  const dias = diasEnEstado(orden);
  const rowCls = [
    "cursor-pointer transition-colors",
    dias.vencida ? "ot-row-warn" : "",
    orden.estado === "entregada" ? "ot-row-done" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <tr
      onClick={onClick}
      className={rowCls}
      onMouseEnter={(e) => {
        if (!dias.vencida)
          e.currentTarget.style.backgroundColor = "var(--n-50)";
      }}
      onMouseLeave={(e) => {
        if (!dias.vencida) e.currentTarget.style.backgroundColor = "";
      }}
    >
      <Td>
        <span
          className="font-mono text-[12.5px] font-medium"
          style={{ color: "var(--n-950)" }}
        >
          #{orden.numero}
        </span>
      </Td>
      <Td>
        <div className="flex min-w-0 flex-col leading-tight">
          <span
            className="max-w-[200px] truncate text-[13px] font-medium"
            style={{ color: "var(--n-950)" }}
          >
            {orden.cliente_nombre}
          </span>
          {orden.cliente_telefono && (
            <span
              className="font-mono text-[11px]"
              style={{ color: "var(--n-500)" }}
            >
              {orden.cliente_telefono}
            </span>
          )}
        </div>
      </Td>
      <Td>
        <div className="flex min-w-0 flex-col leading-tight">
          <span
            className="text-[13px] font-medium"
            style={{ color: "var(--n-950)" }}
          >
            {orden.equipo_descripcion}
          </span>
          {orden.equipo_serie && (
            <span
              className="font-mono text-[11.5px]"
              style={{ color: "var(--n-500)" }}
            >
              {orden.equipo_serie}
            </span>
          )}
        </div>
      </Td>
      <Td>
        {orden.tecnico?.nombre ? (
          <span
            className="inline-flex items-center gap-2 text-[12.5px]"
            style={{ color: "var(--n-800)" }}
          >
            <span className={`av-tec ${tec.variant}`}>{tec.ini}</span>
            {orden.tecnico.nombre}
          </span>
        ) : (
          <span style={{ color: "var(--n-300)" }}>—</span>
        )}
      </Td>
      <Td>
        <span className={aPill.cls}>
          <span className="dot" />
          {aPill.label}
        </span>
      </Td>
      <Td>
        <div className="flex flex-wrap items-center gap-1">
          {dias.vencida && <span className="bdg-vencida">VENCIDA</span>}
          <span className={pill.cls}>
            <span className="dot" />
            {pill.label}
          </span>
        </div>
      </Td>
      <Td right>
        <span
          className={
            "font-mono text-[12.5px] " +
            (dias.tone === "warn"
              ? "days-warn"
              : dias.tone === "dang"
                ? "days-dang"
                : "")
          }
          style={dias.tone ? undefined : { color: "var(--n-500)" }}
        >
          {dias.label}
        </span>
      </Td>
      <Td right>
        <span
          className="font-mono text-[13.5px] font-medium tabular-nums"
          style={{ color: "var(--n-950)" }}
        >
          {formatCOP(orden.total ?? 0)}
        </span>
      </Td>
    </tr>
  );
}

function OrdenCard({ orden, onClick }) {
  const pill = ordenEstadoPill(orden.estado);
  const tec = tecnicoAvatar(orden.tecnico?.nombre);
  const dias = diasEnEstado(orden);
  return (
    <button
      onClick={onClick}
      className="w-full rounded-[10px] border px-4 py-3.5 text-left shadow-sm transition-all duration-100 active:scale-[0.985] active:shadow-none"
      style={{
        borderColor: dias.vencida ? "var(--dang-border)" : "var(--n-150)",
        backgroundColor: dias.vencida ? "var(--warn-50)" : "var(--n-0)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span
              className="font-mono text-[11px] font-semibold"
              style={{ color: "var(--p-600)" }}
            >
              #{orden.numero}
            </span>
            {dias.vencida && <span className="bdg-vencida">VENCIDA</span>}
            <span className={pill.cls}>
              <span className="dot" />
              {pill.label}
            </span>
          </div>
          <p
            className="truncate text-[14px] font-medium leading-tight"
            style={{ color: "var(--n-950)" }}
          >
            {orden.cliente_nombre}
          </p>
          <p
            className="mt-0.5 truncate text-[12px]"
            style={{ color: "var(--n-500)" }}
          >
            {orden.equipo_descripcion}
          </p>
          <p
            className="mt-0.5 flex items-center gap-1.5 text-[11.5px]"
            style={{ color: "var(--n-500)" }}
          >
            {orden.tecnico?.nombre && (
              <span className={`av-tec ${tec.variant}`}>{tec.ini}</span>
            )}
            {formatDate(orden.fecha)}
            {orden.tecnico?.nombre && ` · ${orden.tecnico.nombre}`}
            {dias.dias != null && (
              <span
                className={
                  "ml-auto font-mono " +
                  (dias.tone === "warn"
                    ? "days-warn"
                    : dias.tone === "dang"
                      ? "days-dang"
                      : "")
                }
              >
                {dias.label}
              </span>
            )}
          </p>
        </div>
        <p
          className="shrink-0 font-mono text-[15px] font-semibold tabular-nums"
          style={{ color: "var(--n-950)" }}
        >
          {formatCOP(orden.total ?? 0)}
        </p>
      </div>
    </button>
  );
}

/* ─────────────────────────── Vista tablero (kanban) ────────────────────── */

function KanbanView({ rows, onOpen }) {
  return (
    <div className="kanban">
      {OT_KANBAN_COLS.map((col) => {
        const items = rows.filter((r) => r.estado === col.id);
        return (
          <div key={col.id} className="kcol">
            <div className="kcol-h">
              <div className="ttl">
                <span
                  className={`kdot ${col.pulse ? "pulse" : ""}`}
                  style={{ background: col.dot }}
                />
                {col.label}
              </div>
              <span className="kct">{items.length}</span>
            </div>
            {items.map((r) => {
              const tec = tecnicoAvatar(r.tecnico?.nombre);
              const dias = diasEnEstado(r);
              const cardCls = [
                "kcard text-left",
                dias.vencida ? "dang" : dias.tone === "warn" ? "warn" : "",
                r.estado === "entregada" ? "done" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  key={r.id}
                  onClick={() => onOpen(r.id)}
                  className={cardCls}
                >
                  <div className="ktop">
                    <span className="knum">#{r.numero}</span>
                    {dias.dias != null && (
                      <span
                        className={
                          "font-mono text-[10.5px] " +
                          (dias.tone === "warn"
                            ? "days-warn"
                            : dias.tone === "dang"
                              ? "days-dang"
                              : "")
                        }
                      >
                        {dias.label}
                      </span>
                    )}
                  </div>
                  <div className="kcli">{r.cliente_nombre}</div>
                  <div className="keqp">{r.equipo_descripcion}</div>
                  <div className="kft">
                    {r.tecnico?.nombre && (
                      <span className={`av-tec ${tec.variant}`}>{tec.ini}</span>
                    )}
                    <span className="nm">
                      {r.tecnico?.nombre ?? "Sin asignar"}
                    </span>
                  </div>
                </button>
              );
            })}
            {items.length === 0 && (
              <div
                className="rounded-md border border-dashed p-4 text-center text-[11px]"
                style={{ borderColor: "var(--n-200)", color: "var(--n-500)" }}
              >
                Sin OT
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── Estados ──────────────────────────────────── */

function Skeleton() {
  return (
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-[10px] border"
          style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
        />
      ))}
    </div>
  );
}

function Empty({ q }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div
        className="mb-4 grid h-14 w-14 place-items-center rounded-[12px]"
        style={{ backgroundColor: "var(--p-50)", color: "var(--p-600)" }}
      >
        <Wrench className="h-7 w-7" strokeWidth={1.5} />
      </div>
      <p className="font-semibold" style={{ color: "var(--n-950)" }}>
        {q ? "Sin resultados" : "Sin órdenes registradas"}
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--n-500)" }}>
        {q
          ? `No se encontraron órdenes para "${q}"`
          : 'Crea la primera con "Nueva orden"'}
      </p>
    </div>
  );
}
