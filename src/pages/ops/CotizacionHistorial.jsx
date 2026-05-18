import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import { generarCotizacionPDF } from "../../lib/pdf/cotizacionPDF";

/** Carga datos completos de una cotización y dispara descarga PDF */
async function generarPDFDirecto(cotizacionId) {
  const [{ data: cot }, { data: items }, { data: cuentasRaw }] =
    await Promise.all([
      supabase
        .from("cotizaciones")
        .select(`*, vendedor:vendedor_id(nombre)`)
        .eq("id", cotizacionId)
        .single(),
      supabase
        .from("detalle_cotizacion")
        .select(`*, producto:producto_id(nombre, referencia, unidad_medida)`)
        .eq("cotizacion_id", cotizacionId),
      supabase
        .from("cotizacion_cuentas_bancarias")
        .select("cuenta:cuenta_id(banco, tipo, numero, titular, marca_iva)")
        .eq("cotizacion_id", cotizacionId),
    ]);
  const cuentas = (cuentasRaw ?? []).map((r) => r.cuenta).filter(Boolean);
  const pdf = generarCotizacionPDF({
    cotizacion: cot,
    items: items ?? [],
    cuentas,
    vendedor: cot?.vendedor?.nombre ?? "—",
  });
  pdf.download();
}

const ESTADOS = [
  "Todos",
  "borrador",
  "enviada",
  "aprobada",
  "rechazada",
  "vencida",
];
const ESTADO_LABELS = {
  borrador: "Borrador",
  enviada: "Enviada",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  vencida: "Vencida",
};

const PAGE_SIZE = 20;

