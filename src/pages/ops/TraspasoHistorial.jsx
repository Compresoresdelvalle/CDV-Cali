import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutGrid,
  List as ListIcon,
  Plus,
  ArrowRight,
  Clock,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatDate } from "../../lib/utils";
import {
  estadoToKanban,
  traspasoBadge,
  KANBAN_COLS,
} from "../../lib/traspasos-ui";
import {
  WhChip,
  Avatar,
  Pill,
  TipoBadge,
} from "../../components/traspasos/TraspasoBits";
import { useSedes } from "../../hooks/useSedes";

const PAGE_SIZE = 60;

/* Estado real → {pillKind, label} de Lovable para el matiz dentro de la columna. */
const ESTADO_PILL_KIND = {
  borrador: { kind: "neut", label: "Pendiente" },
  picking: { kind: "info", label: "En picking" },
  verificado: { kind: "prog", label: "Verificado" },
  en_transito: { kind: "warn", label: "En tránsito" },
  recibido: { kind: "succ", label: "Recibido" },
  con_diferencia: { kind: "dang", label: "Con diferencia" },
};

function estadoPillKind(estado) {
  return ESTADO_PILL_KIND[estado] ?? { kind: "neut", label: estado ?? "—" };
}

/** Deriva "N productos · N unidades" del join de detalle (fallback a bultos). */
function conteo(t) {
  const detalle = Array.isArray(t.detalle_traspaso) ? t.detalle_traspaso : [];
  if (detalle.length > 0) {
    const productos = detalle.length;
    const unidades = detalle.reduce(
      (s, d) => s + (d.cantidad_solicitada ?? 0),
      0,
    );
    return { productos, unidades };
  }
  // Sin detalle disponible: deriva de bultos como aproximación honesta.
  const bultos = t.bultos ?? 0;
  return { productos: bultos || 0, unidades: bultos || 0 };
}

/** Responsable mostrado: picker > solicitante (lo más representativo del flujo). */
function responsableNombre(t) {
  return t.picker?.nombre ?? t.solicitante?.nombre ?? null;
}

