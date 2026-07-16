import { useState, useEffect, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Plus, Receipt, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../../lib/utils";
import { useFiltros } from "../../../hooks/useFiltros";
import { useSedes } from "../../../hooks/useSedes";
import { useAuthStore } from "../../../stores/authStore";
import BarraFiltros from "../../../components/filtros/BarraFiltros";
import {
  RECIBOS_TABS,
  RECIBOS_TIPOS,
  aplicarTipoRecibo,
  reciboEstadoLabel,
  reciboEstadoPillClass,
  reciboTipo,
  reciboTipoPillStyle,
  reciboAvatar,
} from "../../../lib/recibos-ui";

/**
 * Historial de recibos de pago — Fase 14 (diseño Lovable).
 *
 * Filtros reales: la búsqueda, el rango de fechas, el estado, el tipo y la sede
 * viajan al servidor en la MISMA consulta, así que se cruzan entre sí. Antes la
 * búsqueda filtraba en memoria sobre las 200 filas cargadas y le decía "no se
 * encontraron recibos" al operario sobre recibos que sí existían.
 *
 * Las columnas Tipo / Origen / Emitido por se derivan de columnas REALES
 * (cotizacion_id, orden_id, recibido_por) — sin inventar datos.
 */

const POR_PAGINA = 50;

const COLUMNAS = `id, numero, fecha, cliente_nombre, concepto, total, monto_pagado,
   saldo, anulado, cotizacion_id, orden_id,
   recibidor:recibido_por(nombre)`;

export default function ReciboHistorial() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";
  const { sedes } = useSedes();

  const [recibos, setRecibos] = useState([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [filtro, setFiltro] = useState("Todos"); // Todos | Vigentes | Anulados
  const [tipo, setTipo] = useState(""); // "" | cot | ot | manual

  const campos = useMemo(
    () => [
      {
        id: "q",
        tipo: "texto",
        label: "Buscar",
        columnas: ["cliente_nombre", "cliente_nit", "concepto"],
        numericoA: "numero",
        debounce: 400,
      },
      {
        id: "rango",
        tipo: "fecha",
        label: "Fecha",
        columna: "fecha",
        presets: ["hoy", "semana", "mes", "mesPasado"],
      },
      {
        id: "sede",
        tipo: "opciones",
        label: "Sede",
        columna: "sede_id",
        opciones: sedes.map((s) => ({ v: s.id, l: s.nombre })),
        // Solo Admin: al resto la RLS ya lo ata a su sede, un selector ahí
        // solo ofrece filtrar por sedes que nunca va a ver.
        visible: esAdmin,
      },
    ],
    [sedes, esAdmin],
  );

  const f = useFiltros({ clave: "recibos", campos });
  const { valoresAplicados, aplicar, nuevoReqId, esReqVigente } = f;

  // Cualquier cambio de filtro devuelve el listado a la primera página: quedarse
  // en la página 4 de un filtro nuevo se lee como "no hay nada".
  useEffect(() => {
    setPagina(0);
  }, [valoresAplicados, filtro, tipo]);

  useEffect(() => {
    let cancelado = false;
    const cargar = async () => {
      setLoading(true);
      setErrorMsg("");
      const reqId = nuevoReqId();
      try {
        let q = supabase.from("recibos").select(COLUMNAS, { count: "exact" });
        q = aplicar(q);
        if (filtro === "Vigentes") q = q.eq("anulado", false);
        if (filtro === "Anulados") q = q.eq("anulado", true);
        q = aplicarTipoRecibo(q, tipo);
        q = q
          .order("fecha", { ascending: false })
          .order("numero", { ascending: false })
          .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
        const { data, count, error } = await q;
        if (error) throw error;
        if (cancelado || !esReqVigente(reqId)) return;
        setRecibos(data ?? []);
        setTotal(count ?? 0);
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
  }, [
    valoresAplicados,
    filtro,
    tipo,
    pagina,
    aplicar,
    nuevoReqId,
    esReqVigente,
  ]);

  // Dinero de la PÁGINA visible, no del filtro completo: sumar todo el filtro
  // exigiría traerse las filas enteras. Por eso se rotula "en vista" y no se
  // presenta como el total cobrado.
  const cobradoEnVista = useMemo(
    () =>
      recibos
        .filter((r) => !r.anulado)
        .reduce((s, r) => s + (Number(r.monto_pagado) || 0), 0),
    [recibos],
  );

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const desde = total === 0 ? 0 : pagina * POR_PAGINA + 1;
  const hasta = Math.min(total, pagina * POR_PAGINA + recibos.length);
  const busquedaActiva = String(valoresAplicados.q ?? "").trim();
  const hayFiltroAlguno =
    f.hayFiltros || filtro !== "Todos" || tipo !== "" || !!busquedaActiva;

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
                  {total}
                </b>{" "}
                {total === 1 ? "recibo" : "recibos"}
                {hayFiltroAlguno ? " con estos filtros" : ""} ·{" "}
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-900)" }}
                >
                  {formatCOP(cobradoEnVista)}
                </b>{" "}
                recibido (vigentes, en vista)
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

      {/* ── Tipo de recibo ──────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {RECIBOS_TIPOS.map((t) => {
          const on = tipo === t.v;
          return (
            <button
              key={t.v || "todos"}
              onClick={() => setTipo(t.v)}
              aria-pressed={on}
              className="rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors"
              style={{
                borderColor: on ? "var(--p-200)" : "var(--n-200)",
                backgroundColor: on ? "var(--p-50)" : "transparent",
                color: on ? "var(--p-700)" : "var(--n-500)",
              }}
              onMouseEnter={(e) => {
                if (!on) e.currentTarget.style.backgroundColor = "var(--n-50)";
              }}
              onMouseLeave={(e) => {
                if (!on) e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Búsqueda + filtros reales (server-side, se cruzan) ──────── */}
      <BarraFiltros
        filtros={f}
        placeholder="Buscar por número, cliente, NIT o concepto…"
        legacy
      />

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
      ) : recibos.length === 0 ? (
        <EmptyState busqueda={busquedaActiva} hayFiltros={hayFiltroAlguno} />
      ) : (
        <>
          {/* Móvil/Tablet: cards (< md) */}
          <ul className="md:hidden space-y-2.5" role="list">
            {recibos.map((r) => (
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
                  {recibos.map((r) => (
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
                  {desde}–{hasta}
                </strong>{" "}
                de{" "}
                <strong className="font-mono" style={{ color: "var(--n-950)" }}>
                  {total}
                </strong>
              </span>
              <span className="font-mono">
                Recibido (vigentes, en vista) ·{" "}
                <strong style={{ color: "var(--n-950)" }}>
                  {formatCOP(cobradoEnVista)}
                </strong>
              </span>
            </div>
          </div>

          <Paginador pagina={pagina} paginas={paginas} onCambiar={setPagina} />
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

/**
 * Paginación real sobre el total del servidor. Antes el listado se truncaba en
 * 200 filas sin decirlo: el recibo 201 simplemente no existía para el operario.
 */
function Paginador({ pagina, paginas, onCambiar }) {
  if (paginas <= 1) return null;
  const btn = {
    borderColor: "var(--n-200)",
    backgroundColor: "var(--n-0)",
    color: "var(--n-700)",
  };
  return (
    <div className="flex items-center justify-center gap-3">
      <button
        onClick={() => onCambiar(Math.max(0, pagina - 1))}
        disabled={pagina === 0}
        aria-label="Página anterior"
        className="inline-flex items-center gap-1.5 rounded-[10px] border px-4 text-[13px] font-medium disabled:opacity-40"
        style={{ ...btn, height: 48 }}
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={2} />
        Anterior
      </button>
      <span
        className="font-mono text-[12.5px] tabular-nums"
        style={{ color: "var(--n-500)" }}
      >
        {pagina + 1} / {paginas}
      </span>
      <button
        onClick={() => onCambiar(Math.min(paginas - 1, pagina + 1))}
        disabled={pagina >= paginas - 1}
        aria-label="Página siguiente"
        className="inline-flex items-center gap-1.5 rounded-[10px] border px-4 text-[13px] font-medium disabled:opacity-40"
        style={{ ...btn, height: 48 }}
      >
        Siguiente
        <ChevronRight className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
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

function EmptyState({ busqueda, hayFiltros }) {
  // Distinguir "no hay recibos" de "el filtro no encontró nada" evita que un
  // filtro activo se lea como base de datos vacía.
  const mensaje = busqueda
    ? `No se encontraron recibos para "${busqueda}"`
    : hayFiltros
      ? "Ningún recibo coincide con los filtros activos"
      : "Aún no hay recibos emitidos";
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
        {mensaje}
      </p>
    </div>
  );
}
