import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Triangle,
  Clock,
  ArrowRight,
  RefreshCw,
  Package,
  Wrench,
  FileText,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError } from "../../lib/utils";
import StatusBadge from "../../components/ui/StatusBadge";
import {
  periodoVentas,
  PERIODOS,
  formatHora,
  severidadStock,
  antiguedadOT,
  diasRestantesCotizacion,
  vencimientoCotizacion,
  COT_DIAS_POR_VENCER,
} from "../../lib/dashboard-admin-ui";

/* Estados de OT considerados "en proceso" para el bloque estratégico. */
const OT_EN_PROCESO = ["en_proceso", "esperando_repuesto"];
/* Estados de cotización aún vigentes (susceptibles de vencer). */
const COT_VIGENTES = ["enviada", "aprobada", "borrador"];
/* Cuántas filas de detalle se muestran por bloque estratégico. */
const FILAS_BLOQUE = 3;

/* ── Dashboard Admin ──────────────────────────────────────────────────── */
export default function Dashboard() {
  const navigate = useNavigate();
  const [kpis, setKpis] = useState(null);
  // Detalle de los bloques estratégicos (SELECT de solo lectura, presentación).
  const [bloques, setBloques] = useState({ alertas: [], ot: [], cotz: [] });
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [periodo, setPeriodo] = useState("Hoy");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cargar = async () => {
    setLoading(true);
    setErrorMsg("");
    let timer;
    try {
      const { data, error } = await Promise.race([
        supabase.rpc("fn_dashboard_kpis"),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Timeout: red lenta")),
            15000,
          );
        }),
      ]);
      if (!mountedRef.current) return;
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setKpis(data);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar dashboard"));
    } finally {
      clearTimeout(timer);
      if (mountedRef.current) setLoading(false);
    }
  };

  /**
   * Detalle de los bloques estratégicos 2x2 — SELECT de SOLO LECTURA sobre
   * tablas que ya existen (igual que otras páginas admin). NO toca escrituras
   * ni `fn_dashboard_kpis`. Si una consulta falla, su bloque queda vacío sin
   * romper el dashboard (los KPIs principales son la fuente autoritativa).
   */
  const cargarBloques = async () => {
    try {
      const [alertasRes, otRes, cotzRes] = await Promise.all([
        supabase
          .from("inventario")
          .select(
            `id, cantidad, estado_stock,
             sede:sede_id(nombre),
             producto:producto_id(referencia, nombre, stock_minimo, categoria)`,
          )
          .in("estado_stock", ["Agotado", "Bajo"])
          .order("cantidad", { ascending: true })
          .limit(50),
        supabase
          .from("ordenes_servicio")
          .select(
            `id, numero, fecha, cliente_nombre, equipo_descripcion, estado,
             tecnico:tecnico_id(nombre)`,
          )
          .in("estado", OT_EN_PROCESO)
          .order("fecha", { ascending: true })
          .limit(FILAS_BLOQUE),
        supabase
          .from("cotizaciones")
          .select(
            `id, numero, fecha, cliente_nombre, estado, total, vigencia_dias,
             vendedor:vendedor_id(nombre)`,
          )
          .in("estado", COT_VIGENTES)
          .order("fecha", { ascending: true })
          .limit(40),
      ]);
      if (!mountedRef.current) return;

      // Cotizaciones por vencer: filtra a las que vencen dentro del umbral.
      const cotzPorVencer = (cotzRes.data ?? [])
        .map((c) => ({
          ...c,
          _dias: diasRestantesCotizacion(c.fecha, c.vigencia_dias),
        }))
        .filter((c) => c._dias != null && c._dias <= COT_DIAS_POR_VENCER)
        .sort((a, b) => a._dias - b._dias)
        .slice(0, FILAS_BLOQUE);

      // Agotado siempre antes que Bajo — igual que en Alertas.jsx, ordenar
      // por texto pondría 'Bajo' primero (alfabéticamente "B" > "A").
      const alertasOrdenadas = [...(alertasRes.data ?? [])]
        .sort((a, b) => {
          if (a.estado_stock !== b.estado_stock) {
            return a.estado_stock === "Agotado" ? -1 : 1;
          }
          return a.cantidad - b.cantidad;
        })
        .slice(0, FILAS_BLOQUE);

      setBloques({
        alertas: alertasRes.error ? [] : alertasOrdenadas,
        ot: otRes.error ? [] : (otRes.data ?? []),
        cotz: cotzPorVencer,
      });
    } catch {
      // Fallo silencioso: los bloques quedan en estado vacío honesto.
      if (mountedRef.current) setBloques({ alertas: [], ot: [], cotz: [] });
    }
  };

  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;
  const cargarBloquesRef = useRef(cargarBloques);
  cargarBloquesRef.current = cargarBloques;

  const refrescar = () => {
    cargarRef.current();
    cargarBloquesRef.current();
  };

  useEffect(() => {
    cargarRef.current();
    cargarBloquesRef.current();
    let interval = null;
    const start = () => {
      if (interval) return;
      interval = setInterval(() => {
        cargarRef.current();
        cargarBloquesRef.current();
      }, 60_000);
    };
    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        cargarRef.current();
        cargarBloquesRef.current();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (loading && !kpis) {
    return (
      <div className="flex flex-col gap-6 px-5 pb-8 pt-6 sm:px-7">
        <PageHead
          onRefresh={refrescar}
          periodo={periodo}
          setPeriodo={setPeriodo}
        />
        <SkeletonStrip />
      </div>
    );
  }

  if (errorMsg && !kpis) {
    return (
      <div className="flex flex-col gap-6 px-5 pb-8 pt-6 sm:px-7">
        <PageHead
          onRefresh={refrescar}
          periodo={periodo}
          setPeriodo={setPeriodo}
        />
        <ErrorBox msg={errorMsg} onRetry={refrescar} />
      </div>
    );
  }

  const k = kpis ?? {};

  // Mismo criterio que el CIERRE (documento autoritativo de caja):
  //   · ventas de MOSTRADOR  → "productos"
  //   · abonos de OT         → "servicios"  (el cobro real, en su fecha real)
  // No se suman las ventas origen='ot': serían la MISMA plata de los abonos,
  // contada de nuevo el día de la facturación (que puede ser semanas después).
  const ventasMostrador = Number(k.ventas_mes ?? 0);
  const serviciosMes = Number(k.ingresos_servicios_mes ?? 0);
  const egresosMes = Number(k.compras_mes ?? 0);
  const devolucionesMes = Number(k.devoluciones_mes ?? 0);
  // Parte de `devoluciones_mes` valorizada a precio de catálogo (devoluciones
  // sin venta asociada): se muestra para que se sepa qué porción es estimada.
  const devolucionesEstimadas = Number(k.devoluciones_mes_sin_venta ?? 0);

  // Margen sobre lo REALMENTE recaudado, igual que el cierre:
  // mostrador + servicios (abonos de OT) − compras − devoluciones.
  const margenMes =
    ventasMostrador + serviciosMes - egresosMes - devolucionesMes;

  // El delta comparaba SIEMPRE hoy vs ayer, aunque el KPI dijera "Semana" o
  // "Mes": se leía una caída de un día como si fuera del mes. Ahora compara
  // contra el periodo anterior equivalente.
  const REF_PERIODO = {
    Hoy: { actual: k.ventas_hoy, previo: k.ventas_ayer, etiqueta: "vs ayer" },
    Semana: {
      actual: k.ventas_semana,
      previo: k.ventas_semana_prev,
      etiqueta: "vs semana pasada",
    },
    Mes: {
      actual: k.ventas_mes,
      previo: k.ventas_mes_prev,
      etiqueta: "vs mes pasado",
    },
  };
  const ref = REF_PERIODO[periodo] ?? REF_PERIODO.Hoy;
  const ventasDelta =
    Number(ref.previo) > 0
      ? ((Number(ref.actual) - Number(ref.previo)) / Number(ref.previo)) * 100
      : null;

  const ventasPeriodo = periodoVentas(k, periodo);
  const alertas = k.alertas ?? [];
  const actividad = k.actividad_reciente ?? [];

  return (
    <div className="flex flex-col gap-6 px-5 pb-8 pt-6 sm:px-7 animate-fade-in">
      <PageHead
        onRefresh={refrescar}
        periodo={periodo}
        setPeriodo={setPeriodo}
      />

      {errorMsg && <ErrorBox msg={errorMsg} onRetry={refrescar} small />}

      {/* KPI strip */}
      <div
        className="grid grid-cols-2 gap-y-4 border-b pb-5 pt-1 md:grid-cols-3 md:gap-y-0 lg:grid-cols-6"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        {/* Solo MOSTRADOR, igual que "Productos" en el Cierre. La plata de las
            órdenes de servicio va en su propia tarjeta ("Servicios"), medida por
            los abonos: ese es el cobro real y en su fecha real. Incluir aquí las
            ventas origen='ot' inflaba el día con plata recibida semanas antes
            (una OT abonada el 8 de julio y facturada el 21 aparecía como venta
            del 21). */}
        <Kpi
          label={`Ventas · ${periodo}`}
          value={formatCOP(ventasPeriodo)}
          hint="Ventas de mostrador. Lo cobrado por órdenes de servicio se muestra aparte, en “Servicios”. Coincide con “Productos” del Cierre."
          sub={
            ventasDelta !== null ? (
              <DeltaPill delta={ventasDelta} etiqueta={ref.etiqueta} />
            ) : (
              <span style={{ color: "hsl(var(--muted-foreground))" }}>
                sin referencia
              </span>
            )
          }
        />
        <Kpi
          label="Egresos del mes"
          value={formatCOP(egresosMes)}
          sub={
            <span style={{ color: "hsl(var(--muted-foreground))" }}>
              compras del mes
            </span>
          }
        />
        <Kpi
          label="Devoluciones del mes"
          value={formatCOP(devolucionesMes)}
          sub={
            <span style={{ color: "hsl(var(--muted-foreground))" }}>
              {devolucionesEstimadas > 0
                ? `incluye ${formatCOP(devolucionesEstimadas)} estimados`
                : "procesadas, a precio de venta"}
            </span>
          }
        />
        <Kpi
          label="Servicios del mes"
          value={formatCOP(serviciosMes)}
          hint="Abonos cobrados en órdenes de servicio, en la fecha real del cobro. Coincide con “Servicios” del Cierre. Cuando la OT se factura NO se vuelve a contar: es el mismo dinero."
          sub={
            <span style={{ color: "hsl(var(--muted-foreground))" }}>
              cobrado en órdenes de trabajo
            </span>
          }
        />
        <Kpi
          label="Margen del mes"
          value={formatCOP(margenMes)}
          danger={margenMes < 0}
          sub={
            <span style={{ color: "hsl(var(--muted-foreground))" }}>
              ventas + serv. − compras − devol.
            </span>
          }
        />
        <Kpi
          last
          label="Valor inventario"
          value={formatCOP(k.valor_inventario ?? 0)}
          sub={
            <span style={{ color: "hsl(var(--muted-foreground))" }}>
              {(k.total_productos_activos ?? 0).toLocaleString("es-CO")}{" "}
              productos
            </span>
          }
        />
      </div>

      {/* Atención requerida (alertas de stock reales) */}
      <SectionCard>
        <header
          className="flex items-center justify-between border-b px-[18px] py-3"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-6 w-6 place-items-center rounded-md"
              style={{
                backgroundColor: "hsl(var(--destructive) / 0.1)",
                color: "hsl(var(--destructive))",
              }}
            >
              <Triangle
                className="h-3.5 w-3.5"
                fill="currentColor"
                strokeWidth={1.5}
              />
            </span>
            <span
              className="text-[13.5px] font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Atención requerida
            </span>
            {Number(k.stock_agotado_count) > 0 && (
              <span
                className="rounded-[3px] border px-1.5 py-px font-mono text-[11px] font-semibold"
                style={{
                  backgroundColor: "hsl(var(--destructive) / 0.1)",
                  borderColor: "hsl(var(--destructive) / 0.4)",
                  color: "hsl(var(--destructive))",
                }}
              >
                {k.stock_agotado_count} agotado
                {Number(k.stock_agotado_count) !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <span
            className="font-mono text-[10.5px] tracking-[0.06em]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Top {Math.min(alertas.length, 5)} de {k.alertas_count ?? 0} alertas
          </span>
        </header>

        {alertas.length === 0 ? (
          <p
            className="px-[18px] py-6 text-center text-[13px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Sin alertas de stock activas ✓
          </p>
        ) : (
          alertas
            .slice(0, 5)
            .map((a, i) => <AttRow key={a.inventario_id ?? i} alert={a} />)
        )}

        <footer
          className="flex items-center justify-between border-t px-[18px] py-3 text-[12px]"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--muted) / 0.3)",
          }}
        >
          <span
            className="font-mono text-[10.5px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {Math.max(0, (k.alertas_count ?? 0) - 5)} alertas adicionales
          </span>
          <Link
            to="/admin/alertas"
            className="inline-flex items-center gap-1.5 font-medium"
            style={{ color: "hsl(var(--primary))" }}
          >
            Ver todas las alertas ({k.alertas_count ?? 0})
            <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
          </Link>
        </footer>
      </SectionCard>

      {/* Bloques estratégicos 2x2 + Actividad reciente */}
      <section className="grid grid-cols-1 gap-[18px] lg:grid-cols-2">
        {/* Productos en alerta — detalle real (inventario + productos) */}
        <StrategicBlock
          icon={Package}
          iconTone="--warning"
          title="Productos en alerta"
          count={k.alertas_count ?? 0}
          countTone="--warning"
          footer={{ label: "Ver módulo Reorden", to: "/admin/reorden" }}
          emptyText="Sin productos bajo mínimo ✓"
          items={bloques.alertas}
          renderItem={(it) => {
            const sev = severidadStock(it.estado_stock);
            return (
              <SbRow
                key={it.id}
                keyText={it.producto?.referencia ?? "—"}
                keyTone={sev.token}
                title={it.producto?.nombre ?? "Producto"}
                sub={`${it.sede?.nombre ?? "—"} · ${it.producto?.categoria ?? "sin categoría"}`}
                onClick={() => navigate("/admin/reorden")}
                right={
                  <RightStock
                    current={it.cantidad}
                    min={it.producto?.stock_minimo ?? 0}
                    status={sev.label}
                    token={sev.token}
                  />
                }
              />
            );
          }}
        />

        {/* OTs en proceso — detalle real (ordenes_servicio) */}
        <StrategicBlock
          icon={Wrench}
          iconTone="--info"
          title="OTs en proceso"
          count={k.ordenes_abiertas ?? 0}
          countTone="--info"
          footer={{ label: "Ver Órdenes de Trabajo", to: "/ops/ordenes" }}
          emptyText="Sin órdenes en proceso"
          items={bloques.ot}
          renderItem={(it) => {
            const age = antiguedadOT(it.fecha);
            const estadoLabel =
              it.estado === "esperando_repuesto"
                ? "esperando rep."
                : "en proceso";
            return (
              <SbRow
                key={it.id}
                keyText={`OT-${it.numero}`}
                keyTone="--info"
                title={`${it.equipo_descripcion ?? "Equipo"} · ${it.cliente_nombre ?? "—"}`}
                sub={`Téc. ${it.tecnico?.nombre ?? "Sin asignar"} · ${estadoLabel}`}
                onClick={() => navigate(`/ops/ordenes/${it.id}`)}
                right={
                  <RightAge
                    value={age.label}
                    status={age.status}
                    token={age.token}
                  />
                }
              />
            );
          }}
        />

        {/* Cotizaciones por vencer — detalle real (cotizaciones) */}
        <StrategicBlock
          icon={FileText}
          iconTone="--warning"
          title="Cotizaciones por vencer"
          count={bloques.cotz.length}
          countTone="--warning"
          footer={{ label: "Ver Cotizaciones", to: "/ops/cotizaciones" }}
          emptyText={`Ninguna vence en ${COT_DIAS_POR_VENCER} días`}
          items={bloques.cotz}
          renderItem={(it) => {
            const venc = vencimientoCotizacion(it._dias);
            return (
              <SbRow
                key={it.id}
                keyText={`COT-${it.numero}`}
                keyTone="--warning"
                title={it.cliente_nombre ?? "Cliente"}
                sub={`Vendedor ${it.vendedor?.nombre ?? "—"}`}
                onClick={() => navigate(`/ops/cotizaciones/${it.id}`)}
                right={
                  <RightQuote
                    total={formatCOP(it.total ?? 0)}
                    label={venc.label}
                    token={venc.token}
                  />
                }
              />
            );
          }}
        />

        {/* Actividad reciente (real, de la RPC) */}
        <SectionCard className="flex flex-col">
          <header className="flex items-center gap-2.5 px-[18px] pb-2.5 pt-3.5">
            <span
              className="grid h-6 w-6 place-items-center rounded-md"
              style={{
                backgroundColor: "hsl(var(--muted))",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              <Clock className="h-3.5 w-3.5" strokeWidth={1.5} />
            </span>
            <span
              className="text-[13px] font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              Actividad reciente
            </span>
          </header>
          <div className="flex flex-col px-[18px] pt-1">
            {actividad.length === 0 ? (
              <p
                className="py-6 text-center text-[12.5px]"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Sin movimientos recientes
              </p>
            ) : (
              actividad
                .slice(0, 6)
                .map((a, i, arr) => (
                  <TlRow
                    key={a.id ?? `${a.created_at}-${a.type}`}
                    activity={a}
                    last={i === arr.length - 1}
                  />
                ))
            )}
          </div>
          <footer
            className="mt-auto border-t px-[18px] py-3 text-[12px]"
            style={{
              borderColor: "hsl(var(--border))",
              backgroundColor: "hsl(var(--muted) / 0.3)",
            }}
          >
            <Link
              to="/admin/auditoria"
              className="inline-flex items-center gap-1.5 font-medium"
              style={{ color: "hsl(var(--primary))" }}
            >
              Ver Auditoría
              <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
            </Link>
          </footer>
        </SectionCard>
      </section>

      {/* Charts reales */}
      <section className="grid gap-[18px] lg:grid-cols-2">
        <ChartCard
          title="Tendencia ventas — últimos 7 días"
          empty={(k.tendencia_7d ?? []).every((d) => Number(d.total) === 0)}
        >
          <LineChart data={k.tendencia_7d ?? []} />
        </ChartCard>

        <ChartCard
          title="Ventas por sede — mes actual"
          empty={(k.ventas_por_sede ?? []).length === 0}
        >
          <BarChart data={k.ventas_por_sede ?? []} />
        </ChartCard>
      </section>

      {/* Top 5 productos del mes */}
      <SectionCard>
        <header
          className="border-b px-[18px] py-3"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <span
            className="text-[13px] font-semibold"
            style={{ color: "hsl(var(--foreground))" }}
          >
            Top 5 productos del mes
          </span>
        </header>
        <div className="p-[18px]">
          {(k.top5_productos_mes ?? []).length === 0 ? (
            <p
              className="py-4 text-center text-[12.5px] italic"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Sin ventas este mes
            </p>
          ) : (
            <ul className="space-y-2" role="list">
              {(k.top5_productos_mes ?? []).map((p, i) => (
                <li
                  key={p.referencia ?? i}
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                  style={{ backgroundColor: "hsl(var(--muted) / 0.3)" }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="grid h-6 w-6 shrink-0 place-items-center rounded font-mono text-xs font-bold"
                      style={{
                        backgroundColor: "hsl(var(--primary))",
                        color: "hsl(var(--primary-foreground))",
                      }}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p
                        className="truncate text-sm font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {p.nombre}
                      </p>
                      <p
                        className="font-mono text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {p.referencia}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className="text-sm font-bold tabular-nums"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {p.unidades} uds
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {formatCOP(p.total)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

/* ── Page head con controles ──────────────────────────────────────────── */
function PageHead({ onRefresh, periodo, setPeriodo }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p
          className="m-0 mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Admin · Visión general
        </p>
        <h1
          className="m-0 text-[24px] font-semibold leading-tight tracking-[-0.018em]"
          style={{ color: "hsl(var(--foreground))" }}
        >
          Dashboard
        </h1>
      </div>
      <div className="flex items-center gap-2">
        <Seg options={PERIODOS} value={periodo} onChange={setPeriodo} />
        <button
          onClick={onRefresh}
          className="inline-flex h-12 items-center gap-1.5 rounded-md border px-3 text-[12.5px] font-medium transition-colors cursor-pointer"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--card))",
            color: "hsl(var(--muted-foreground))",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.color = "hsl(var(--foreground))")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.color = "hsl(var(--muted-foreground))")
          }
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
          Refrescar
        </button>
      </div>
    </div>
  );
}

/* ── Segmented control ────────────────────────────────────────────────── */
function Seg({ options, value, onChange }) {
  return (
    <div
      className="inline-flex gap-px rounded-[7px] border p-0.5"
      style={{
        borderColor: "hsl(var(--border))",
        backgroundColor: "hsl(var(--muted) / 0.4)",
      }}
    >
      {options.map((opt) => {
        const on = opt === value;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className="rounded-[5px] px-2.5 py-1.5 text-[12px] font-medium transition-colors cursor-pointer"
            style={{
              backgroundColor: on ? "hsl(var(--card))" : "transparent",
              color: on
                ? "hsl(var(--foreground))"
                : "hsl(var(--muted-foreground))",
              fontWeight: on ? 600 : 500,
              boxShadow: on ? "0 1px 2px rgba(16,24,40,0.06)" : "none",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

/* ── KPI con separadores punteados ────────────────────────────────────── */
function Kpi({ label, value, sub, last, danger, hint }) {
  return (
    <div
      className={`flex flex-col gap-1.5 pr-7 md:pl-7 md:first:pl-0 ${
        last ? "" : "md:border-r md:border-dashed"
      }`}
      style={last ? undefined : { borderColor: "hsl(var(--border))" }}
    >
      <div
        className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{
          color: danger
            ? "hsl(var(--destructive))"
            : "hsl(var(--muted-foreground))",
        }}
        // `hint` explica de dónde sale el número al pasar el mouse: evita que un
        // KPI se interprete mal al compararlo con otra pantalla.
        title={hint || undefined}
      >
        {label}
        {hint && <span aria-hidden="true"> ⓘ</span>}
      </div>
      <div
        className="font-mono text-[22px] font-semibold leading-tight tracking-[-0.02em] tabular-nums"
        style={{
          color: danger ? "hsl(var(--destructive))" : "hsl(var(--foreground))",
        }}
      >
        {value}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        {sub}
      </div>
    </div>
  );
}

function DeltaPill({ delta, etiqueta = "vs ayer" }) {
  const positive = delta >= 0;
  return (
    <span
      className="inline-flex items-center gap-1 text-[11.5px] font-medium"
      style={{
        color: positive ? "hsl(var(--success))" : "hsl(var(--destructive))",
      }}
    >
      {positive ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}% {etiqueta}
    </span>
  );
}

/* ── Fila de atención (alerta) ────────────────────────────────────────── */
function AttRow({ alert }) {
  const isDanger = alert.severity === "danger";
  return (
    <div
      className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b px-[18px] py-3 text-[12.5px] last:border-b-0"
      style={{ borderColor: "hsl(var(--border))" }}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{
          backgroundColor: isDanger
            ? "hsl(var(--destructive))"
            : "hsl(var(--warning))",
        }}
      />
      <div
        className="min-w-0 truncate font-medium"
        style={{ color: "hsl(var(--foreground))" }}
      >
        {alert.message}
      </div>
      <StatusBadge status={isDanger ? "danger" : "warning"}>
        {isDanger ? "Agotado" : "Stock bajo"}
      </StatusBadge>
    </div>
  );
}

/* ── Bloque estratégico (cabecera + filas de detalle + footer) ─────────── */
function StrategicBlock({
  icon,
  iconTone,
  title,
  count,
  countTone,
  items,
  renderItem,
  footer,
  emptyText,
}) {
  const Icon = icon;
  return (
    <SectionCard className="flex flex-col">
      <header className="flex items-center justify-between px-[18px] pb-2.5 pt-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid h-6 w-6 place-items-center rounded-md"
            style={{
              backgroundColor: `hsl(var(${iconTone}) / 0.12)`,
              color: `hsl(var(${iconTone}))`,
            }}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
          </span>
          <span
            className="text-[13px] font-semibold"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {title}
          </span>
        </div>
        <span
          className="rounded-[3px] border px-1.5 py-px font-mono text-[10.5px] font-semibold leading-[1.4] tabular-nums"
          style={{
            backgroundColor: `hsl(var(${countTone}) / 0.12)`,
            borderColor: `hsl(var(${countTone}) / 0.4)`,
            color: `hsl(var(${countTone}))`,
          }}
        >
          {count}
        </span>
      </header>

      <div className="flex flex-1 flex-col">
        {items.length === 0 ? (
          <p
            className="px-[18px] py-6 text-center text-[12.5px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {emptyText}
          </p>
        ) : (
          items.map(renderItem)
        )}
      </div>

      <footer
        className="mt-auto border-t px-[18px] py-3 text-[12px]"
        style={{
          borderColor: "hsl(var(--border))",
          backgroundColor: "hsl(var(--muted) / 0.3)",
        }}
      >
        <Link
          to={footer.to}
          className="inline-flex items-center gap-1.5 font-medium"
          style={{ color: "hsl(var(--primary))" }}
        >
          {footer.label}
          <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
        </Link>
      </footer>
    </SectionCard>
  );
}

/* ── Fila de detalle de un bloque estratégico ─────────────────────────── */
function SbRow({ keyText, keyTone, title, sub, right, onClick }) {
  return (
    <button
      onClick={onClick}
      className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-t px-[18px] py-2.5 text-left transition-colors cursor-pointer"
      style={{ borderColor: "hsl(var(--border))" }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.backgroundColor = "hsl(var(--muted) / 0.4)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
    >
      <span
        className="mt-[1px] shrink-0 self-start rounded-[3px] border px-1.5 py-0.5 font-mono text-[11px] font-medium leading-[1.4]"
        style={{
          backgroundColor: `hsl(var(${keyTone}) / 0.1)`,
          borderColor: `hsl(var(${keyTone}) / 0.4)`,
          color: `hsl(var(${keyTone}))`,
        }}
      >
        {keyText}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div
          className="truncate text-[12.5px] font-medium leading-[1.3]"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {title}
        </div>
        <div
          className="truncate font-mono text-[10.5px] tracking-[0.04em]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {sub}
        </div>
      </div>
      <div className="whitespace-nowrap text-right font-mono text-[11px] font-medium leading-[1.3]">
        {right}
      </div>
    </button>
  );
}

/* Columna derecha — stock actual / mínimo + estado. */
function RightStock({ current, min, status, token }) {
  return (
    <>
      <span style={{ color: "hsl(var(--muted-foreground))" }}>
        <span className="font-semibold" style={{ color: `hsl(var(${token}))` }}>
          {current}
        </span>{" "}
        / {min} mín.
      </span>
      <div
        className="text-[10px] font-normal"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {status}
      </div>
    </>
  );
}

/* Columna derecha — antigüedad de OT. */
function RightAge({ value, status, token }) {
  return (
    <>
      <span className="font-semibold" style={{ color: `hsl(var(${token}))` }}>
        {value}
      </span>
      <div
        className="text-[10px] font-normal"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {status}
      </div>
    </>
  );
}

/* Columna derecha — monto de cotización + días para vencer. */
function RightQuote({ total, label, token }) {
  return (
    <>
      <span
        className="font-semibold"
        style={{ color: "hsl(var(--foreground))" }}
      >
        {total}
      </span>
      <div
        className="text-[10px] font-medium"
        style={{ color: `hsl(var(${token}))` }}
      >
        {label}
      </div>
    </>
  );
}

/* ── Fila timeline de actividad ───────────────────────────────────────── */
function TlRow({ activity, last }) {
  return (
    <div
      className={`grid grid-cols-[18px_1fr_auto] items-start gap-2.5 py-2.5 ${
        last ? "" : "border-b"
      }`}
      style={last ? undefined : { borderColor: "hsl(var(--border))" }}
    >
      <span
        className="mt-1.5 h-2 w-2 rounded-full"
        style={{ backgroundColor: activityColor(activity.type) }}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <div
          className="truncate text-[12.5px] leading-[1.3]"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {activity.action}
        </div>
        <div
          className="font-mono text-[10.5px] tracking-[0.04em]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {activity.user}
        </div>
      </div>
      <div
        className="font-mono text-[10.5px]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {formatHora(activity.created_at)}
      </div>
    </div>
  );
}

function activityColor(type) {
  switch (type) {
    case "venta":
      return "hsl(var(--success))";
    case "traspaso_entrada":
    case "traspaso_salida":
      return "hsl(var(--info))";
    case "ajuste":
    case "conteo_ajuste":
      return "hsl(var(--warning))";
    case "compra":
      return "hsl(var(--primary))";
    default:
      return "hsl(var(--muted-foreground))";
  }
}

/* ── SectionCard (superficie estilo cockpit) ──────────────────────────── */
function SectionCard({ children, className = "" }) {
  return (
    <section
      className={`overflow-hidden rounded-[10px] border ${className}`}
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      {children}
    </section>
  );
}

/* ── Charts reales (SVG sin librería) ─────────────────────────────────── */
function ChartCard({ title, children, empty }) {
  return (
    <SectionCard>
      <header
        className="border-b px-[18px] py-3"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <h3
          className="text-[13px] font-semibold"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {title}
        </h3>
      </header>
      <div className="p-[18px]">
        {empty ? (
          <p
            className="py-8 text-center text-xs italic"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Sin datos para mostrar
          </p>
        ) : (
          children
        )}
      </div>
    </SectionCard>
  );
}

function LineChart({ data }) {
  const W = 320;
  const H = 120;
  const PAD = 24;
  const max = Math.max(1, ...data.map((d) => Number(d.total)));
  const stepX = (W - PAD * 2) / Math.max(1, data.length - 1);

  const points = data.map((d, i) => {
    const x = PAD + i * stepX;
    const y = H - PAD - (Number(d.total) / max) * (H - PAD * 2);
    return { x, y, total: d.total, fecha: d.fecha };
  });

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label="Tendencia de ventas últimos 7 días"
    >
      <line
        x1={PAD}
        y1={H - PAD}
        x2={W - PAD}
        y2={H - PAD}
        stroke="hsl(var(--border))"
        strokeWidth="1"
      />
      <path
        d={`${path} L ${points[points.length - 1]?.x ?? PAD} ${H - PAD} L ${PAD} ${H - PAD} Z`}
        fill="hsl(var(--primary) / 0.15)"
      />
      <path d={path} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="3" fill="hsl(var(--primary))" />
          <title>
            {new Date(`${p.fecha}T12:00:00`).toLocaleDateString("es-CO", {
              weekday: "short",
              day: "numeric",
            })}
            : {formatCOP(p.total)}
          </title>
        </g>
      ))}
    </svg>
  );
}

function BarChart({ data }) {
  const max = Math.max(1, ...data.map((d) => Number(d.total)));
  return (
    <div className="space-y-2.5">
      {data.map((d) => {
        const pct = (Number(d.total) / max) * 100;
        return (
          <div key={d.sede}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span style={{ color: "hsl(var(--foreground))" }}>{d.sede}</span>
              <span
                className="font-medium tabular-nums"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {formatCOP(d.total)}
              </span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full"
              style={{ backgroundColor: "hsl(var(--muted) / 0.4)" }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${pct}%`,
                  backgroundColor: "hsl(var(--primary))",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Estados auxiliares ───────────────────────────────────────────────── */
function ErrorBox({ msg, onRetry, small }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border ${small ? "px-3 py-2" : "p-4"}`}
      style={{
        backgroundColor: "hsl(var(--destructive) / 0.08)",
        borderColor: "hsl(var(--destructive) / 0.4)",
        color: "hsl(var(--destructive))",
      }}
    >
      <p className="text-xs">{msg}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded border px-3 py-1.5 text-xs cursor-pointer"
          style={{
            borderColor: "hsl(var(--destructive))",
            color: "hsl(var(--destructive))",
          }}
        >
          Reintentar
        </button>
      )}
    </div>
  );
}

function SkeletonStrip() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className="h-20 animate-pulse rounded-lg border"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        />
      ))}
    </div>
  );
}
