import { useState, useEffect, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Search, Plus, X, Receipt } from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../../lib/utils";
import {
  RECIBOS_TABS,
  reciboEstadoLabel,
  reciboEstadoPillClass,
  reciboTipo,
  reciboTipoPillStyle,
  reciboAvatar,
} from "../../../lib/recibos-ui";

/**
 * Historial de recibos de pago — Fase 14 (re-vestido con diseño Lovable, alta
 * fidelidad). Lógica de datos intacta: filtro por `anulado` server-side,
 * límite 200. Las columnas Tipo / Origen / Emitido por se derivan de columnas
 * REALES (cotizacion_id, orden_id, recibido_por) — sin inventar datos.
 */
export default function ReciboHistorial() {
  const navigate = useNavigate();
  const [recibos, setRecibos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [filtro, setFiltro] = useState("Todos"); // Todos | Vigentes | Anulados
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    let cancelado = false;
    const cargar = async () => {
      setLoading(true);
      setErrorMsg("");
      try {
        let q = supabase
          .from("recibos")
          .select(
            `id, numero, fecha, cliente_nombre, concepto, total, monto_pagado,
             saldo, anulado, cotizacion_id, orden_id,
             recibidor:recibido_por(nombre)`,
          )
          .order("fecha", { ascending: false })
          .limit(200);
        if (filtro === "Vigentes") q = q.eq("anulado", false);
        if (filtro === "Anulados") q = q.eq("anulado", true);
        const { data, error } = await q;
        if (error) throw error;
        if (!cancelado) setRecibos(data ?? []);
      } catch (err) {
        if (!cancelado) setErrorMsg(safeError(err, "Error al cargar recibos"));
      } finally {
        if (!cancelado) setLoading(false);
      }
    };
    cargar();
    return () => {
      cancelado = true;
    };
  }, [filtro]);

  // Búsqueda client-side sobre las filas cargadas (solo presentación).
  const filtrados = useMemo(() => {
    const needle = busqueda.trim().toLowerCase();
    if (!needle) return recibos;
    return recibos.filter(
      (r) =>
        String(r.numero ?? "").includes(needle) ||
        (r.cliente_nombre ?? "").toLowerCase().includes(needle) ||
        (r.concepto ?? "").toLowerCase().includes(needle),
    );
  }, [recibos, busqueda]);

  // Totales derivados de las filas cargadas (solo presentación, sin inventar).
  const stats = useMemo(() => {
    const vigentes = filtrados.filter((r) => !r.anulado);
    const cobrado = vigentes.reduce(
      (s, r) => s + (Number(r.monto_pagado) || 0),
      0,
    );
    return { count: filtrados.length, cobrado };
  }, [filtrados]);

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-[18px] px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p
            className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ color: "var(--n-300)" }}
          >
            Operaciones · Caja
          </p>
          <h1
            className="text-[22px] font-semibold tracking-[-0.018em] sm:text-[24px]"
            style={{ color: "var(--n-950)" }}
          >
            Recibos
          </h1>
          <p
            className="mt-1.5 text-[13px] leading-[1.5]"
            style={{ color: "var(--n-500)" }}
          >
            {loading ? (
              "Cargando recibos…"
            ) : (
              <>
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-900)" }}
                >
                  {stats.count}
                </b>{" "}
                recibos ·{" "}
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-900)" }}
                >
                  {formatCOP(stats.cobrado)}
                </b>{" "}
                recibido (vigentes)
              </>
            )}
          </p>
        </div>
        <button
          onClick={() => navigate("/ops/recibos/nuevo")}
          className="btn btn-pri"
          style={{ height: 48 }}
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Nuevo recibo
        </button>
      </div>

      {/* ── Filtros (tabs) ──────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {RECIBOS_TABS.map((t) => {
          const on = filtro === t.v;
          return (
            <button
              key={t.v}
              onClick={() => setFiltro(t.v)}
              className="rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors"
              style={{
                backgroundColor: on ? "var(--n-100)" : "transparent",
                color: on ? "var(--n-900)" : "var(--n-500)",
              }}
              onMouseEnter={(e) => {
                if (!on) e.currentTarget.style.backgroundColor = "var(--n-50)";
              }}
              onMouseLeave={(e) => {
                if (!on) e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              {t.v}
            </button>
          );
        })}
      </div>

      {/* ── Búsqueda ────────────────────────────────────────────────── */}
      <div
        className="flex h-12 max-w-[560px] items-center gap-2.5 rounded-lg border px-3.5"
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
          placeholder="Buscar recibo por número, cliente o concepto…"
          className="min-w-0 flex-1 border-none bg-transparent text-[14px] outline-none"
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

      {/* ── Contenido ───────────────────────────────────────────────── */}
      {loading ? (
        <SkeletonList />
      ) : filtrados.length === 0 ? (
        <EmptyState busqueda={busqueda} />
      ) : (
        <>
          {/* Móvil/Tablet: cards (< md) */}
          <ul className="md:hidden space-y-2.5" role="list">
            {filtrados.map((r) => (
              <li key={r.id}>
                <ReciboCard
                  r={r}
                  onClick={() => navigate(`/ops/recibos/${r.id}`)}
                />
              </li>
            ))}
          </ul>

          {/* Desktop: tabla (≥ md) */}
          <div
            className="hidden min-w-0 overflow-hidden rounded-[10px] border md:block"
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
                    <Th width={116}>Fecha</Th>
                    <Th width={200}>Cliente</Th>
                    <Th>Concepto</Th>
                    <Th width={140}>Tipo</Th>
                    <Th width={138} right>
                      Recibido
                    </Th>
                    <Th width={150}>Emitido por</Th>
                    <Th width={110}>Estado</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((r) => (
                    <ReciboFila
                      key={r.id}
                      r={r}
                      onClick={() => navigate(`/ops/recibos/${r.id}`)}
                    />
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
                <strong className="font-mono" style={{ color: "var(--n-950)" }}>
                  {filtrados.length}
                </strong>{" "}
                recibos
              </span>
              <span className="font-mono">
                Recibido (vigentes) ·{" "}
                <strong style={{ color: "var(--n-950)" }}>
                  {formatCOP(stats.cobrado)}
                </strong>
              </span>
            </div>
          </div>
        </>
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
        "border-b px-3 py-2.5 align-middle " + (right ? "text-right" : "")
      }
      style={{ borderColor: "var(--n-100)", color: "var(--n-700)" }}
    >
      {children}
    </td>
  );
}

function TipoPill({ r }) {
  const tipo = reciboTipo(r);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
      style={reciboTipoPillStyle(tipo.tone)}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: "currentColor", opacity: 0.7 }}
      />
      {tipo.label}
    </span>
  );
}

