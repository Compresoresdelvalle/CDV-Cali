import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, PackageOpen, Search } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import {
  formatCOP,
  formatDate,
  sanitizeSearch,
  safeError,
} from "../../lib/utils";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import {
  COMPRAS_TABS,
  COMPRAS_TIPO_TABS,
  compraEstadoPill,
  compraTipoBadge,
  comprasHeaderStats,
} from "../../lib/compras-ui";

const PAGE_SIZE = 20;

export default function CompraHistorial() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const { confirm, ConfirmDialog } = useConfirm();
  // El Vendedor es "todero": también recibe mercancía (decisión del dueño;
  // el RPC fn_recibir_compra lo permite para su sede).
  const puedeRecibirCompra = ["Admin", "Bodeguero", "Vendedor"].includes(
    perfil?.rol,
  );

  const [compras, setCompras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("Todas");
  const [tipo, setTipo] = useState("Todos");
  const [busqueda, setBusqueda] = useState("");
  const [busquedaActiva, setBusquedaActiva] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [recibiendoId, setRecibiendoId] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  // Token de secuencia: descarta respuestas obsoletas (cambio de filtro
  // mientras hay una carga en vuelo) para no mezclar resultados.
  const reqIdRef = useRef(0);

  const cargarCompras = useCallback(
    async (reset = false) => {
      const myReq = ++reqIdRef.current;
      setLoading(true);
      setErrorMsg(null);
      const currentPage = reset ? 0 : page;
      try {
        let query = supabase
          .from("compras")
          .select(
            `id, numero, fecha, fecha_recepcion, proveedor, factura_proveedor,
             total, recibida, estado, es_caja_menor, concepto,
             registrador:registrado_por(nombre)`,
          )
          .order("fecha", { ascending: false })
          .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

        if (perfil?.rol !== "Admin")
          query = query.eq("sede_destino_id", perfil?.sede_id);
        if (filtro === "Registrada") query = query.eq("recibida", false);
        if (filtro === "Recibida") query = query.eq("recibida", true);
        if (filtro === "Garantía")
          query = query.eq("estado", "devolucion_garantia");
        // Filtro por tipo: orden de compra formal vs. gasto de caja menor.
        if (tipo === "Órdenes de compra")
          query = query.eq("es_caja_menor", false);
        if (tipo === "Caja menor") query = query.eq("es_caja_menor", true);

        // Búsqueda server-side por proveedor, factura o concepto (caja menor).
        const needle = busquedaActiva.trim();
        if (needle.length >= 2) {
          const safe = sanitizeSearch(needle);
          query = query.or(
            `proveedor.ilike.%${safe}%,factura_proveedor.ilike.%${safe}%,concepto.ilike.%${safe}%`,
          );
        }

        const { data, error } = await query;
        if (myReq !== reqIdRef.current) return; // respuesta obsoleta
        if (error) throw error;

        if (reset) {
          setCompras(data ?? []);
          setPage(1);
        } else {
          setCompras((prev) => [...prev, ...(data ?? [])]);
          setPage((p) => p + 1);
        }
        setHasMore((data ?? []).length === PAGE_SIZE);
      } catch {
        if (myReq === reqIdRef.current)
          setErrorMsg("No se pudieron cargar las compras. Reintenta.");
      } finally {
        if (myReq === reqIdRef.current) setLoading(false);
      }
    },
    // S6-F: `page` DEBE estar en las dependencias — sin ella, "Cargar más"
    // usaba un closure congelado con page=0 y re-pedía siempre la primera
    // página (filas duplicadas, nunca avanzaba). El useEffect de abajo depende
    // de los filtros (no de esta función), así que no provoca re-fetchs.
    [filtro, tipo, busquedaActiva, perfil?.rol, perfil?.sede_id, page],
  );

  useEffect(() => {
    cargarCompras(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro, tipo, busquedaActiva]);

  // Debounce 400ms (estándar UX de operarios — ver CLAUDE.md).
  const aplicarBusqueda = useDebouncedCallback((val) => {
    setBusquedaActiva(val);
  }, 400);

  const handleBusqueda = (e) => {
    const val = e.target.value;
    setBusqueda(val);
    aplicarBusqueda(val);
  };

  const marcarRecibida = async (compraId) => {
    // C-01: recibir ingresa stock al inventario y es difícil de revertir →
    // confirmación explícita. La recepción parcial (por línea) se hace desde
    // el detalle de la compra; aquí es recepción completa rápida.
    const compra = compras.find((c) => c.id === compraId);
    const ok = await confirm({
      titulo: "Confirmar recepción",
      mensaje: `Se recibirá la compra #${compra?.numero ?? "?"} completa e ingresará el stock al inventario. Si el proveedor entregó incompleto, usa el detalle de la compra para registrar una recepción parcial.`,
      confirmLabel: "Sí, recibir",
    });
    if (!ok) return;
    setRecibiendoId(compraId);
    setErrorMsg(null);
    try {
      // S6-08/S6-A: toda recepción pasa por la RPC (ajusta stock, movimientos,
      // costo y protege el estado). null = recibe todo tal cual.
      const { error } = await supabase.rpc("fn_recibir_compra", {
        p_compra_id: compraId,
      });
      if (error) throw error;
      setCompras((prev) =>
        prev.map((c) =>
          c.id === compraId
            ? {
                ...c,
                recibida: true,
                fecha_recepcion: new Date().toISOString(),
              }
            : c,
        ),
      );
    } catch (err) {
      // S6-06: mostrar el motivo real (p.ej. recibir una cancelada) en vez de
      // un genérico que oculta qué pasó.
      setErrorMsg(
        safeError(err, "No se pudo marcar la compra como recibida. Reintenta."),
      );
    } finally {
      setRecibiendoId(null);
    }
  };

  const stats = comprasHeaderStats(compras);

  return (
    <div className="flex h-full flex-col animate-fade-in">
      {/* ── Encabezado con KPIs ─────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-start gap-4 border-b px-4 pb-4 pt-5 sm:px-7 sm:pt-6"
        style={{
          borderColor: "var(--n-100)",
          backgroundColor: "var(--n-0)",
        }}
      >
        <div className="min-w-0 flex-1">
          <h1
            className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--n-950)" }}
          >
            Compras
          </h1>
          <p
            className="mt-1.5 text-[13px] leading-[1.5]"
            style={{ color: "var(--n-500)" }}
          >
            <b
              className="font-mono font-medium"
              style={{ color: "var(--n-700)" }}
            >
              {loading && compras.length === 0 ? "…" : stats.count}
              {hasMore ? "+" : ""}
            </b>{" "}
            registros ·{" "}
            <b
              className="font-mono font-medium"
              style={{ color: "var(--n-700)" }}
            >
              {formatCOP(stats.comprado)}
            </b>{" "}
            comprado ·{" "}
            <b
              className="font-mono font-medium"
              style={{ color: "var(--n-700)" }}
            >
              {stats.pendientes}
            </b>{" "}
            pendientes de recepción
          </p>
        </div>
        <button
          onClick={() => navigate("/ops/compras/nueva")}
          className="btn btn-pri shrink-0"
          style={{ height: 48 }}
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Nueva compra
        </button>
      </div>

      <div className="flex flex-col gap-4 px-4 pb-14 pt-4 sm:px-7">
        {/* ── Tabs segmentadas (estilo Lovable) ─────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="inline-flex items-center gap-0.5 rounded-lg p-[3px]"
            style={{ backgroundColor: "var(--n-100)" }}
          >
            {COMPRAS_TABS.map((f) => {
              const active = filtro === f;
              return (
                <button
                  key={f}
                  onClick={() => setFiltro(f)}
                  className="rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors"
                  style={{
                    backgroundColor: active ? "var(--n-0)" : "transparent",
                    color: active ? "var(--n-950)" : "var(--n-500)",
                    boxShadow: active ? "0 1px 2px rgba(14,16,24,.06)" : "none",
                  }}
                >
                  {f}
                </button>
              );
            })}
          </div>

          {/* Filtro por tipo: orden de compra vs. caja menor */}
          <div
            className="inline-flex items-center gap-0.5 rounded-lg p-[3px]"
            style={{ backgroundColor: "var(--n-100)" }}
          >
            {COMPRAS_TIPO_TABS.map((t) => {
              const active = tipo === t;
              return (
                <button
                  key={t}
                  onClick={() => setTipo(t)}
                  aria-pressed={active}
                  className="rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors"
                  style={{
                    backgroundColor: active ? "var(--n-0)" : "transparent",
                    color: active ? "var(--n-950)" : "var(--n-500)",
                    boxShadow: active ? "0 1px 2px rgba(14,16,24,.06)" : "none",
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Búsqueda server-side ──────────────────────────────────── */}
        <div
          className="flex items-center gap-2.5 rounded-lg border px-3"
          style={{
            height: 44,
            borderColor: "var(--n-150)",
            backgroundColor: "var(--n-0)",
          }}
        >
          <Search
            className="h-4 w-4 shrink-0"
            strokeWidth={1.7}
            style={{ color: "var(--n-300)" }}
          />
          <input
            value={busqueda}
            onChange={handleBusqueda}
            placeholder="Buscar por proveedor, N° de factura o concepto…"
            className="flex-1 border-none bg-transparent text-[13.5px] outline-none"
            style={{ color: "var(--n-700)" }}
          />
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
        {loading && compras.length === 0 ? (
          <SkeletonList />
        ) : compras.length === 0 ? (
          <EmptyState filtrando={busquedaActiva.trim().length >= 2} />
        ) : (
          <>
            {/* Móvil/Tablet: cards (< md) */}
            <ul className="md:hidden space-y-2.5" role="list">
              {compras.map((c) => (
                <li key={c.id}>
                  <CompraCard
                    compra={c}
                    puedeRecibir={puedeRecibirCompra}
                    recibiendoId={recibiendoId}
                    onMarcarRecibida={marcarRecibida}
                    onClick={() => navigate(`/ops/compras/${c.id}`)}
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
                      <Th width={92}>#</Th>
                      <Th width={108}>Fecha orden</Th>
                      <Th width={220}>Proveedor</Th>
                      <Th width={150}>Factura</Th>
                      <Th width={130} right>
                        Total
                      </Th>
                      <Th width={156}>Estado</Th>
                      <Th width={180}>Recepción</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {compras.map((c) => (
                      <CompraFila
                        key={c.id}
                        compra={c}
                        puedeRecibir={puedeRecibirCompra}
                        recibiendoId={recibiendoId}
                        onMarcarRecibida={marcarRecibida}
                        onClick={() => navigate(`/ops/compras/${c.id}`)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div
                className="flex items-center justify-between border-t px-4 py-3 text-[12px]"
                style={{
                  borderColor: "var(--n-100)",
                  backgroundColor: "var(--n-25)",
                  color: "var(--n-500)",
                }}
              >
                <span>
                  Mostrando{" "}
                  <b className="font-mono" style={{ color: "var(--n-950)" }}>
                    {compras.length}
                  </b>{" "}
                  {hasMore ? "+ " : ""}
                  compra{compras.length === 1 ? "" : "s"}
                </span>
                {busquedaActiva.trim().length >= 2 && (
                  <span className="font-mono">filtro: “{busquedaActiva}”</span>
                )}
              </div>
            </div>

            {/* Cargar más */}
            {hasMore && (
              <button
                onClick={() => cargarCompras(false)}
                disabled={loading}
                className="w-full rounded-[10px] border py-3 text-sm font-medium transition-colors disabled:opacity-50"
                style={{
                  minHeight: 48,
                  borderColor: "var(--n-150)",
                  color: "var(--n-500)",
                  backgroundColor: "var(--n-0)",
                }}
              >
                {loading ? "Cargando…" : "Cargar más"}
              </button>
            )}
          </>
        )}
      </div>
      <ConfirmDialog />
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function Th({ children, width, right }) {
  return (
    <th
      style={{ width, backgroundColor: "var(--n-25)", color: "var(--n-400)" }}
      className={
        "border-b px-3 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] " +
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
      className={"border-b px-3 py-2.5 " + (right ? "text-right" : "")}
      style={{ borderColor: "var(--n-75)" }}
    >
      {children}
    </td>
  );
}

/**
 * Barra de recepción. El backend solo modela recepción TOTAL (booleano
 * `recibida`), así que la barra es honesta: 100% si recibida, "Esperando"
 * si pendiente. NO se inventa recepción parcial inexistente.
 */
function RecepcionCell({ compra: c }) {
  if (c.estado === "devolucion_garantia") {
    return (
      <span
        className="font-mono text-[11.5px]"
        style={{ color: "var(--info-700)" }}
      >
        Con garantía
      </span>
    );
  }
  if (!c.recibida) {
    return (
      <span
        className="font-mono text-[11.5px]"
        style={{ color: "var(--n-300)" }}
      >
        Esperando
      </span>
    );
  }
  return (
    <div className="font-mono text-[11.5px]" style={{ color: "var(--n-700)" }}>
      <div className="mb-1">Completa</div>
      <div
        className="h-1 overflow-hidden rounded-full"
        style={{ backgroundColor: "var(--n-100)" }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: "100%", backgroundColor: "var(--succ-500)" }}
        />
      </div>
    </div>
  );
}

function RecibirButton({ compra, recibiendoId, onMarcarRecibida, full }) {
  const procesando = recibiendoId === compra.id;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onMarcarRecibida(compra.id);
      }}
      disabled={procesando}
      className={
        "rounded-lg border text-[12.5px] font-medium transition-colors disabled:opacity-50 whitespace-nowrap " +
        (full ? "w-full py-2.5" : "px-3 py-1.5")
      }
      style={{
        minHeight: full ? 48 : undefined,
        borderColor: "var(--succ-500)",
        color: "var(--succ-700)",
        backgroundColor: "var(--succ-50)",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.backgroundColor = "var(--succ-100)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.backgroundColor = "var(--succ-50)")
      }
    >
      {procesando ? "Procesando…" : full ? "Marcar como recibida" : "Recibir"}
    </button>
  );
}

function CompraFila({
  compra: c,
  puedeRecibir,
  recibiendoId,
  onMarcarRecibida,
  onClick,
}) {
  const pill = compraEstadoPill(c);
  const tipoBadge = compraTipoBadge(c.es_caja_menor);
  return (
    <tr
      onClick={onClick}
      className="cursor-pointer transition-colors"
      onMouseEnter={(e) =>
        (e.currentTarget.style.backgroundColor = "var(--p-50)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
    >
      <Td>
        <span
          className="font-mono text-[12.5px] font-medium"
          style={{ color: "var(--p-700)" }}
        >
          #{c.numero}
        </span>
      </Td>
      <Td>
        <span
          className="font-mono text-[11.5px]"
          style={{ color: "var(--n-500)" }}
        >
          {formatDate(c.fecha)}
        </span>
      </Td>
      <Td>
        <div className="flex flex-col gap-1">
          <span className={tipoBadge.cls} style={{ width: "fit-content" }}>
            <span className="dot" />
            {tipoBadge.label}
          </span>
          <span className="font-medium" style={{ color: "var(--n-950)" }}>
            {c.proveedor}
          </span>
          {c.es_caja_menor && c.concepto && (
            <span className="text-[11.5px]" style={{ color: "var(--n-500)" }}>
              {c.concepto}
            </span>
          )}
        </div>
      </Td>
      <Td>
        <span
          className="font-mono text-[11.5px]"
          style={{ color: "var(--n-500)" }}
        >
          {c.factura_proveedor ?? "—"}
        </span>
      </Td>
      <Td right>
        <span
          className="font-mono font-medium tabular-nums"
          style={{ color: "var(--n-950)" }}
        >
          {formatCOP(c.total)}
        </span>
      </Td>
      <Td>
        <span className={pill.cls}>
          <span className="dot" />
          {pill.label}
        </span>
      </Td>
      <Td>
        {/* S6-06: una compra cancelada no se puede recibir (el trigger lo
            rechaza); el botón solo confundía. */}
        {!c.recibida && c.estado !== "cancelada" && puedeRecibir ? (
          <RecibirButton
            compra={c}
            recibiendoId={recibiendoId}
            onMarcarRecibida={onMarcarRecibida}
          />
        ) : (
          <RecepcionCell compra={c} />
        )}
      </Td>
    </tr>
  );
}

function CompraCard({
  compra: c,
  puedeRecibir,
  recibiendoId,
  onMarcarRecibida,
  onClick,
}) {
  const pill = compraEstadoPill(c);
  const tipoBadge = compraTipoBadge(c.es_caja_menor);
  return (
    <div
      onClick={onClick}
      className="w-full cursor-pointer rounded-[10px] border px-4 py-3.5 text-left shadow-sm transition-all duration-100 active:scale-[0.985] active:shadow-none"
      style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span
              className="font-mono text-[12px] font-medium"
              style={{ color: "var(--p-700)" }}
            >
              #{c.numero}
            </span>
            <span className={tipoBadge.cls}>
              <span className="dot" />
              {tipoBadge.label}
            </span>
            <span className={pill.cls}>
              <span className="dot" />
              {pill.label}
            </span>
          </div>
          <p
            className="truncate text-[14px] font-medium leading-tight"
            style={{ color: "var(--n-950)" }}
          >
            {c.proveedor}
          </p>
          {c.es_caja_menor && c.concepto && (
            <p
              className="mt-0.5 truncate text-[12px]"
              style={{ color: "var(--n-600)" }}
            >
              {c.concepto}
            </p>
          )}
          <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--n-500)" }}>
            {formatDate(c.fecha)}
            {c.factura_proveedor && ` · Fact: ${c.factura_proveedor}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className="font-mono text-[15px] font-semibold tabular-nums"
            style={{ color: "var(--n-950)" }}
          >
            {formatCOP(c.total)}
          </p>
        </div>
      </div>
      {/* S6-06: no ofrecer recibir una compra cancelada. */}
      {!c.recibida && c.estado !== "cancelada" && puedeRecibir && (
        <div className="mt-3">
          <RecibirButton
            compra={c}
            recibiendoId={recibiendoId}
            onMarcarRecibida={onMarcarRecibida}
            full
          />
        </div>
      )}
    </div>
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

function EmptyState({ filtrando }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div
        className="mb-4 grid h-14 w-14 place-items-center rounded-[12px]"
        style={{ backgroundColor: "var(--p-50)", color: "var(--p-600)" }}
      >
        <PackageOpen className="h-7 w-7" strokeWidth={1.5} />
      </div>
      <p className="font-semibold" style={{ color: "var(--n-950)" }}>
        {filtrando ? "Sin resultados" : "Sin compras registradas"}
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--n-500)" }}>
        {filtrando
          ? "Ninguna compra coincide con tu búsqueda o filtro."
          : "Las órdenes de compra aparecerán aquí una vez creadas"}
      </p>
    </div>
  );
}
