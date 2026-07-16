import { useState, useEffect, useRef, useMemo, useCallback } from "react";
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
  TRASPASO_TABS,
} from "../../lib/traspasos-ui";
import {
  WhChip,
  Avatar,
  Pill,
  TipoBadge,
} from "../../components/traspasos/TraspasoBits";
import { useSedes } from "../../hooks/useSedes";
import { useFiltros } from "../../hooks/useFiltros";
import BarraFiltros from "../../components/filtros/BarraFiltros";

const PAGE_SIZE = 60;

const COLS = `id, numero, fecha, estado, tipo, sede_origen_id, sede_destino_id, bultos, observaciones,
   solicitante:solicitado_por(nombre),
   picker:picker_id(nombre),
   verificador:verificado_por(nombre),
   detalle_traspaso(cantidad_solicitada)`;

/** Estados que cuentan como traspaso "activo" (aún no cerrado). */
const ESTADOS_ACTIVOS = ["borrador", "picking", "verificado", "en_transito"];

/* Opciones del select de estado: los valores REALES del enum ya verificados en
   TRASPASO_TABS. "Todos" es el centinela de la barra, que ya trae su opción. */
const ESTADO_OPCIONES = TRASPASO_TABS.filter((t) => t.v !== "Todos").map(
  (t) => ({ v: t.v, l: t.label }),
);

/* Campos que no dependen de nada: viven fuera del componente para que su
   identidad sea estable. Si se recrearan en cada render, `valoresAplicados`
   cambiaría de identidad y el efecto de carga se dispararía en bucle. */
const CAMPO_Q = {
  id: "q",
  tipo: "texto",
  label: "Buscar",
  columnas: ["observaciones"],
  numericoA: "numero",
  debounce: 400,
};
const CAMPO_RANGO = {
  id: "rango",
  tipo: "fecha",
  label: "Fecha",
  columna: "fecha",
  presets: ["hoy", "semana", "mes", "mesPasado"],
};
const CAMPO_ESTADO = {
  id: "estado",
  tipo: "opciones",
  label: "Estado",
  columna: "estado",
  opciones: ESTADO_OPCIONES,
  comparador: "eq",
};