function EmisorMini({ nombre }) {
  const av = reciboAvatar(nombre);
  return (
    <span
      className="inline-flex items-center gap-2 text-[12.5px]"
      style={{ color: "var(--n-700)" }}
    >
      <span className={`av-mini ${av.variant}`}>{av.ini}</span>
      {av.nombre}
    </span>
  );
}

function ReciboFila({ r, onClick }) {
  return (
    <tr
      onClick={onClick}
      className="cursor-pointer transition-colors"
      style={{ opacity: r.anulado ? 0.6 : 1 }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.backgroundColor = "var(--n-50)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
    >
      <Td>
        <Link
          to={`/ops/recibos/${r.id}`}
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-[12.5px] font-medium hover:underline"
          style={{ color: "var(--n-950)" }}
        >
          #{r.numero}
        </Link>
      </Td>
      <Td>
        <span
          className="font-mono text-[11.5px]"
          style={{ color: "var(--n-500)" }}
        >
          {formatDate(r.fecha)}
        </span>
      </Td>
      <Td>
        <span
          className="block max-w-[190px] truncate font-medium"
          style={{ color: "var(--n-950)" }}
        >
          {r.cliente_nombre}
        </span>
      </Td>
      <Td>
        <span
          className="block max-w-[280px] truncate text-[12.5px]"
          style={{ color: "var(--n-700)" }}
        >
          {r.concepto || "—"}
        </span>
      </Td>
      <Td>
        <TipoPill r={r} />
      </Td>
      <Td right>
        <span
          className="font-mono text-[13px] font-medium tabular-nums"
          style={{
            color: r.anulado ? "var(--n-300)" : "var(--n-950)",
            textDecoration: r.anulado ? "line-through" : undefined,
          }}
        >
          {formatCOP(r.monto_pagado)}
        </span>
      </Td>
      <Td>
        <EmisorMini nombre={r.recibidor?.nombre} />
      </Td>
      <Td>
        <span className={reciboEstadoPillClass(r.anulado)}>
          <span className="dot" />
          {reciboEstadoLabel(r.anulado)}
        </span>
      </Td>
    </tr>
  );
}

function ReciboCard({ r, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-[10px] border px-4 py-3.5 text-left shadow-sm transition-all duration-100 active:scale-[0.985] active:shadow-none"
      style={{
        borderColor: "var(--n-150)",
        backgroundColor: "var(--n-0)",
        opacity: r.anulado ? 0.6 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p
              className="font-mono text-[13px] font-semibold"
              style={{ color: "var(--p-700)" }}
            >
              #{r.numero}
            </p>
            <TipoPill r={r} />
          </div>
          <p
            className="mt-0.5 truncate text-[14px] font-medium"
            style={{ color: "var(--n-950)" }}
          >
            {r.cliente_nombre}
          </p>
          <p
            className="mt-0.5 truncate text-[12px]"
            style={{ color: "var(--n-500)" }}
          >
            {r.concepto || "—"}
          </p>
          <div className="mt-1.5">
            <EmisorMini nombre={r.recibidor?.nombre} />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className="font-mono text-[16px] font-semibold leading-none"
            style={{
              color: r.anulado ? "var(--n-300)" : "var(--n-950)",
              textDecoration: r.anulado ? "line-through" : undefined,
            }}
          >
            {formatCOP(r.monto_pagado)}
          </span>
          <span className="text-[10px]" style={{ color: "var(--n-500)" }}>
            Total {formatCOP(r.total)}
          </span>
          <span className={reciboEstadoPillClass(r.anulado)}>
            <span className="dot" />
            {reciboEstadoLabel(r.anulado)}
          </span>
        </div>
      </div>
    </button>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-2.5">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-[10px] border"
          style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
        />
      ))}
    </div>
  );
}

function EmptyState({ busqueda }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
      <div
        className="mb-4 grid h-14 w-14 place-items-center rounded-[12px]"
        style={{ backgroundColor: "var(--p-50)", color: "var(--p-600)" }}
      >
        <Receipt className="h-7 w-7" strokeWidth={1.5} />
      </div>
      <p className="font-semibold" style={{ color: "var(--n-950)" }}>
        Sin recibos
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--n-500)" }}>
        {busqueda
          ? `No se encontraron recibos para "${busqueda}"`
          : "Aún no hay recibos emitidos"}
      </p>
    </div>
  );
}