export default function TraspasoHistorial() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";

  // Sedes activas desde la BD (única fuente de verdad)
  const { sedes: SEDE_OPTS } = useSedes();

  const [vista, setVista] = useState("board");
  const [sedeFiltro, setSedeFiltro] = useState("ALL");
  const [traspasos, setTraspasos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [errorMsg, setErrorMsg] = useState(null);
  const reqIdRef = useRef(0);

  // `silent`: refresco en segundo plano (Realtime) sin parpadear el skeleton
  // ni mostrar error de un refresco de fondo.
  const cargar = async (reset = false, silent = false) => {
    const myReq = ++reqIdRef.current;
    if (!silent) setLoading(true);
    setErrorMsg(null);
    const currentPage = reset ? 0 : page;
    try {
      let query = supabase
        .from("traspasos")
        .select(
          `id, numero, fecha, estado, tipo, sede_origen_id, sede_destino_id, bultos, observaciones,
           solicitante:solicitado_por(nombre),
           picker:picker_id(nombre),
           verificador:verificado_por(nombre),
           detalle_traspaso(cantidad_solicitada)`,
        )
        .order("fecha", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (!esAdmin) {
        query = query.or(
          `sede_origen_id.eq.${perfil?.sede_id},sede_destino_id.eq.${perfil?.sede_id}`,
        );
      }

      const { data, error } = await query;
      if (myReq !== reqIdRef.current) return;
      if (error) throw error;

      if (reset) {
        setTraspasos(data ?? []);
        setPage(1);
      } else {
        setTraspasos((prev) => [...prev, ...(data ?? [])]);
        setPage((p) => p + 1);
      }
      setHasMore((data ?? []).length === PAGE_SIZE);
    } catch {
      if (myReq === reqIdRef.current && !silent)
        setErrorMsg("No se pudieron cargar los traspasos. Reintenta.");
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: refresca la lista en vivo cuando cualquier traspaso cambia de
  // estado (la RLS de lectura sigue aplicando al re-cargar). Debounce para
  // agrupar ráfagas de eventos (p.ej. al actualizar varios ítems).
  useEffect(() => {
    let t = null;
    const refrescar = () => {
      clearTimeout(t);
      t = setTimeout(() => cargar(true, true), 400);
    };
    const channel = supabase
      .channel("traspasos-historial")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "traspasos" },
        refrescar,
      )
      .subscribe();
    return () => {
      clearTimeout(t);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Filtro por sede (cliente) — origen o destino. */
  const filtrados = useMemo(() => {
    if (sedeFiltro === "ALL") return traspasos;
    return traspasos.filter(
      (t) =>
        t.sede_origen_id === sedeFiltro || t.sede_destino_id === sedeFiltro,
    );
  }, [traspasos, sedeFiltro]);

  /* Agrupación por columna Kanban. */
  const grupos = useMemo(() => {
    const g = { pendiente: [], enviado: [], transito: [], recibido: [] };
    for (const t of filtrados) g[estadoToKanban(t.estado)].push(t);
    return g;
  }, [filtrados]);

  /* KPIs del header — derivados de lo disponible (sin números inventados). */
  const kpis = useMemo(() => {
    const activos = filtrados.filter((t) =>
      ["borrador", "picking", "verificado", "en_transito"].includes(t.estado),
    ).length;
    const unidades = filtrados.reduce((s, t) => s + conteo(t).unidades, 0);
    return { activos, total: filtrados.length, unidades };
  }, [filtrados]);

  return (
    <div className="flex h-full flex-col animate-fade-in">
      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-end justify-between gap-4 border-b px-4 pb-4 pt-5 sm:px-7 sm:pt-6"
        style={{ borderColor: "var(--n-100)", backgroundColor: "var(--n-0)" }}
      >
        <div className="min-w-0 flex-1">
          <h1
            className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--n-950)" }}
          >
            Traspasos
          </h1>
          <p
            className="mt-1.5 text-[13px] leading-[1.5]"
            style={{ color: "var(--n-500)" }}
          >
            {loading && filtrados.length === 0 ? (
              "cargando…"
            ) : (
              <>
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-700)" }}
                >
                  {kpis.activos}
                </b>{" "}
                activos ·{" "}
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-700)" }}
                >
                  {kpis.total}
                  {hasMore ? "+" : ""}
                </b>{" "}
                en vista ·{" "}
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-700)" }}
                >
                  {kpis.unidades}
                </b>{" "}
                unidades
              </>
            )}
          </p>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
          {/* Toggle Tablero / Lista */}
          <div
            className="flex items-center gap-0.5 rounded-lg p-[3px]"
            style={{ backgroundColor: "var(--n-100)" }}
          >
            <ToggleBtn
              active={vista === "board"}
              onClick={() => setVista("board")}
              icon={<LayoutGrid className="h-3.5 w-3.5" strokeWidth={2} />}
              label="Tablero"
            />
            <ToggleBtn
              active={vista === "list"}
              onClick={() => setVista("list")}
              icon={<ListIcon className="h-3.5 w-3.5" strokeWidth={2} />}
              label="Lista"
            />
          </div>

          <select
            value={sedeFiltro}
            onChange={(e) => setSedeFiltro(e.target.value)}
            className="rounded-lg border px-3 pr-8 text-[13px] outline-none"
            style={{
              height: 36,
              borderColor: "var(--n-150)",
              backgroundColor: "var(--n-0)",
              color: "var(--n-700)",
            }}
            aria-label="Filtrar por sede"
          >
            <option value="ALL">Todas las sedes</option>
            {SEDE_OPTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>

          <button
            onClick={() => navigate("/ops/traspasos/nuevo")}
            className="btn btn-pri"
            style={{ height: 48 }}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Nuevo traspaso
          </button>
        </div>
      </div>

      {/* ── Contenido ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-4 pb-14 pt-5 sm:px-7">
        {errorMsg && (
          <div
            role="alert"
            className="mb-4 rounded-[10px] border px-4 py-3 text-sm"
            style={{
              backgroundColor: "var(--dang-50)",
              borderColor: "var(--dang-border)",
              color: "var(--dang-700)",
            }}
          >
            {errorMsg}
          </div>
        )}

        {loading && filtrados.length === 0 ? (
          <SkeletonBoard />
        ) : filtrados.length === 0 ? (
          <EmptyState />
        ) : vista === "board" ? (
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-4">
            {KANBAN_COLS.map((col) => (
              <BoardColumn
                key={col.key}
                col={col}
                rows={grupos[col.key]}
                onOpen={(id) => navigate(`/ops/traspasos/${id}`)}
              />
            ))}
          </div>
        ) : (
          <ListaTabla
            rows={filtrados}
            onOpen={(id) => navigate(`/ops/traspasos/${id}`)}
          />
        )}

        {hasMore && (
          <button
            onClick={() => cargar(false)}
            disabled={loading}
            className="btn btn-out mt-4 w-full justify-center disabled:opacity-50"
            style={{ height: 48 }}
          >
            {loading ? "Cargando…" : "Cargar más"}
          </button>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function ToggleBtn({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors"
      style={
        active
          ? {
              backgroundColor: "var(--n-0)",
              color: "var(--n-950)",
              boxShadow: "0 1px 2px rgba(14,16,24,.06)",
            }
          : { backgroundColor: "transparent", color: "var(--n-500)" }
      }
    >
      {icon} {label}
    </button>
  );
}

/* ---------- TABLERO ---------- */

function BoardColumn({ col, rows, onOpen }) {
  const isTransit = col.key === "transito";
  const isDone = col.key === "recibido";
  return (
    <div
      className="flex min-h-[640px] flex-col gap-2.5 rounded-xl border p-3"
      style={{
        borderColor: "var(--n-100)",
        backgroundColor: isDone ? "var(--n-25)" : "var(--n-50)",
      }}
    >
      <div className="flex items-center justify-between gap-2 px-1.5 py-1">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${col.pulse ? "animate-pulse" : ""}`}
            style={{
              background: col.dotVar,
              boxShadow: col.pulse
                ? "0 0 0 4px rgba(247,144,9,.18)"
                : undefined,
            }}
          />
          <span
            className="text-[13px] font-semibold"
            style={{ color: "var(--n-950)" }}
          >
            {col.label}
          </span>
        </div>
        <span
          className="rounded-full border px-1.5 py-0.5 font-mono text-[11px]"
          style={
            isTransit
              ? {
                  borderColor: "var(--warn-border)",
                  backgroundColor: "var(--warn-50)",
                  color: "var(--warn-700)",
                }
              : {
                  borderColor: "var(--n-150)",
                  backgroundColor: "var(--n-0)",
                  color: "var(--n-500)",
                }
          }
        >
          {rows.length}
        </span>
      </div>

      {rows.length === 0 ? (
        <div
          className="rounded-[10px] border border-dashed px-3 py-6 text-center font-mono text-[11.5px]"
          style={{ borderColor: "var(--n-200)", color: "var(--n-400)" }}
        >
          Sin traspasos
        </div>
      ) : (
        rows.map((t) => <BoardCard key={t.id} t={t} onOpen={onOpen} />)
      )}
    </div>
  );
}

function BoardCard({ t, onOpen }) {
  const { productos, unidades } = conteo(t);
  const badge = traspasoBadge(t.tipo);
  const pill = estadoPillKind(t.estado);
  const resp = responsableNombre(t);
  return (
    <button
      onClick={() => onOpen(t.id)}
      className="flex w-full cursor-pointer flex-col gap-2.5 rounded-[10px] border p-3.5 text-left transition-all"
      style={{
        borderColor: "var(--n-150)",
        backgroundColor: "var(--n-0)",
        boxShadow: "0 1px 2px rgba(14,16,24,.04)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--n-300)";
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(14,16,24,.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--n-150)";
        e.currentTarget.style.boxShadow = "0 1px 2px rgba(14,16,24,.04)";
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="flex items-center gap-1.5 font-mono text-[13px] font-medium"
          style={{ color: "var(--n-950)" }}
        >
          <span
            className="h-[7px] w-[7px] rounded-full"
            style={{
              background: `var(--${pill.kind === "neut" ? "n-400" : `${pill.kind}-500`})`,
            }}
          />
          #{t.numero}
          <TipoBadge badge={badge} />
        </span>
        <span style={{ color: "var(--n-400)" }}>
          <MoreHorizontal className="h-3.5 w-3.5" />
        </span>
      </div>

      <div
        className="flex items-center gap-2 text-[12.5px] font-medium"
        style={{ color: "var(--n-950)" }}
      >
        <WhChip sedeId={t.sede_origen_id} />
        <ArrowRight
          className="h-3.5 w-3.5 shrink-0"
          strokeWidth={2}
          style={{ color: "var(--n-400)" }}
        />
        <WhChip sedeId={t.sede_destino_id} />
      </div>

      <div
        className="font-mono text-[11.5px]"
        style={{ color: "var(--n-500)" }}
      >
        {productos} productos · {unidades} unidades
      </div>

      {t.observaciones && (
        <div
          className="text-[12px] italic leading-[1.45]"
          style={{ color: "var(--n-700)" }}
        >
          &ldquo;{t.observaciones}&rdquo;
        </div>
      )}

      <div
        className="flex items-center justify-between gap-1.5 border-t border-dashed pt-2"
        style={{ borderColor: "var(--n-100)" }}
      >
        <span
          className="flex items-center gap-1 font-mono text-[11px]"
          style={{ color: "var(--n-500)" }}
        >
          <Clock
            className="h-[11px] w-[11px]"
            strokeWidth={2}
            style={{ color: "var(--n-400)" }}
          />
          {formatDate(t.fecha)}
        </span>
        <span className="flex items-center gap-1.5">
          <Pill kind={pill.kind} label={pill.label} />
          <Avatar nombre={resp} />
        </span>
      </div>
    </button>
  );
}

/* ---------- LISTA ---------- */

function ListaTabla({ rows, onOpen }) {
  return (
    <>
      {/* Desktop: tabla rica */}
      <div
        className="hidden overflow-hidden rounded-[10px] border md:block"
        style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {[
                  "#",
                  "Fecha",
                  "Origen",
                  "Destino",
                  "Productos",
                  "Motivo",
                  "Estado",
                  "Responsable",
                ].map((h) => (
                  <th
                    key={h}
                    className="border-b px-3 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-[0.08em]"
                    style={{
                      borderColor: "var(--n-150)",
                      backgroundColor: "var(--n-25)",
                      color: "var(--n-400)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const { productos, unidades } = conteo(t);
                const badge = traspasoBadge(t.tipo);
                const pill = estadoPillKind(t.estado);
                const resp = responsableNombre(t);
                return (
                  <tr
                    key={t.id}
                    onClick={() => onOpen(t.id)}
                    className="cursor-pointer transition-colors"
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = "var(--n-25)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "")
                    }
                  >
                    <Td>
                      <span
                        className="font-mono text-[12.5px] font-medium"
                        style={{ color: "var(--n-950)" }}
                      >
                        #{t.numero}
                      </span>
                    </Td>
                    <Td>
                      <span
                        className="font-mono text-[11.5px]"
                        style={{ color: "var(--n-500)" }}
                      >
                        {formatDate(t.fecha)}
                      </span>
                    </Td>
                    <Td>
                      <WhChip sedeId={t.sede_origen_id} />
                    </Td>
                    <Td>
                      <WhChip sedeId={t.sede_destino_id} />
                    </Td>
                    <Td>
                      <div className="flex flex-col leading-[1.3]">
                        <span
                          className="text-[13px] font-medium"
                          style={{ color: "var(--n-950)" }}
                        >
                          {productos} producto{productos !== 1 ? "s" : ""}
                          <TipoBadge badge={badge} compact />
                        </span>
                        <span
                          className="mt-0.5 font-mono text-[11px]"
                          style={{ color: "var(--n-500)" }}
                        >
                          {unidades} unidades
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <span
                        className="text-[12px] italic"
                        style={{ color: "var(--n-700)" }}
                      >
                        {t.observaciones ? `“${t.observaciones}”` : "—"}
                      </span>
                    </Td>
                    <Td>
                      <Pill kind={pill.kind} label={pill.label} />
                    </Td>
                    <Td>
                      <div
                        className="flex items-center gap-2 text-[12.5px]"
                        style={{ color: "var(--n-700)" }}
                      >
                        <Avatar nombre={resp} />
                        {resp ?? "Sin asignar"}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile: cards (misma tarjeta del tablero) */}
      <ul className="space-y-2.5 md:hidden" role="list">
        {rows.map((t) => (
          <li key={t.id}>
            <BoardCard t={t} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </>
  );
}

function Td({ children }) {
  return (
    <td className="border-b px-3 py-3" style={{ borderColor: "var(--n-75)" }}>
      {children}
    </td>
  );
}

/* ---------- estados ---------- */

function SkeletonBoard() {
  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-4">
      {[...Array(4)].map((_, c) => (
        <div
          key={c}
          className="flex min-h-[320px] flex-col gap-2.5 rounded-xl border p-3"
          style={{
            borderColor: "var(--n-100)",
            backgroundColor: "var(--n-50)",
          }}
        >
          <div
            className="h-4 w-24 animate-pulse rounded"
            style={{ backgroundColor: "var(--n-100)" }}
          />
          {[...Array(2)].map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-[10px]"
              style={{ backgroundColor: "var(--n-0)" }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div
        className="mb-4 grid h-14 w-14 place-items-center rounded-[12px]"
        style={{ backgroundColor: "var(--p-50)", color: "var(--p-600)" }}
      >
        <RefreshCw className="h-7 w-7" strokeWidth={1.5} />
      </div>
      <p className="font-semibold" style={{ color: "var(--n-950)" }}>
        Sin traspasos registrados
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--n-500)" }}>
        Crea un nuevo traspaso para mover mercancía entre sedes
      </p>
    </div>
  );
}