export default function CotizacionHistorial() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";

  const [cotizaciones, setCotizaciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState("Todos");
  const [busqueda, setBusqueda] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const [convirtiendo, setConvirtiendo] = useState(null);
  const [errorConversion, setErrorConversion] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  // Token de secuencia: descarta respuestas obsoletas al cambiar de filtro.
  const reqIdRef = useRef(0);
  const convirtiendoRef = useRef(false);

  const cargarCotizaciones = async (reset = false) => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setErrorMsg(null);
    const currentPage = reset ? 0 : page;

    try {
      let query = supabase
        .from("cotizaciones")
        .select(
          `id, numero, fecha, cliente_nombre, estado, total, vigencia_dias, ot_id, venta_id,
           vendedor:vendedor_id(nombre), ot:ot_id(numero)`,
        )
        .order("fecha", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (!esAdmin) query = query.eq("sede_id", perfil?.sede_id);
      if (filtroEstado !== "Todos") query = query.eq("estado", filtroEstado);

      const { data, error } = await query;
      if (myReq !== reqIdRef.current) return; // respuesta obsoleta
      if (error) throw error;

      if (reset) {
        setCotizaciones(data ?? []);
        setPage(1);
      } else {
        setCotizaciones((prev) => [...prev, ...(data ?? [])]);
        setPage((p) => p + 1);
      }
      setHasMore((data ?? []).length === PAGE_SIZE);
    } catch {
      if (myReq === reqIdRef.current)
        setErrorMsg("No se pudieron cargar las cotizaciones. Reintenta.");
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargarCotizaciones(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroEstado]);

  const convertirEnVenta = async (e, cotizacionId) => {
    e.stopPropagation();
    if (convirtiendoRef.current) return; // guard síncrono anti doble-click
    convirtiendoRef.current = true;
    setConvirtiendo(cotizacionId);
    setErrorConversion(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc(
        "fn_convertir_cotizacion",
        { p_cotizacion_id: cotizacionId },
      );
      if (rpcErr) throw new Error(rpcErr.message);
      navigate(`/ops/ventas/${data.venta_id}`);
    } catch (e) {
      setErrorConversion({
        id: cotizacionId,
        msg: safeError(e, "Error al convertir"),
      });
    } finally {
      setConvirtiendo(null);
      convirtiendoRef.current = false;
    }
  };

  // Client-side search filter
  const filtradas = busqueda.trim()
    ? cotizaciones.filter(
        (c) =>
          c.cliente_nombre?.toLowerCase().includes(busqueda.toLowerCase()) ||
          String(c.numero).includes(busqueda),
      )
    : cotizaciones;

  return (
    <div
      className="flex flex-col min-h-full p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      {/* ── PageHeader ── */}
      <PageHeader
        title="Cotizaciones"
        description={`${cotizaciones.length}${hasMore ? "+" : ""} cotizaciones`}
        actions={
          <button
            onClick={() => navigate("/ops/cotizaciones/nueva")}
            className="flex items-center gap-2 h-9 px-3 rounded-lg text-sm font-medium transition-all cursor-pointer"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            <PlusIcon />
            <span className="hidden sm:inline">Nueva cotización</span>
            <span className="sm:hidden">Nueva</span>
          </button>
        }
      />

      {/* ── Filtros ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Búsqueda */}
        <div className="relative flex-1 min-w-[180px]">
          <SearchIcon
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "hsl(var(--muted-foreground))" }}
          />
          <input
            type="search"
            placeholder="Buscar por cliente o #..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full pl-9 pr-4 h-9 rounded-lg border text-sm focus:outline-none transition-all"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          />
        </div>

        {/* Estado chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {ESTADOS.map((e) => {
            const active = filtroEstado === e;
            return (
              <button
                key={e}
                onClick={() => setFiltroEstado(e)}
                className="h-9 px-3 rounded-lg text-xs font-semibold border transition-all cursor-pointer capitalize"
                style={
                  active
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
                {e === "Todos" ? "Todos" : (ESTADO_LABELS[e] ?? e)}
              </button>
            );
          })}
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.4)",
            color: "hsl(var(--destructive))",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* ── Contenido ── */}
      <div className="flex-1 min-w-0">
        {/* Loading */}
        {loading && cotizaciones.length === 0 && (
          <div className="flex flex-col gap-3">
            {[...Array(5)].map((_, i) => (
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
                      className="h-4 rounded w-1/4"
                      style={{ backgroundColor: "hsl(var(--muted))" }}
                    />
                    <div
                      className="h-3 rounded w-1/2"
                      style={{ backgroundColor: "hsl(var(--muted))" }}
                    />
                  </div>
                  <div
                    className="h-6 w-20 rounded"
                    style={{ backgroundColor: "hsl(var(--muted))" }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sin resultados */}
        {!loading && filtradas.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-5xl mb-4">📋</div>
            <p
              className="font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Sin cotizaciones
            </p>
            <p
              className="text-sm mt-1"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {busqueda
                ? `Sin resultados para "${busqueda}"`
                : filtroEstado !== "Todos"
                  ? `No hay cotizaciones ${ESTADO_LABELS[filtroEstado]?.toLowerCase()}`
                  : "Crea la primera cotización"}
            </p>
          </div>
        )}

        {filtradas.length > 0 && (
          <>
            {/* ── Vista MÓVIL: Cards ── */}
            <ul className="md:hidden space-y-2.5" role="list">
              {filtradas.map((c) => {
                const esteError =
                  errorConversion?.id === c.id ? errorConversion.msg : null;
                const puedeConvertir = c.estado === "aprobada" && !c.venta_id;
                // F11.5: solo aprobadas pueden convertirse a venta
                return (
                  <li key={c.id}>
                    <div
                      onClick={() => navigate(`/ops/cotizaciones/${c.id}`)}
                      className="rounded-xl px-4 py-3.5 border shadow-sm cursor-pointer transition-all duration-100"
                      style={{
                        backgroundColor: "hsl(var(--card))",
                        borderColor: "hsl(var(--border))",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.borderColor =
                          "hsl(var(--primary) / 0.3)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.borderColor =
                          "hsl(var(--border))")
                      }
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className="text-xs font-bold font-mono"
                              style={{ color: "hsl(var(--primary))" }}
                            >
                              #{c.numero}
                            </span>
                            {!c.venta_id && <StatusBadge status={c.estado} />}
                            {c.venta_id && (
                              <span
                                className="px-2 py-0.5 rounded text-[10px] font-semibold"
                                style={{
                                  backgroundColor: "hsl(var(--success) / 0.15)",
                                  color: "hsl(var(--success))",
                                }}
                                title="Esta cotización ya fue convertida en venta"
                              >
                                🛒 Convertida
                              </span>
                            )}
                            {c.ot && (
                              <span
                                className="px-2 py-0.5 rounded text-[10px] font-semibold"
                                style={{
                                  backgroundColor: "hsl(var(--info) / 0.15)",
                                  color: "hsl(var(--info))",
                                }}
                                title="Vinculada a OT"
                              >
                                🔗 OT #{c.ot.numero}
                              </span>
                            )}
                          </div>
                          <p
                            className="text-sm font-medium truncate"
                            style={{ color: "hsl(var(--foreground))" }}
                          >
                            {c.cliente_nombre || "Sin nombre"}
                          </p>
                          <p
                            className="text-xs mt-0.5"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            {formatDate(c.fecha)}
                            {esAdmin && c.vendedor && ` · ${c.vendedor.nombre}`}
                            {" · "}
                            {c.vigencia_dias}d vigencia
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <p
                            className="font-bold text-base tabular-nums"
                            style={{ color: "hsl(var(--foreground))" }}
                          >
                            {formatCOP(c.total)}
                          </p>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              generarPDFDirecto(c.id).catch(() => {});
                            }}
                            title="Descargar PDF"
                            className="text-[10px] px-2 py-1 rounded-md border cursor-pointer"
                            style={{
                              borderColor: "hsl(var(--primary))",
                              color: "hsl(var(--primary))",
                            }}
                          >
                            📄 PDF
                          </button>
                        </div>
                      </div>
                      {esteError && (
                        <p
                          className="text-xs mt-2"
                          style={{ color: "hsl(var(--destructive))" }}
                        >
                          {esteError}
                        </p>
                      )}
                      {puedeConvertir && (
                        <button
                          onClick={(e) => convertirEnVenta(e, c.id)}
                          disabled={convirtiendo === c.id}
                          className="mt-3 w-full py-2 rounded-lg text-xs font-medium border transition-all disabled:opacity-50 cursor-pointer"
                          style={{
                            borderColor: "hsl(var(--primary))",
                            color: "hsl(var(--primary))",
                          }}
                        >
                          {convirtiendo === c.id
                            ? "Convirtiendo..."
                            : "Convertir en venta"}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* ── Vista DESKTOP: Tabla ── */}
            <div
              className="hidden md:block overflow-x-auto rounded-xl border"
              style={{ borderColor: "hsl(var(--border))" }}
            >
              <table className="w-full border-collapse">
                <thead>
                  <tr
                    style={{
                      backgroundColor: "hsl(var(--muted) / 0.4)",
                      borderBottom: "1px solid hsl(var(--border))",
                    }}
                  >
                    {[
                      "#",
                      "Fecha",
                      "Cliente",
                      "Estado",
                      "Vendedor",
                      "Vigencia",
                      "Total",
                      "",
                    ].map((col) => (
                      <th
                        key={col}
                        className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-left whitespace-nowrap"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((c, idx) => {
                    const puedeConvertir =
                      c.estado === "aprobada" && !c.venta_id;
                    // F11.5: solo aprobadas pueden convertirse
                    const esteError =
                      errorConversion?.id === c.id ? errorConversion.msg : null;
                    return (
                      <tr
                        key={c.id}
                        onClick={() => navigate(`/ops/cotizaciones/${c.id}`)}
                        className="cursor-pointer transition-colors"
                        style={{
                          borderTop:
                            idx === 0
                              ? "none"
                              : "1px solid hsl(var(--border) / 0.5)",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor =
                            "hsl(var(--muted) / 0.4)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.backgroundColor = "")
                        }
                      >
                        <td className="px-4 py-3.5">
                          <span
                            className="font-mono text-xs font-bold"
                            style={{ color: "hsl(var(--primary))" }}
                          >
                            #{c.numero}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className="text-xs"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            {formatDate(c.fecha)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className="text-sm font-medium"
                            style={{ color: "hsl(var(--foreground))" }}
                          >
                            {c.cliente_nombre || "Sin nombre"}
                          </span>
                          {esteError && (
                            <p
                              className="text-xs mt-0.5"
                              style={{ color: "hsl(var(--destructive))" }}
                            >
                              {esteError}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {!c.venta_id && <StatusBadge status={c.estado} />}
                            {c.venta_id && (
                              <span
                                className="px-2 py-0.5 rounded text-[10px] font-semibold"
                                style={{
                                  backgroundColor: "hsl(var(--success) / 0.15)",
                                  color: "hsl(var(--success))",
                                }}
                                title="Convertida en venta"
                              >
                                🛒 Convertida
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className="text-xs"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            {c.vendedor?.nombre ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className="text-xs"
                            style={{ color: "hsl(var(--muted-foreground))" }}
                          >
                            {c.vigencia_dias}d
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className="text-sm font-semibold tabular-nums"
                            style={{ color: "hsl(var(--foreground))" }}
                          >
                            {formatCOP(c.total)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          {puedeConvertir && (
                            <button
                              onClick={(e) => convertirEnVenta(e, c.id)}
                              disabled={convirtiendo === c.id}
                              className="h-8 px-3 rounded-lg text-xs font-medium border transition-all disabled:opacity-50 cursor-pointer whitespace-nowrap"
                              style={{
                                borderColor: "hsl(var(--primary) / 0.4)",
                                color: "hsl(var(--primary))",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor =
                                  "hsl(var(--primary) / 0.08)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = "";
                              }}
                            >
                              {convirtiendo === c.id
                                ? "Convirtiendo..."
                                : "→ Venta"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Cargar más */}
        {hasMore && !busqueda && (
          <button
            onClick={() => cargarCotizaciones(false)}
            disabled={loading}
            className="mt-4 w-full py-3 rounded-xl text-sm font-medium border transition-all disabled:opacity-50 cursor-pointer"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
              backgroundColor: "hsl(var(--card))",
            }}
          >
            {loading ? "Cargando..." : "Cargar más"}
          </button>
        )}

        {!loading && !hasMore && cotizaciones.length > 0 && (
          <p
            className="text-center text-xs py-4"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            — {cotizaciones.length} cotizaciones —
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── Íconos locales ── */
function PlusIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SearchIcon({ className = "", style }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      style={style}
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