/* Estado real → {pillKind, label} de Lovable para el matiz dentro de la columna. */
const ESTADO_PILL_KIND = {
  borrador: { kind: "neut", label: "Pendiente" },
  picking: { kind: "info", label: "En picking" },
  verificado: { kind: "prog", label: "Verificado" },
  en_transito: { kind: "warn", label: "En tránsito" },
  recibido: { kind: "succ", label: "Recibido" },
  con_diferencia: { kind: "dang", label: "Con diferencia" },
  // Faltaba: un traspaso cancelado (14 reales) mostraba la pastilla gris con el
  // texto crudo "cancelado".
  cancelado: { kind: "dang", label: "Cancelado" },
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
  // Sin detalle disponible: no inventamos el # de productos (se muestra "—").
  // `unidades` cae a bultos solo como proxy para el KPI agregado.
  const bultos = t.bultos ?? 0;
  return { productos: null, unidades: bultos || 0 };
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
  const [traspasos, setTraspasos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [activos, setActivos] = useState(0);
  const [errorMsg, setErrorMsg] = useState(null);
  const pageRef = useRef(0);

  /* Filtros reales (server-side) — se pueden cruzar entre sí.
     `campos` va memoizado a propósito: si cambiara de identidad en cada render,
     `valoresAplicados` también, y el efecto de carga se dispararía en bucle. */
  const sedeOpciones = useMemo(
    () => SEDE_OPTS.map((s) => ({ v: s.id, l: s.nombre })),
    [SEDE_OPTS],
  );
  const campos = useMemo(
    () => [
      CAMPO_Q,
      CAMPO_RANGO,
      CAMPO_ESTADO,
      // Origen y destino son dos filtros distintos: un traspaso toca DOS sedes,
      // así que "de dónde sale" y "a dónde llega" no son la misma pregunta.
      // No se ocultan a los no-Admin: la RLS ya los ata a su sede, pero un
      // traspaso los toca por origen O por destino, así que separarlos sigue
      // respondiendo algo real ("lo que me llega" vs "lo que despacho").
      {
        id: "origen",
        tipo: "opciones",
        label: "Origen",
        columna: "sede_origen_id",
        opciones: sedeOpciones,
      },
      {
        id: "destino",
        tipo: "opciones",
        label: "Destino",
        columna: "sede_destino_id",
        opciones: sedeOpciones,
      },
    ],
    [sedeOpciones],
  );
  const f = useFiltros({ clave: "traspasos", campos });
  const { aplicar, nuevoReqId, esReqVigente, valoresAplicados } = f;

  /** Alcance de lectura del rol: los no-Admin solo ven lo que toca su sede. */
  const aplicarAlcance = useCallback(
    (q) =>
      esAdmin
        ? q
        : q.or(
            `sede_origen_id.eq.${perfil?.sede_id},sede_destino_id.eq.${perfil?.sede_id}`,
          ),
    [esAdmin, perfil?.sede_id],
  );

  // `silent`: refresco en segundo plano (Realtime) sin parpadear el skeleton
  // ni mostrar error de un refresco de fondo.
  const cargar = useCallback(
    async (reset = false, silent = false) => {
      const myReq = nuevoReqId();
      if (!silent) setLoading(true);
      setErrorMsg(null);
      const currentPage = reset ? 0 : pageRef.current;
      try {
        let query = supabase.from("traspasos").select(COLS, { count: "exact" });
        query = aplicarAlcance(aplicar(query))
          .order("fecha", { ascending: false })
          .order("numero", { ascending: false })
          .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

        // Conteo honesto de activos: se le pregunta al servidor sobre TODO el
        // filtro, no sobre la página cargada.
        let qActivos = supabase
          .from("traspasos")
          .select("id", { count: "exact", head: true });
        qActivos = aplicarAlcance(aplicar(qActivos)).in(
          "estado",
          ESTADOS_ACTIVOS,
        );

        const [res, resActivos] = await Promise.all([query, qActivos]);
        if (!esReqVigente(myReq)) return;
        if (res.error) throw res.error;

        pageRef.current = currentPage + 1;
        if (reset) setTraspasos(res.data ?? []);
        else setTraspasos((prev) => [...prev, ...(res.data ?? [])]);
        setTotal(res.count ?? 0);
        if (!resActivos.error) setActivos(resActivos.count ?? 0);
      } catch {
        if (esReqVigente(myReq) && !silent)
          setErrorMsg("No se pudieron cargar los traspasos. Reintenta.");
      } finally {
        if (esReqVigente(myReq)) setLoading(false);
      }
    },
    [aplicar, aplicarAlcance, nuevoReqId, esReqVigente],
  );

  // Cualquier cambio de filtro vuelve a la página 0: paginar con el filtro
  // viejo mezclaría dos listados distintos.
  useEffect(() => {
    cargar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valoresAplicados, aplicarAlcance]);

  // Realtime: refresca la lista en vivo cuando cualquier traspaso cambia de
  // estado (la RLS de lectura sigue aplicando al re-cargar). Debounce para
  // agrupar ráfagas de eventos (p.ej. al actualizar varios ítems).
  // El canal se suscribe una sola vez, así que la recarga va por ref: si
  // llamara al `cargar` capturado al montar, el refresco en vivo repintaría la
  // lista con los filtros viejos.
  const cargarRef = useRef(cargar);
  useEffect(() => {
    cargarRef.current = cargar;
  }, [cargar]);

  useEffect(() => {
    let t = null;
    const refrescar = () => {
      clearTimeout(t);
      t = setTimeout(() => cargarRef.current(true, true), 400);
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
  }, []);

  // Ya no se filtra en memoria: la consulta trae exactamente lo que el filtro
  // pide, así que `traspasos` ES el resultado. Filtrar de nuevo aquí era el bug
  // de fondo — la pantalla decía "sin traspasos" sobre datos que sí existían,
  // solo porque no estaban en la página cargada.
  const hasMore = traspasos.length < total;

  /* Agrupación por columna Kanban. */
  const grupos = useMemo(() => {
    const g = { pendiente: [], transito: [], recibido: [] };
    for (const t of traspasos) g[estadoToKanban(t.estado)].push(t);
    return g;
  }, [traspasos]);

  /* Unidades: solo se pueden sumar sobre lo cargado (el detalle viene en el
     join, no hay agregado en el servidor). Por eso va rotulado "en vista" y no
     se presenta como el total del filtro. `activos` y `total` sí son del
     servidor sobre TODO el filtro. */
  const unidadesEnVista = useMemo(
    () => traspasos.reduce((s, t) => s + conteo(t).unidades, 0),
    [traspasos],
  );

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
            {loading && traspasos.length === 0 ? (
              "cargando…"
            ) : (
              <>
                {/* `activos` y `total` los cuenta el servidor sobre TODO el
                    filtro. `unidades` solo puede sumarse sobre lo cargado, así
                    que va rotulado "en vista" y no se disfraza de total. */}
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-700)" }}
                >
                  {activos}
                </b>{" "}
                activos ·{" "}
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-700)" }}
                >
                  {total}
                </b>{" "}
                {f.hayFiltros ? "con el filtro" : "en total"} ·{" "}
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-700)" }}
                >
                  {unidadesEnVista}
                </b>{" "}
                unidades en vista
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

          <button
            onClick={() => navigate("/ops/traspasos/nuevo")}
            className="btn btn-pri"
            style={{ height: 48 }}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Nuevo traspaso
          </button>
        </div>

        {/* Filtros reales, cruzables y server-side. Ocupan su propia fila: son
            cinco campos y no caben apretados junto al toggle de vista. */}
        <div className="w-full">
          <BarraFiltros
            filtros={f}
            placeholder="N° de traspaso u observación…"
            legacy
          />
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

        {loading && traspasos.length === 0 ? (
          <SkeletonBoard />
        ) : traspasos.length === 0 ? (
          <EmptyState />
        ) : vista === "board" ? (
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
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
            rows={traspasos}
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
        {productos ?? "—"} productos · {unidades} unidades
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
                          {productos ?? "—"} producto
                          {productos === 1 ? "" : "s"}
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
