import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Search,
  FileText,
  Download,
  Link as LinkIcon,
  AlertCircle,
  Clock,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import { parseRangoFecha } from "../../lib/busquedaFecha";
import { generarCotizacionPDF } from "../../lib/pdf/cotizacionPDF";
import {
  ESTADOS_COTIZACION,
  ESTADO_COTIZACION_LABELS,
  cotizacionEstadoClass,
  cotizacionEstadoLabel,
  cotizacionVigencia,
  resumenProductosCotizacion,
} from "../../lib/cotizaciones-ui";

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

  // Fecha escrita en la barra → filtro server-side por rango.
  const rangoFecha = useMemo(() => parseRangoFecha(busqueda), [busqueda]);

  const cargarCotizaciones = async (reset = false) => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setErrorMsg(null);
    const currentPage = reset ? 0 : page;

    try {
      // Join read-only a detalle_cotizacion para derivar el resumen de
      // productos (columna del diseño Lovable). NO altera escrituras.
      let query = supabase
        .from("cotizaciones")
        .select(
          `id, numero, fecha, cliente_nombre, cliente_telefono, estado, total,
           vigencia_dias, ot_id, venta_id,
           vendedor:vendedor_id(nombre), ot:ot_id(numero),
           detalle_cotizacion(producto:producto_id(nombre))`,
        )
        .order("fecha", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (!esAdmin) query = query.eq("sede_id", perfil?.sede_id);
      if (filtroEstado !== "Todos") query = query.eq("estado", filtroEstado);
      if (rangoFecha)
        query = query
          .gte("fecha", rangoFecha.desde)
          .lte("fecha", rangoFecha.hasta);

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
  }, [filtroEstado, rangoFecha?.desde, rangoFecha?.hasta]);

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

  // Búsqueda client-side sobre lo ya cargado (número, cliente, productos).
  const filtradas = useMemo(() => {
    if (rangoFecha) return cotizaciones; // ya filtrado server-side por fecha
    const needle = busqueda.trim().toLowerCase();
    if (!needle) return cotizaciones;
    return cotizaciones.filter((c) => {
      const num = String(c.numero);
      const cli = (c.cliente_nombre || "").toLowerCase();
      const prods = (
        resumenProductosCotizacion(c.detalle_cotizacion, 6) ?? ""
      ).toLowerCase();
      return (
        num.includes(needle) || cli.includes(needle) || prods.includes(needle)
      );
    });
  }, [cotizaciones, busqueda, rangoFecha]);

  // KPIs honestos derivados de lo cargado en vista (no inventados).
  const kpis = useMemo(() => {
    const aprobadas = cotizaciones.filter(
      (c) => c.estado === "aprobada",
    ).length;
    // "Pipeline": valor de cotizaciones abiertas (borrador/enviada/aprobada),
    // sin contar rechazadas/vencidas/convertidas.
    const abiertas = ["borrador", "enviada", "aprobada"];
    const pipeline = cotizaciones
      .filter((c) => abiertas.includes(c.estado))
      .reduce((s, c) => s + Number(c.total ?? 0), 0);
    return { enVista: cotizaciones.length, aprobadas, pipeline };
  }, [cotizaciones]);

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
            Cotizaciones
          </h1>
          <p
            className="mt-1.5 text-[13px] leading-[1.5]"
            style={{ color: "var(--n-500)" }}
          >
            {loading && cotizaciones.length === 0 ? (
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
                  {kpis.aprobadas}
                </b>{" "}
                aprobadas ·{" "}
                <b
                  className="font-mono font-medium"
                  style={{ color: "var(--n-700)" }}
                >
                  {formatCOP(kpis.pipeline)}
                </b>{" "}
                en pipeline
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <button
            onClick={() => navigate("/ops/cotizaciones/nueva")}
            className="btn btn-pri"
            style={{ height: 48 }}
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            <span className="hidden sm:inline">Nueva cotización</span>
            <span className="sm:hidden">Nueva</span>
          </button>
        </div>
      </div>

      {/* ── Tabs por estado ─────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center gap-1.5 border-b px-4 py-3 sm:px-7"
        style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
      >
        {ESTADOS_COTIZACION.map((e) => {
          const active = filtroEstado === e;
          return (
            <button
              key={e}
              onClick={() => setFiltroEstado(e)}
              className="rounded-md px-3 text-[12.5px] font-medium transition-colors"
              style={{
                minHeight: 36,
                backgroundColor: active ? "var(--p-50)" : "transparent",
                color: active ? "var(--p-700)" : "var(--n-500)",
              }}
              onMouseEnter={(ev) => {
                if (!active)
                  ev.currentTarget.style.backgroundColor = "var(--n-50)";
              }}
              onMouseLeave={(ev) => {
                if (!active)
                  ev.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              {e === "Todos" ? "Todas" : (ESTADO_COTIZACION_LABELS[e] ?? e)}
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
          style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
        >
          <Search
            className="h-4 w-4 shrink-0"
            strokeWidth={1.5}
            style={{ color: "var(--n-500)" }}
          />
          <input
            type="search"
            placeholder="Buscar por #, cliente, producto o fecha (23/06/2026)…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="min-w-0 flex-1 border-none bg-transparent text-sm outline-none"
            style={{ color: "var(--n-950)" }}
          />
        </div>
        <span
          className="ml-auto font-mono text-[11px] uppercase tracking-wider"
          style={{ color: "var(--n-500)" }}
        >
          <b className="font-medium" style={{ color: "var(--n-700)" }}>
            {filtradas.length}
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
        {errorMsg && (
          <div
            role="alert"
            className="mb-3 rounded-[10px] border px-3 py-2 text-xs"
            style={{
              backgroundColor: "var(--dang-50)",
              borderColor: "var(--dang-border)",
              color: "var(--dang-700)",
            }}
          >
            {errorMsg}
          </div>
        )}

        {loading && cotizaciones.length === 0 ? (
          <SkeletonList />
        ) : filtradas.length === 0 ? (
          <EmptyState busqueda={busqueda} filtroEstado={filtroEstado} />
        ) : (
          <>
            {/* Móvil/Tablet: cards (< md) */}
            <ul className="md:hidden space-y-2.5" role="list">
              {filtradas.map((c) => (
                <li key={c.id}>
                  <CotizacionCard
                    cot={c}
                    esAdmin={esAdmin}
                    convirtiendo={convirtiendo}
                    errorConversion={errorConversion}
                    onClick={() => navigate(`/ops/cotizaciones/${c.id}`)}
                    onConvertir={convertirEnVenta}
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
                      <Th width={92}>#</Th>
                      <Th width={104}>Fecha</Th>
                      <Th>Cliente</Th>
                      <Th width={220}>Productos</Th>
                      <Th width={120} right>
                        Valor
                      </Th>
                      <Th width={120}>Validez</Th>
                      <Th width={130}>Estado</Th>
                      <Th width={130}>Vinculación</Th>
                      <Th width={120}>Acción</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtradas.map((c) => (
                      <CotizacionFila
                        key={c.id}
                        cot={c}
                        convirtiendo={convirtiendo}
                        errorConversion={errorConversion}
                        onClick={() => navigate(`/ops/cotizaciones/${c.id}`)}
                        onConvertir={convertirEnVenta}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div
                className="flex items-center justify-between border-t px-5 py-3.5 text-xs"
                style={{
                  borderColor: "var(--n-150)",
                  backgroundColor: "var(--n-25)",
                  color: "var(--n-500)",
                }}
              >
                <span>
                  Mostrando{" "}
                  <b className="font-mono" style={{ color: "var(--n-700)" }}>
                    {filtradas.length}
                  </b>{" "}
                  de{" "}
                  <b className="font-mono" style={{ color: "var(--n-700)" }}>
                    {kpis.enVista}
                    {hasMore ? "+" : ""}
                  </b>{" "}
                  cotizaciones
                </span>
                {hasMore && (
                  <span className="font-mono">
                    Carga las siguientes con &ldquo;Cargar más&rdquo;
                  </span>
                )}
              </div>
            </div>

            {/* Cargar más (también con filtro de fecha server-side) */}
            {hasMore && (!busqueda.trim() || rangoFecha) && (
              <button
                onClick={() => cargarCotizaciones(false)}
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
        "border-b px-3 py-2.5 align-middle " + (right ? "text-right" : "")
      }
      style={{ borderColor: "var(--n-100)" }}
    >
      {children}
    </td>
  );
}

function ValidezCell({ fecha, vigenciaDias, estado }) {
  const { label, tone, icon } = cotizacionVigencia(fecha, vigenciaDias, estado);
  if (tone === "norm") {
    return (
      <span
        className="font-mono text-[11.5px]"
        style={{ color: "var(--n-500)" }}
      >
        {label}
      </span>
    );
  }
  const Icon = icon === "alert" ? AlertCircle : Clock;
  const styles =
    tone === "dang"
      ? { backgroundColor: "var(--dang-50)", color: "var(--dang-700)" }
      : { backgroundColor: "var(--warn-50)", color: "var(--warn-700)" };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[11.5px]"
      style={styles}
    >
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}

function CotizacionFila({
  cot: c,
  convirtiendo,
  errorConversion,
  onClick,
  onConvertir,
}) {
  const puedeConvertir = c.estado === "aprobada" && !c.venta_id;
  const esteError = errorConversion?.id === c.id ? errorConversion.msg : null;
  const resumen = resumenProductosCotizacion(c.detalle_cotizacion);
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
        <div className="flex min-w-0 flex-col leading-tight">
          <span
            className="max-w-[200px] truncate font-medium"
            style={{ color: "var(--n-950)" }}
          >
            {c.cliente_nombre || "Sin nombre"}
          </span>
          {c.cliente_telefono && (
            <span
              className="font-mono text-[11px]"
              style={{ color: "var(--n-500)" }}
            >
              {c.cliente_telefono}
            </span>
          )}
        </div>
        {esteError && (
          <p className="mt-0.5 text-xs" style={{ color: "var(--dang-700)" }}>
            {esteError}
          </p>
        )}
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
      <Td right>
        <span
          className="font-mono font-medium tabular-nums"
          style={{ color: "var(--n-950)" }}
        >
          {formatCOP(c.total)}
        </span>
      </Td>
      <Td>
        <ValidezCell
          fecha={c.fecha}
          vigenciaDias={c.vigencia_dias}
          estado={c.estado}
        />
      </Td>
      <Td>
        <span
          className={`s-pill ${cotizacionEstadoClass(c.estado, !!c.venta_id)}`}
        >
          <span className="dot" />
          {cotizacionEstadoLabel(c.estado, !!c.venta_id)}
        </span>
      </Td>
      <Td>
        {c.ot ? (
          <span className="link-pill ot">
            <LinkIcon className="h-3 w-3" /> OT #{c.ot.numero}
          </span>
        ) : c.venta_id ? (
          <span className="link-pill v">Venta</span>
        ) : (
          <span
            className="font-mono text-[11px]"
            style={{ color: "var(--n-300)" }}
          >
            —
          </span>
        )}
      </Td>
      <Td>
        {puedeConvertir && (
          <button
            onClick={(e) => onConvertir(e, c.id)}
            disabled={convirtiendo === c.id}
            className="btn btn-out whitespace-nowrap disabled:opacity-50"
            style={{ height: 34 }}
          >
            {convirtiendo === c.id ? "Convirtiendo…" : "→ Venta"}
          </button>
        )}
      </Td>
    </tr>
  );
}

function CotizacionCard({
  cot: c,
  esAdmin,
  convirtiendo,
  errorConversion,
  onClick,
  onConvertir,
}) {
  const esteError = errorConversion?.id === c.id ? errorConversion.msg : null;
  const puedeConvertir = c.estado === "aprobada" && !c.venta_id;
  const resumen = resumenProductosCotizacion(c.detalle_cotizacion);
  const vig = cotizacionVigencia(c.fecha, c.vigencia_dias, c.estado);
  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-[10px] border px-4 py-3.5 shadow-sm transition-all duration-100"
      style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
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
            <span
              className={`s-pill ${cotizacionEstadoClass(c.estado, !!c.venta_id)}`}
            >
              <span className="dot" />
              {cotizacionEstadoLabel(c.estado, !!c.venta_id)}
            </span>
            {c.ot && (
              <span className="link-pill ot">
                <LinkIcon className="h-3 w-3" /> OT #{c.ot.numero}
              </span>
            )}
          </div>
          <p
            className="truncate text-[14px] font-medium leading-tight"
            style={{ color: "var(--n-950)" }}
          >
            {c.cliente_nombre || "Sin nombre"}
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
            {formatDate(c.fecha)}
            {esAdmin && c.vendedor && ` · ${c.vendedor.nombre}`}
            {" · "}
            <span
              style={{
                color:
                  vig.tone === "dang"
                    ? "var(--dang-700)"
                    : vig.tone === "warn"
                      ? "var(--warn-700)"
                      : "var(--n-500)",
              }}
            >
              {vig.label}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <p
            className="font-mono text-[15px] font-semibold tabular-nums"
            style={{ color: "var(--n-950)" }}
          >
            {formatCOP(c.total)}
          </p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              generarPDFDirecto(c.id).catch(() => {});
            }}
            title="Descargar PDF"
            className="btn btn-out"
            style={{ height: 32, padding: "0 10px", fontSize: 11 }}
          >
            <Download className="h-3 w-3" strokeWidth={2} />
            PDF
          </button>
        </div>
      </div>
      {esteError && (
        <p className="mt-2 text-xs" style={{ color: "var(--dang-700)" }}>
          {esteError}
        </p>
      )}
      {puedeConvertir && (
        <button
          onClick={(e) => onConvertir(e, c.id)}
          disabled={convirtiendo === c.id}
          className="btn btn-out mt-3 w-full justify-center disabled:opacity-50"
          style={{ height: 48 }}
        >
          {convirtiendo === c.id ? "Convirtiendo…" : "Convertir en venta"}
        </button>
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
              className="ml-3 h-6 w-20 rounded"
              style={{ backgroundColor: "var(--n-100)" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ busqueda, filtroEstado }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div
        className="mb-4 grid h-14 w-14 place-items-center rounded-[12px]"
        style={{ backgroundColor: "var(--p-50)", color: "var(--p-600)" }}
      >
        <FileText className="h-7 w-7" strokeWidth={1.5} />
      </div>
      <p className="font-semibold" style={{ color: "var(--n-950)" }}>
        Sin cotizaciones
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--n-500)" }}>
        {busqueda
          ? `Sin resultados para "${busqueda}"`
          : filtroEstado !== "Todos"
            ? `No hay cotizaciones ${ESTADO_COTIZACION_LABELS[filtroEstado]?.toLowerCase()}`
            : "Crea la primera cotización"}
      </p>
    </div>
  );
}
