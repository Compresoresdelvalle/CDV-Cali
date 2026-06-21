/**
 * OrdenHistorial — Listado / Tablero de Órdenes de Trabajo (OT), nuevo flujo.
 *
 * Dos vistas: Lista (tabla desktop / cards móvil) y Kanban por estado.
 * Carga TODAS las OT (todas las sedes; la RLS permite verlas). Las OT de otra
 * sede salen atenuadas con candado 🔒 pero siguen siendo clickeables (lectura).
 *
 * Sistema de diseño: SOLO tokens `hsl(var(--token))`, nunca hex. Móvil = cards,
 * desktop = tabla. Botones de 48px.
 */
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, List, LayoutGrid, X, Wrench, Lock } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import {
  estadoEstilo,
  ESTADO_LABEL,
  pasoActual,
  calcularMontos,
  OT_DIAS_VENCIDA,
  SEDE_LABEL,
  puedeManipular,
} from "../../lib/ot-flujo";

// Columnas del tablero / opciones del filtro — estados del nuevo flujo.
// El valor coincide con el `key`/estado real al que mapean (vía pasoActual).
const ESTADOS_FLUJO = [
  "recepcion",
  "diagnostico",
  "cotizada",
  "autorizada",
  "en_proceso",
  "terminada",
  "entregada",
];

// Estado real (incl. legacy) → grupo del flujo, usando el índice de paso.
const PASO_A_GRUPO = [
  "recepcion", // 0
  "diagnostico", // 1
  "cotizada", // 2
  "autorizada", // 3
  "en_proceso", // 4
  "terminada", // 5
  "entregada", // 6
];

function grupoDeEstado(estado) {
  // cancelada → paso 6 pero la tratamos como "entregada"/cerrada en el filtro.
  return PASO_A_GRUPO[pasoActual({ estado })] ?? "recepcion";
}

// Días en taller: entero desde `fecha` hasta hoy.
function diasEnTaller(fecha) {
  if (!fecha) return 0;
  const inicio = new Date(fecha);
  if (Number.isNaN(inicio.getTime())) return 0;
  const ms = Date.now() - inicio.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export default function OrdenHistorial() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [ordenes, setOrdenes] = useState([]);
  const [abonosPorOt, setAbonosPorOt] = useState({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [view, setView] = useState("lista"); // 'lista' | 'kanban'
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("todos");

  useEffect(() => {
    let activo = true;
    (async () => {
      setLoading(true);
      setErrorMsg("");
      try {
        const [ordRes, aboRes] = await Promise.all([
          supabase
            .from("ordenes_servicio")
            .select(
              "id,numero,cliente_nombre,equipo_descripcion,equipo_serie,estado,sede_id,fecha,pendiente_recogida_at,total,costo_mano_obra,valor_repuestos,valor_revision,descuento_valor,iva_pct",
            )
            .order("fecha", { ascending: false }),
          supabase.from("abonos").select("orden_id,monto"),
        ]);
        if (!activo) return;
        if (ordRes.error) throw ordRes.error;
        if (aboRes.error) throw aboRes.error;

        const mapa = {};
        for (const a of aboRes.data ?? []) {
          (mapa[a.orden_id] ??= []).push(a);
        }
        setAbonosPorOt(mapa);
        setOrdenes(ordRes.data ?? []);
      } catch (err) {
        if (!activo) return;
        console.error("[OrdenHistorial]", err);
        setErrorMsg(safeError(err, "Error al cargar órdenes"));
      } finally {
        if (activo) setLoading(false);
      }
    })();
    return () => {
      activo = false;
    };
  }, []);

  // Enriquecer cada OT con campos derivados (saldo, días, vencida, sede propia).
  const enriquecidas = useMemo(() => {
    return ordenes.map((o) => {
      const { total, saldo } = calcularMontos(o, null, abonosPorOt[o.id] ?? []);
      const dias = diasEnTaller(o.fecha);
      const grupo = grupoDeEstado(o.estado);
      const entregada = grupo === "entregada";
      const propia = puedeManipular(perfil, o);
      return {
        ...o,
        _total: total,
        _saldo: saldo,
        _dias: dias,
        _grupo: grupo,
        _vencida: !entregada && dias > OT_DIAS_VENCIDA,
        _propia: propia,
      };
    });
  }, [ordenes, abonosPorOt, perfil]);

  const filtradas = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return enriquecidas.filter((o) => {
      if (estado !== "todos" && o._grupo !== estado) return false;
      if (!needle) return true;
      const hay = `${o.cliente_nombre ?? ""} ${o.equipo_descripcion ?? ""} ${
        o.equipo_serie ?? ""
      }`.toLowerCase();
      return hay.includes(needle);
    });
  }, [enriquecidas, q, estado]);

  const open = (id) => navigate(`/ops/ordenes/${id}`);
  const sedeLabel = SEDE_LABEL[perfil?.sede_id] ?? perfil?.sede_id ?? "tu sede";

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Órdenes de Trabajo"
        description={`Todas las sedes · gestionas las de ${sedeLabel}`}
        actions={
          <>
            <ViewToggle view={view} setView={setView} />
            <button
              onClick={() => navigate("/ops/ordenes/nueva")}
              className="inline-flex items-center gap-2 rounded-lg px-4 text-sm font-semibold"
              style={{
                height: 48,
                backgroundColor: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
              }}
            >
              <Plus className="h-4 w-4" strokeWidth={2.2} />
              <span className="hidden sm:inline">Nueva OT</span>
            </button>
          </>
        }
      />

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border px-4 py-3 text-sm"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.3)",
            color: "hsl(var(--destructive))",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Filtros: búsqueda + estado */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div
          className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl border px-3.5"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--card))",
          }}
        >
          <Search
            className="h-4 w-4 shrink-0"
            strokeWidth={1.6}
            style={{ color: "hsl(var(--muted-foreground))" }}
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por cliente, equipo o serie…"
            className="min-w-0 flex-1 border-none bg-transparent text-sm outline-none"
            style={{ color: "hsl(var(--foreground))" }}
          />
          {q && (
            <button
              onClick={() => setQ("")}
              aria-label="Limpiar búsqueda"
              className="grid h-6 w-6 place-items-center rounded"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              <X className="h-4 w-4" strokeWidth={1.8} />
            </button>
          )}
        </div>
        <select
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          className="h-12 rounded-xl border px-3 text-sm font-medium outline-none"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--card))",
            color: "hsl(var(--foreground))",
          }}
        >
          <option value="todos">Todos los estados</option>
          {ESTADOS_FLUJO.map((e) => (
            <option key={e} value={e}>
              {ESTADO_LABEL[e] ?? e}
            </option>
          ))}
        </select>
      </div>

      {/* Contenido */}
      {loading ? (
        <Skeleton view={view} />
      ) : filtradas.length === 0 ? (
        <Empty filtro={q || estado !== "todos"} />
      ) : view === "lista" ? (
        <ListView rows={filtradas} onOpen={open} />
      ) : (
        <KanbanView rows={filtradas} onOpen={open} />
      )}
    </div>
  );
}

