import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Clock,
  ArrowRight,
  RefreshCw,
  Package,
  Wrench,
  FileText,
  TrendingUp,
  TrendingDown,
  Wallet,
  Boxes,
  Users,
  Coins,
  Snowflake,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, safeError } from "../../lib/utils";
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
  // Métricas avanzadas (rentabilidad, cartera, inventario-capital, desempeño).
  // RPC Admin-only, solo lectura. Si falla, las secciones avanzadas se ocultan.
  const [adm, setAdm] = useState(null);
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
            `id, cantidad, estado_stock, stock_minimo,
             sede:sede_id(nombre),
             producto:producto_id(referencia, nombre, categoria)`,
          )
          .in("estado_stock", ["Agotado", "Bajo"])
          .gt("stock_minimo", 0)
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

  /**
   * Métricas avanzadas del Admin (fn_dashboard_admin). Fallo silencioso: si la
   * RPC no responde o el usuario no es Admin, las secciones avanzadas no se
   * pintan y el resto del dashboard sigue funcionando.
   */
  const cargarAdmin = async () => {
    try {
      const { data, error } = await supabase.rpc("fn_dashboard_admin");
      if (!mountedRef.current) return;
      if (!error && data && !data.error) setAdm(data);
    } catch {
      /* silencioso */
    }
  };

  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;
  const cargarBloquesRef = useRef(cargarBloques);
  cargarBloquesRef.current = cargarBloques;
  const cargarAdminRef = useRef(cargarAdmin);
  cargarAdminRef.current = cargarAdmin;

  const refrescar = () => {
    cargarRef.current();
    cargarBloquesRef.current();
    cargarAdminRef.current();
  };

  useEffect(() => {
    cargarRef.current();
    cargarBloquesRef.current();
    cargarAdminRef.current();
    let interval = null;
    const start = () => {
      if (interval) return;
      interval = setInterval(() => {
        cargarRef.current();
        cargarBloquesRef.current();
        cargarAdminRef.current();
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
        cargarAdminRef.current();
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

  // Margen sobre lo REALMENTE recaudado, igual que el cierre:
  // mostrador + servicios (abonos de OT) − compras − devoluciones.
  const margenMes =
    ventasMostrador + serviciosMes - egresosMes - devolucionesMes;

  // Margen bruto REAL (precio − costo) desde la RPC avanzada. Puede no haber
  // cargado todavía (carga en paralelo): en ese caso la tarjeta muestra "…".
  const admR = adm?.rentabilidad;
  const margenBruto = admR ? Number(admR.margen_mes) : null;
  const margenPctTop =
    admR && Number(admR.ingreso_mes) > 0
      ? (Number(admR.margen_mes) / Number(admR.ingreso_mes)) * 100
      : null;

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
          label="Margen bruto del mes"
          value={margenBruto != null ? formatCOP(margenBruto) : "…"}
          hint="Ganancia real de lo vendido: precio de venta menos el costo (congelado al momento de vender). El detalle está abajo, en Rentabilidad."
          sub={
            <span style={{ color: "hsl(var(--muted-foreground))" }}>
              {margenPctTop != null
                ? `${margenPctTop.toFixed(1)}% del ingreso`
                : "precio − costo"}
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
          label="Egresos del mes"
          value={formatCOP(egresosMes)}
          sub={
            <span style={{ color: "hsl(var(--muted-foreground))" }}>
              compras del mes
            </span>
          }
        />
        <Kpi
          label="Flujo neto del mes"
          value={formatCOP(margenMes)}
          danger={margenMes < 0}
          hint="Flujo de caja: ventas + servicios − compras − devoluciones. NO es el margen de ganancia (ese es el Margen bruto)."
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

      {/* Secciones avanzadas (rentabilidad, cartera, capital, desempeño).
          Solo se pintan si la RPC Admin respondió. */}
      {adm && <BloquesAvanzados adm={adm} />}

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
                    min={it.stock_minimo ?? 0}
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
    </div>
  );
}

/* ── Bloques avanzados (rentabilidad, cartera, capital, desempeño) ─────── */
function BloquesAvanzados({ adm }) {
  const r = adm.rentabilidad ?? {};
  const c = adm.cartera ?? {};
  const inv = adm.inventario ?? {};
  const d = adm.desempeno ?? {};

  const margenPct =
    Number(r.ingreso_mes) > 0
      ? (Number(r.margen_mes) / Number(r.ingreso_mes)) * 100
      : 0;
  const utilidadNeta = Number(r.margen_mes ?? 0) - Number(r.gastos_mes ?? 0);
  const descTot =
    Number(r.descuentos_explicitos ?? 0) + Number(r.rebaja_en_linea ?? 0);
  const posNeta = Number(c.cxc_total ?? 0) - Number(c.cxp_total ?? 0);
  const capPct =
    Number(inv.valor_total) > 0
      ? (Number(inv.capital_sin_rotar_90d) / Number(inv.valor_total)) * 100
      : 0;
  const vDelta =
    Number(d.ventas_prev_mtd) > 0
      ? ((Number(d.ventas_mtd) - Number(d.ventas_prev_mtd)) /
          Number(d.ventas_prev_mtd)) *
        100
      : null;
  const mDelta =
    Number(d.margen_prev_mtd) > 0
      ? ((Number(d.margen_mtd) - Number(d.margen_prev_mtd)) /
          Number(d.margen_prev_mtd)) *
        100
      : null;
  const cats = r.margen_categoria ?? [];
  const maxCat = Math.max(1, ...cats.map((x) => Number(x.utilidad)));
  const topU = r.top_utilidad ?? [];
  const dormido = inv.top_dormido ?? [];
  const deudores = c.top_deudores ?? [];
  const acreedores = c.top_acreedores ?? [];
  const clientes = d.mejores_clientes ?? [];

  return (
    <div className="flex flex-col gap-[18px]">
      {/* 1. Rentabilidad */}
      <AdvCard
        icon={Coins}
        tone="--success"
        title="Rentabilidad del mes"
        subtitle="Precio de venta vs. costo real (congelado al momento de vender)"
      >
        <div
          className="grid grid-cols-2 gap-px md:grid-cols-4"
          style={{ backgroundColor: "hsl(var(--border))" }}
        >
          <MiniStat
            label="Margen bruto"
            value={formatCOP(r.margen_mes)}
            sub={`${margenPct.toFixed(1)}% del ingreso`}
          />
          <MiniStat
            label="Utilidad neta aprox."
            value={formatCOP(utilidadNeta)}
            sub="margen − gastos caja menor"
          />
          <MiniStat
            label="Descuentos dados"
            value={formatCOP(descTot)}
            sub="explícitos + rebaja en línea"
          />
          <MiniStat
            label="Ventas bajo costo"
            value={
              Number(r.lineas_bajo_costo) === 0
                ? "Ninguna ✓"
                : `−${formatCOP(r.perdida_bajo_costo)}`
            }
            sub={`${r.lineas_bajo_costo} línea(s) por debajo del costo`}
            danger={Number(r.lineas_bajo_costo) > 0}
          />
        </div>
        <div
          className="grid grid-cols-1 gap-px lg:grid-cols-2"
          style={{ backgroundColor: "hsl(var(--border))" }}
        >
          <div
            className="p-[18px]"
            style={{ backgroundColor: "hsl(var(--card))" }}
          >
            <SubTitle>Top productos por utilidad</SubTitle>
            {topU.length === 0 ? (
              <Empty />
            ) : (
              topU.map((p, i) => (
                <RankRow
                  key={p.referencia ?? i}
                  rank={i + 1}
                  title={p.nombre}
                  sub={p.categoria}
                  right={
                    <>
                      <span
                        className="font-semibold"
                        style={{ color: "hsl(var(--success))" }}
                      >
                        {formatCOP(p.utilidad)}
                      </span>
                      <div
                        className="text-[10px]"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {p.unidades} uds
                      </div>
                    </>
                  }
                />
              ))
            )}
          </div>
          <div
            className="p-[18px]"
            style={{ backgroundColor: "hsl(var(--card))" }}
          >
            <SubTitle>Utilidad por categoría</SubTitle>
            <div className="space-y-2.5 pt-1">
              {cats.map((x) => {
                const mp =
                  Number(x.ingreso) > 0
                    ? (Number(x.utilidad) / Number(x.ingreso)) * 100
                    : 0;
                return (
                  <div key={x.categoria}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span style={{ color: "hsl(var(--foreground))" }}>
                        {x.categoria}
                      </span>
                      <span
                        className="font-medium tabular-nums"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {formatCOP(x.utilidad)} · {mp.toFixed(0)}%
                      </span>
                    </div>
                    <div
                      className="h-2 overflow-hidden rounded-full"
                      style={{ backgroundColor: "hsl(var(--muted) / 0.4)" }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(Number(x.utilidad) / maxCat) * 100}%`,
                          backgroundColor: "hsl(var(--success))",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {Number(r.lineas_sin_costo) > 0 && (
          <div
            className="px-[18px] py-2.5 text-[11.5px]"
            style={{
              backgroundColor: "hsl(var(--warning) / 0.08)",
              color: "hsl(var(--warning))",
            }}
          >
            ⓘ {r.lineas_sin_costo} línea(s) vendidas sin costo registrado: el
            margen mostrado puede verse más alto de lo real.
          </div>
        )}
      </AdvCard>

      {/* Cartera + Inventario son las dos caras de "dónde está la plata": se
          emparejan en pantallas anchas (xl). Con la sidebar, en pantallas
          medianas van una debajo de otra para no quedar apretadas. */}
      <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-2">
        {/* 2. Cartera */}
        <AdvCard
          icon={Wallet}
          tone="--info"
          title="Salud de caja — cartera"
          subtitle={`Posición neta: ${formatCOP(posNeta)} (te deben − debes)`}
        >
          <div
            className="grid grid-cols-1 gap-px md:grid-cols-2"
            style={{ backgroundColor: "hsl(var(--border))" }}
          >
            <CarteraCol
              titulo="Por cobrar (te deben)"
              total={c.cxc_total}
              docs={c.cxc_docs}
              b0={c.cxc_0_30}
              b1={c.cxc_31_60}
              b2={c.cxc_61mas}
              tone="--success"
              lista={deudores}
              campo="cliente"
              vacio="Nadie te debe ✓"
            />
            <CarteraCol
              titulo="Por pagar (le debes a proveedores)"
              total={c.cxp_total}
              docs={c.cxp_docs}
              b0={c.cxp_0_30}
              b1={c.cxp_31_60}
              b2={c.cxp_61mas}
              tone="--destructive"
              lista={acreedores}
              campo="proveedor"
              vacio="No debes nada ✓"
            />
          </div>
        </AdvCard>

        {/* 3. Inventario como capital */}
        <AdvCard
          icon={Boxes}
          tone="--warning"
          title="Inventario como capital"
          subtitle="Cuánta plata está quieta en la bodega"
        >
          <div
            className="grid grid-cols-2 gap-px md:grid-cols-3"
            style={{ backgroundColor: "hsl(var(--border))" }}
          >
            <MiniStat
              label="Valor total inventario"
              value={formatCOP(inv.valor_total)}
              sub="a costo promedio"
            />
            <MiniStat
              label="Capital dormido (90+ días)"
              value={formatCOP(inv.capital_sin_rotar_90d)}
              sub={`${capPct.toFixed(0)}% del inventario · ${inv.productos_sin_rotar_90d} productos`}
              danger={capPct >= 40}
            />
            <MiniStat
              label="Sobrestock"
              value={formatCOP(inv.valor_sobrestock)}
              sub={`${inv.productos_sobrestock} productos sobre el máximo`}
            />
          </div>
          <div
            className="p-[18px]"
            style={{ backgroundColor: "hsl(var(--card))" }}
          >
            <SubTitle>
              <span className="inline-flex items-center gap-1.5">
                <Snowflake className="h-3 w-3" strokeWidth={1.8} />
                Más plata dormida (sin venderse hace 90+ días)
              </span>
            </SubTitle>
            {dormido.length === 0 ? (
              <Empty text="Todo el inventario rota ✓" />
            ) : (
              dormido.map((p, i) => (
                <RankRow
                  key={p.referencia ?? i}
                  rank={i + 1}
                  tone="--warning"
                  title={p.nombre}
                  sub={`${p.referencia} · ${p.cantidad} uds`}
                  right={
                    <>
                      <span
                        className="font-semibold"
                        style={{ color: "hsl(var(--warning))" }}
                      >
                        {formatCOP(p.valor)}
                      </span>
                      <div
                        className="text-[10px]"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {p.dias == null ? "nunca vendido" : `${p.dias} días`}
                      </div>
                    </>
                  }
                />
              ))
            )}
          </div>
        </AdvCard>
      </div>

      {/* 4. Desempeño */}
      <AdvCard
        icon={TrendingUp}
        tone="--primary"
        title="Desempeño del mes"
        subtitle={`Comparado con los primeros ${d.dias_transcurridos} días del mes pasado`}
      >
        <div
          className="grid grid-cols-2 gap-px md:grid-cols-5"
          style={{ backgroundColor: "hsl(var(--border))" }}
        >
          <MiniStat
            label="Ventas (mes a la fecha)"
            value={formatCOP(d.ventas_mtd)}
            sub={
              vDelta != null ? <DeltaInline delta={vDelta} /> : "sin referencia"
            }
          />
          <MiniStat
            label="Margen (mes a la fecha)"
            value={formatCOP(d.margen_mtd)}
            sub={
              mDelta != null ? <DeltaInline delta={mDelta} /> : "sin referencia"
            }
          />
          <MiniStat
            label="Ticket promedio"
            value={formatCOP(d.ticket_prom)}
            sub="por venta de mostrador"
          />
          <MiniStat
            label="Ventas"
            value={Number(d.tickets_mes ?? 0).toLocaleString("es-CO")}
            sub="tickets del mes"
          />
          <MiniStat
            label="Clientes"
            value={Number(d.clientes_mes ?? 0).toLocaleString("es-CO")}
            sub="distintos este mes"
          />
        </div>
        <div
          className="p-[18px]"
          style={{ backgroundColor: "hsl(var(--card))" }}
        >
          <SubTitle>
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-3 w-3" strokeWidth={1.8} />
              Mejores clientes del mes
            </span>
          </SubTitle>
          {clientes.length === 0 ? (
            <Empty />
          ) : (
            clientes.map((cl, i) => (
              <RankRow
                key={i}
                rank={i + 1}
                tone="--primary"
                title={cl.cliente}
                sub={`${cl.tickets} compra(s)`}
                right={
                  <span
                    className="font-semibold"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {formatCOP(cl.compras)}
                  </span>
                }
              />
            ))
          )}
        </div>
      </AdvCard>
    </div>
  );
}

function AdvCard({ icon, tone, title, subtitle, children }) {
  const Icon = icon;
  return (
    <SectionCard>
      <header
        className="flex items-center gap-2.5 border-b px-[18px] py-3"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <span
          className="grid h-6 w-6 place-items-center rounded-md"
          style={{
            backgroundColor: `hsl(var(${tone}) / 0.12)`,
            color: `hsl(var(${tone}))`,
          }}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
        </span>
        <div className="flex min-w-0 flex-col">
          <span
            className="text-[13.5px] font-semibold leading-tight"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {title}
          </span>
          {subtitle && (
            <span
              className="font-mono text-[10.5px]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {subtitle}
            </span>
          )}
        </div>
      </header>
      <div
        className="flex flex-col"
        style={{ gap: 1, backgroundColor: "hsl(var(--border))" }}
      >
        {children}
      </div>
    </SectionCard>
  );
}

function MiniStat({ label, value, sub, danger }) {
  return (
    <div
      className="flex flex-col gap-1 p-[18px]"
      style={{ backgroundColor: "hsl(var(--card))" }}
    >
      <span
        className="font-mono text-[10px] font-medium uppercase tracking-[0.08em]"
        style={{
          color: danger
            ? "hsl(var(--destructive))"
            : "hsl(var(--muted-foreground))",
        }}
      >
        {label}
      </span>
      <span
        className="font-mono text-[19px] font-semibold leading-tight tracking-[-0.02em] tabular-nums"
        style={{
          color: danger ? "hsl(var(--destructive))" : "hsl(var(--foreground))",
        }}
      >
        {value}
      </span>
      <span
        className="flex flex-wrap items-center gap-1 text-[11px]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {sub}
      </span>
    </div>
  );
}

function SubTitle({ children }) {
  return (
    <p
      className="mb-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em]"
      style={{ color: "hsl(var(--muted-foreground))" }}
    >
      {children}
    </p>
  );
}

function RankRow({ rank, tone = "--success", title, sub, right }) {
  return (
    <div
      className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
      style={{ borderColor: "hsl(var(--border))" }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="grid h-5 w-5 shrink-0 place-items-center rounded font-mono text-[10px] font-bold"
          style={{
            backgroundColor: `hsl(var(${tone}) / 0.14)`,
            color: `hsl(var(${tone}))`,
          }}
        >
          {rank}
        </span>
        <div className="min-w-0">
          <p
            className="truncate text-[12.5px] font-medium leading-tight"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {title}
          </p>
          <p
            className="truncate font-mono text-[10px]"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            {sub}
          </p>
        </div>
      </div>
      <div className="shrink-0 whitespace-nowrap text-right font-mono text-[11.5px]">
        {right}
      </div>
    </div>
  );
}

function DeltaInline({ delta }) {
  const up = delta >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className="inline-flex items-center gap-1 font-medium"
      style={{
        color: up ? "hsl(var(--success))" : "hsl(var(--destructive))",
      }}
    >
      <Icon className="h-3 w-3" strokeWidth={2} /> {Math.abs(delta).toFixed(1)}%
      vs mes pasado
    </span>
  );
}

function Empty({ text = "Sin datos" }) {
  return (
    <p
      className="py-3 text-center text-[12px] italic"
      style={{ color: "hsl(var(--muted-foreground))" }}
    >
      {text}
    </p>
  );
}

function AgingChip({ label, value, warn, danger }) {
  const tone = danger
    ? "--destructive"
    : warn
      ? "--warning"
      : "--muted-foreground";
  return (
    <span
      className="rounded border px-1.5 py-0.5 font-mono text-[10px]"
      style={{ borderColor: "hsl(var(--border))", color: `hsl(var(${tone}))` }}
    >
      {label}: {formatCOP(value)}
    </span>
  );
}

function CarteraCol({
  titulo,
  total,
  docs,
  b0,
  b1,
  b2,
  tone,
  lista,
  campo,
  vacio,
}) {
  const empty = Number(total) === 0;
  return (
    <div
      className="flex flex-col gap-3 p-[18px]"
      style={{ backgroundColor: "hsl(var(--card))" }}
    >
      <div>
        <p
          className="font-mono text-[10px] font-medium uppercase tracking-[0.08em]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {titulo}
        </p>
        <p
          className="font-mono text-[20px] font-semibold tabular-nums"
          style={{
            color: empty ? "hsl(var(--muted-foreground))" : `hsl(var(${tone}))`,
          }}
        >
          {formatCOP(total)}
        </p>
        <p
          className="text-[11px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {docs} documento(s)
        </p>
      </div>
      {!empty && (
        <div className="flex flex-wrap gap-1.5">
          <AgingChip label="0–30 d" value={b0} />
          <AgingChip label="31–60 d" value={b1} warn />
          <AgingChip label="+60 d" value={b2} danger />
        </div>
      )}
      {empty ? (
        <p
          className="text-[12px] italic"
          style={{ color: "hsl(var(--success))" }}
        >
          {vacio}
        </p>
      ) : (
        <div className="pt-1">
          {(lista ?? []).map((it, i) => (
            <RankRow
              key={i}
              rank={i + 1}
              tone={tone}
              title={it[campo]}
              sub={`${it.docs} doc(s)`}
              right={
                <span
                  className="font-semibold"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {formatCOP(it.saldo)}
                </span>
              }
            />
          ))}
        </div>
      )}
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
      // `min-w-0` es clave: sin él, un ítem de grilla no encoge por debajo de
      // su contenido (min-width:auto), así que un valor grande como
      // "$ 443.189.627" ensanchaba su columna y desbordaba/pisaba las vecinas
      // (los KPIs se veían superpuestos sobre las líneas divisorias).
      className={`flex min-w-0 flex-col gap-1.5 pr-5 md:pl-5 md:first:pl-0 lg:pr-3.5 lg:pl-3.5 lg:first:pl-0 ${
        last ? "" : "md:border-r md:border-dashed"
      }`}
      style={last ? undefined : { borderColor: "hsl(var(--border))" }}
    >
      <div
        // `min-h` de 2 líneas: los títulos tienen largos distintos ("Ventas · hoy"
        // vs "Margen bruto del mes"), unos caben en un renglón y otros en dos. Sin
        // una altura común, el valor de cada KPI arrancaba a distinta altura y la
        // tira se veía despareja. Reservando 2 líneas para TODOS, los valores
        // quedan alineados. En lg se reduce el interletrado para que los títulos
        // largos quepan mejor.
        className="min-h-[2.6em] font-mono text-[10.5px] font-medium uppercase leading-[1.3] tracking-[0.08em] lg:tracking-[0.03em]"
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
        {/* ` ` (espacio duro) pega el ⓘ a la última palabra: si no, el
            ícono se iba solo a un segundo renglón y se veía descolgado. */}
        {hint && <span aria-hidden="true">{" "}ⓘ</span>}
      </div>
      <div
        // Tamaño responsivo: en la tira de 6 columnas (lg) cada KPI tiene poco
        // ancho, y montos de cientos de millones a 20px partían a dos líneas y
        // se veían feos. En lg baja a 15px y `whitespace-nowrap` fuerza una sola
        // línea; con el `min-w-0` + padding reducido del contenedor, hasta el
        // mayor ("$ 443.172.967") entra completo sin desbordar.
        className="whitespace-nowrap font-mono text-[20px] font-semibold leading-tight tracking-[-0.02em] tabular-nums md:text-[18px] lg:text-[15px]"
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