/* ─────────────────────────── Toggle de vista ──────────────────────────── */

function ViewToggle({ view, setView }) {
  const opciones = [
    { v: "lista", label: "Lista", Icon: List },
    { v: "kanban", label: "Kanban", Icon: LayoutGrid },
  ];
  return (
    <div
      className="flex items-center gap-0.5 rounded-xl p-1"
      style={{ backgroundColor: "hsl(var(--muted) / 0.5)" }}
    >
      {opciones.map(({ v, label, Icon }) => {
        const on = view === v;
        return (
          <button
            key={v}
            onClick={() => setView(v)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors"
            style={{
              height: 40,
              backgroundColor: on ? "hsl(var(--card))" : "transparent",
              color: on
                ? "hsl(var(--foreground))"
                : "hsl(var(--muted-foreground))",
              boxShadow: on
                ? "0 1px 2px hsl(var(--foreground) / 0.08)"
                : "none",
            }}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── Píldora de estado ────────────────────────── */

function EstadoPill({ estado }) {
  const s = estadoEstilo(estado);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{
        backgroundColor: s.bg,
        color: s.fg,
        border: `1px solid ${s.border}`,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: s.dot }}
      />
      {s.label}
    </span>
  );
}

function VencidaBadge() {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{
        backgroundColor: "hsl(var(--destructive) / 0.12)",
        color: "hsl(var(--destructive))",
      }}
    >
      Vencida
    </span>
  );
}

function CandadoSede({ sedeId }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium"
      style={{ color: "hsl(var(--muted-foreground))" }}
    >
      <Lock className="h-3 w-3" strokeWidth={2} />
      {SEDE_LABEL[sedeId] ?? sedeId}
    </span>
  );
}

/* ─────────────────── Vista lista (desktop tabla / mobile cards) ────────── */

function ListView({ rows, onOpen }) {
  return (
    <>
      {/* Móvil: cards */}
      <ul className="md:hidden space-y-2.5" role="list">
        {rows.map((o) => (
          <li key={o.id}>
            <OrdenCard orden={o} onClick={() => onOpen(o.id)} />
          </li>
        ))}
      </ul>

      {/* Desktop: tabla */}
      <div
        className="hidden md:block overflow-x-auto rounded-xl border"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ backgroundColor: "hsl(var(--muted) / 0.3)" }}>
              <Th>OT</Th>
              <Th>Cliente / Equipo</Th>
              <Th>Estado</Th>
              <Th>Sede</Th>
              <Th center>Días en taller</Th>
              <Th right>Total</Th>
              <Th right>Saldo</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <OrdenFila key={o.id} orden={o} onClick={() => onOpen(o.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Th({ children, right, center }) {
  return (
    <th
      className={
        "whitespace-nowrap border-b px-3 py-3 text-[11px] font-semibold uppercase tracking-wide " +
        (right ? "text-right" : center ? "text-center" : "text-left")
      }
      style={{
        borderColor: "hsl(var(--border))",
        color: "hsl(var(--muted-foreground))",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, right, center }) {
  return (
    <td
      className={
        "border-b px-3 py-2.5 align-middle text-sm " +
        (right ? "text-right" : center ? "text-center" : "text-left")
      }
      style={{ borderColor: "hsl(var(--border))" }}
    >
      {children}
    </td>
  );
}

function OrdenFila({ orden: o, onClick }) {
  return (
    <tr
      onClick={onClick}
      className="cursor-pointer transition-colors"
      style={{
        backgroundColor: "transparent",
        opacity: o._propia ? 1 : 0.7,
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.backgroundColor = "hsl(var(--muted) / 0.4)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
    >
      <Td>
        <div className="flex flex-col leading-tight">
          <span
            className="font-semibold"
            style={{ color: "hsl(var(--primary))" }}
          >
            {o.numero}
          </span>
          {o._vencida && (
            <span className="mt-0.5">
              <VencidaBadge />
            </span>
          )}
        </div>
      </Td>
      <Td>
        <div className="flex min-w-0 flex-col leading-tight">
          <span
            className="font-medium"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {o.cliente_nombre}
          </span>
          <span
            className="text-xs"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {o.equipo_descripcion}
            {o.equipo_serie ? ` · ${o.equipo_serie}` : ""}
          </span>
        </div>
      </Td>
      <Td>
        <EstadoPill estado={o.estado} />
      </Td>
      <Td>
        {o._propia ? (
          <span
            className="text-xs"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {SEDE_LABEL[o.sede_id] ?? o.sede_id}
          </span>
        ) : (
          <CandadoSede sedeId={o.sede_id} />
        )}
      </Td>
      <Td center>
        <span
          className="text-sm font-medium tabular-nums"
          style={{
            color: o._vencida
              ? "hsl(var(--destructive))"
              : "hsl(var(--muted-foreground))",
          }}
        >
          {o._dias}
        </span>
      </Td>
      <Td right>
        <span
          className="text-sm tabular-nums"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {formatCOP(o._total)}
        </span>
      </Td>
      <Td right>
        <span
          className="text-sm font-semibold tabular-nums"
          style={{
            color:
              o._saldo > 0 ? "hsl(var(--foreground))" : "hsl(var(--success))",
          }}
        >
          {formatCOP(o._saldo)}
        </span>
      </Td>
    </tr>
  );
}

function OrdenCard({ orden: o, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl border px-4 py-4 text-left transition-all active:scale-[0.99]"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: o._vencida
          ? "hsl(var(--destructive) / 0.4)"
          : "hsl(var(--border))",
        opacity: o._propia ? 1 : 0.7,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span
              className="text-xs font-semibold"
              style={{ color: "hsl(var(--primary))" }}
            >
              {o.numero}
            </span>
            {o._vencida && <VencidaBadge />}
            <EstadoPill estado={o.estado} />
          </div>
          <p
            className="truncate text-sm font-medium leading-tight"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {o.cliente_nombre}
          </p>
          <p
            className="mt-0.5 truncate text-xs"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {o.equipo_descripcion}
            {o.equipo_serie ? ` · ${o.equipo_serie}` : ""}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {o._propia ? (
              <span
                className="text-[11px]"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {SEDE_LABEL[o.sede_id] ?? o.sede_id}
              </span>
            ) : (
              <CandadoSede sedeId={o.sede_id} />
            )}
            <span
              className="text-[11px]"
              style={{
                color: o._vencida
                  ? "hsl(var(--destructive))"
                  : "hsl(var(--muted-foreground))",
              }}
            >
              {o._dias} {o._dias === 1 ? "día" : "días"} en taller
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p
            className="text-sm font-semibold tabular-nums"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {formatCOP(o._total)}
          </p>
          <p
            className="mt-0.5 text-xs tabular-nums"
            style={{
              color:
                o._saldo > 0
                  ? "hsl(var(--muted-foreground))"
                  : "hsl(var(--success))",
            }}
          >
            Saldo {formatCOP(o._saldo)}
          </p>
        </div>
      </div>
    </button>
  );
}

/* ─────────────────────────── Vista kanban ─────────────────────────────── */

function KanbanView({ rows, onOpen }) {
  return (
    <div className="flex gap-3.5 overflow-x-auto pb-2">
      {ESTADOS_FLUJO.map((grupo) => {
        const items = rows.filter((r) => r._grupo === grupo);
        const s = estadoEstilo(grupo);
        return (
          <div
            key={grupo}
            className="flex max-h-[74vh] flex-col rounded-xl border"
            style={{
              flex: "0 0 270px",
              backgroundColor: "hsl(var(--muted) / 0.3)",
              borderColor: "hsl(var(--border))",
            }}
          >
            <div
              className="flex items-center gap-2 border-b px-3.5 py-3"
              style={{ borderColor: "hsl(var(--border))" }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: s.dot }}
              />
              <span
                className="text-xs font-semibold"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {ESTADO_LABEL[grupo] ?? grupo}
              </span>
              <span
                className="ml-auto rounded-full border px-2 py-0.5 text-[11px] tabular-nums"
                style={{
                  backgroundColor: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                {items.length}
              </span>
            </div>
            <div className="flex flex-col gap-2.5 overflow-y-auto p-2.5">
              {items.length === 0 ? (
                <div
                  className="rounded-lg border border-dashed p-4 text-center text-[11px]"
                  style={{
                    borderColor: "hsl(var(--border))",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  Sin OT
                </div>
              ) : (
                items.map((o) => (
                  <KanbanCard
                    key={o.id}
                    orden={o}
                    onClick={() => onOpen(o.id)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({ orden: o, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg border px-3 py-3 text-left transition-all active:scale-[0.99]"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: o._vencida
          ? "hsl(var(--destructive) / 0.4)"
          : "hsl(var(--border))",
        opacity: o._propia ? 1 : 0.7,
      }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span
          className="text-xs font-semibold"
          style={{ color: "hsl(var(--primary))" }}
        >
          {o.numero}
        </span>
        {!o._propia ? (
          <CandadoSede sedeId={o.sede_id} />
        ) : o._vencida ? (
          <VencidaBadge />
        ) : null}
      </div>
      <div
        className="truncate text-sm font-medium leading-tight"
        style={{ color: "hsl(var(--foreground))" }}
      >
        {o.cliente_nombre}
      </div>
      <div
        className="mt-0.5 truncate text-xs"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {o.equipo_descripcion}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className="text-[11px]"
          style={{
            color: o._vencida
              ? "hsl(var(--destructive))"
              : "hsl(var(--muted-foreground))",
          }}
        >
          {o._dias} {o._dias === 1 ? "día" : "días"}
        </span>
        <span
          className="text-xs font-semibold tabular-nums"
          style={{
            color:
              o._saldo > 0 ? "hsl(var(--foreground))" : "hsl(var(--success))",
          }}
        >
          {formatCOP(o._saldo)}
        </span>
      </div>
    </button>
  );
}

/* ─────────────────────────── Estados de carga / vacío ─────────────────── */

function Skeleton({ view }) {
  if (view === "kanban") {
    return (
      <div className="flex gap-3.5 overflow-hidden">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="h-64 animate-pulse rounded-xl border"
            style={{
              flex: "0 0 270px",
              backgroundColor: "hsl(var(--muted) / 0.3)",
              borderColor: "hsl(var(--border))",
            }}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-xl border"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        />
      ))}
    </div>
  );
}

function Empty({ filtro }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div
        className="mb-4 grid h-14 w-14 place-items-center rounded-xl"
        style={{
          backgroundColor: "hsl(var(--muted) / 0.5)",
          color: "hsl(var(--muted-foreground))",
        }}
      >
        <Wrench className="h-7 w-7" strokeWidth={1.5} />
      </div>
      <p className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>
        No hay órdenes
      </p>
      <p
        className="mt-1 text-sm"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {filtro
          ? "Ninguna orden coincide con los filtros."
          : 'Crea la primera con "Nueva OT".'}
      </p>
    </div>
  );
}
