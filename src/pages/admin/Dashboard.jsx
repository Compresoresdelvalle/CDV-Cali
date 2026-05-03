import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { formatCOP, formatDate, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";

export default function Dashboard() {
  const navigate = useNavigate();
  const [kpis, setKpis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
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
    try {
      const { data, error } = await Promise.race([
        supabase.rpc("fn_dashboard_kpis"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout: red lenta")), 15000),
        ),
      ]);
      if (!mountedRef.current) return;
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setKpis(data);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar dashboard"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  // Refs para evitar closures stale en setInterval
  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;

  useEffect(() => {
    cargarRef.current();
    let interval = null;
    const start = () => {
      if (interval) return;
      interval = setInterval(() => cargarRef.current(), 60_000);
    };
    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    // Solo refrescar si la pestaña está visible (ahorra recursos)
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        cargarRef.current();
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
      <div className="p-4 sm:p-6 space-y-4">
        <PageHeader title="Dashboard" description="Cargando…" />
        <SkeletonGrid />
      </div>
    );
  }

  if (errorMsg && !kpis) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <PageHeader title="Dashboard" />
        <ErrorBox msg={errorMsg} onRetry={cargar} />
      </div>
    );
  }

  const k = kpis ?? {};
  const ventasDelta =
    k.ventas_hoy && k.ventas_ayer
      ? ((k.ventas_hoy - k.ventas_ayer) / k.ventas_ayer) * 100
      : null;

  return (
    <div
      className="p-4 sm:p-6 space-y-5 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Dashboard Admin"
        description="Métricas en tiempo real · refresco automático cada 60s"
        actions={
          <button
            onClick={cargar}
            className="h-9 px-4 rounded-lg text-sm font-medium border cursor-pointer"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            ↻ Refrescar
          </button>
        }
      />

      {errorMsg && <ErrorBox msg={errorMsg} onRetry={cargar} small />}

      {/* KPIs principales */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Ventas hoy"
          value={formatCOP(k.ventas_hoy ?? 0)}
          delta={ventasDelta}
          highlight
        />
        <KpiCard label="Esta semana" value={formatCOP(k.ventas_semana ?? 0)} />
        <KpiCard label="Este mes" value={formatCOP(k.ventas_mes ?? 0)} />
        <KpiCard
          label="Ticket promedio"
          value={formatCOP(k.ticket_promedio_mes ?? 0)}
        />
        <KpiCard
          label="Compras del mes"
          value={formatCOP(k.compras_mes ?? 0)}
        />
        <KpiCard
          label="Valor inventario"
          value={formatCOP(k.valor_inventario ?? 0)}
        />
        <KpiCard
          label="Productos activos"
          value={(k.total_productos_activos ?? 0).toLocaleString("es-CO")}
        />
        <KpiCard
          label="Alertas stock"
          value={k.alertas_count ?? 0}
          danger={k.alertas_count > 0}
          onClick={() => navigate("/admin/alertas")}
        />
      </div>

      {/* KPIs operacionales */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <SmallKpi
          label="Órdenes abiertas"
          value={k.ordenes_abiertas ?? 0}
          onClick={() => navigate("/ops/ordenes")}
        />
        <SmallKpi
          label="Cotizaciones vigentes"
          value={k.cotizaciones_vigentes ?? 0}
          onClick={() => navigate("/ops/cotizaciones")}
        />
        <SmallKpi
          label="Traspasos en tránsito"
          value={k.traspasos_en_transito ?? 0}
          onClick={() => navigate("/ops/traspasos")}
        />
        <SmallKpi
          label="Herramientas prestadas"
          value={k.herramientas_prestadas ?? 0}
          onClick={() => navigate("/ops/herramientas")}
        />
        <SmallKpi
          label="Ensambles pendientes"
          value={k.ensambles_pendientes ?? 0}
          onClick={() => navigate("/ops/ensambles")}
        />
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-4">
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
      </div>

      {/* Top productos + actividad reciente */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Top 5 productos del mes">
          {(k.top5_productos_mes ?? []).length === 0 ? (
            <Empty>Sin ventas este mes</Empty>
          ) : (
            <ul className="space-y-2" role="list">
              {k.top5_productos_mes.map((p, i) => (
                <li
                  key={p.referencia}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg"
                  style={{ backgroundColor: "hsl(var(--muted) / 0.3)" }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="text-xs font-bold w-6 h-6 rounded flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: "hsl(var(--primary))",
                        color: "hsl(var(--primary-foreground))",
                      }}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p
                        className="text-sm font-medium truncate"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {p.nombre}
                      </p>
                      <p
                        className="text-xs font-mono"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {p.referencia}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
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
        </Section>

        <Section title="Actividad reciente">
          {(k.actividad_reciente ?? []).length === 0 ? (
            <Empty>Sin movimientos recientes</Empty>
          ) : (
            <ul
              className="space-y-1.5 max-h-[400px] overflow-y-auto"
              role="list"
            >
              {k.actividad_reciente.map((a) => (
                <li
                  key={a.id ?? `${a.created_at}-${a.type}`}
                  className="flex items-start justify-between gap-2 px-2 py-1.5 rounded text-xs border-b"
                  style={{ borderColor: "hsl(var(--border) / 0.5)" }}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {a.action}
                    </p>
                    <p style={{ color: "hsl(var(--muted-foreground))" }}>
                      {a.user} · {formatDate(a.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

/* ── Components ──────────────────────────────────────────────────────── */

function KpiCard({ label, value, delta, danger, highlight, onClick }) {
  const interactive = !!onClick;
  return (
    <button
      onClick={onClick}
      disabled={!interactive}
      className={`text-left rounded-xl border p-4 transition-all ${
        interactive ? "cursor-pointer hover:opacity-95" : "cursor-default"
      }`}
      style={{
        backgroundColor: danger
          ? "hsl(var(--destructive) / 0.08)"
          : "hsl(var(--card))",
        borderColor: danger
          ? "hsl(var(--destructive) / 0.4)"
          : highlight
            ? "hsl(var(--primary))"
            : "hsl(var(--border))",
      }}
    >
      <p
        className="text-xs font-medium uppercase tracking-wide mb-1"
        style={{
          color: danger
            ? "hsl(var(--destructive))"
            : "hsl(var(--muted-foreground))",
        }}
      >
        {label}
      </p>
      <p
        className="text-xl font-bold tabular-nums truncate"
        style={{
          color: danger ? "hsl(var(--destructive))" : "hsl(var(--foreground))",
        }}
      >
        {value}
      </p>
      {delta !== null && delta !== undefined && (
        <p
          className="text-xs mt-1 tabular-nums"
          style={{
            color:
              delta > 0
                ? "hsl(var(--success))"
                : delta < 0
                  ? "hsl(var(--destructive))"
                  : "hsl(var(--muted-foreground))",
          }}
        >
          {delta > 0 ? "↑" : delta < 0 ? "↓" : "→"} {Math.abs(delta).toFixed(1)}
          % vs ayer
        </p>
      )}
    </button>
  );
}

function SmallKpi({ label, value, onClick }) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-lg border p-3 transition-all cursor-pointer hover:opacity-90"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
        {label}
      </p>
      <p
        className="text-2xl font-bold tabular-nums"
        style={{ color: "hsl(var(--foreground))" }}
      >
        {value}
      </p>
    </button>
  );
}

function ChartCard({ title, children, empty }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <h3
        className="text-xs font-semibold uppercase tracking-wide mb-3"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {title}
      </h3>
      {empty ? (
        <p
          className="text-xs italic text-center py-8"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Sin datos para mostrar
        </p>
      ) : (
        children
      )}
    </div>
  );
}

function LineChart({ data }) {
  // SVG minimalist line chart for daily trend
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
      className="w-full h-auto"
      role="img"
      aria-label="Tendencia de ventas últimos 7 días"
    >
      {/* grid */}
      <line
        x1={PAD}
        y1={H - PAD}
        x2={W - PAD}
        y2={H - PAD}
        stroke="hsl(var(--border))"
        strokeWidth="1"
      />
      {/* área bajo la línea */}
      <path
        d={`${path} L ${points[points.length - 1]?.x ?? PAD} ${H - PAD} L ${PAD} ${H - PAD} Z`}
        fill="hsl(var(--primary) / 0.15)"
      />
      {/* línea */}
      <path d={path} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" />
      {/* puntos */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="3" fill="hsl(var(--primary))" />
          <title>
            {new Date(p.fecha).toLocaleDateString("es-CO", {
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
    <div className="space-y-2">
      {data.map((d) => {
        const pct = (Number(d.total) / max) * 100;
        return (
          <div key={d.sede}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span style={{ color: "hsl(var(--foreground))" }}>{d.sede}</span>
              <span
                className="tabular-nums font-medium"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {formatCOP(d.total)}
              </span>
            </div>
            <div
              className="h-2 rounded-full overflow-hidden"
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

function Section({ title, children }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <h3
        className="text-xs font-semibold uppercase tracking-wide mb-3"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return (
    <p
      className="text-xs italic text-center py-6"
      style={{ color: "hsl(var(--muted-foreground))" }}
    >
      {children}
    </p>
  );
}

function ErrorBox({ msg, onRetry, small }) {
  return (
    <div
      className={`rounded-lg border ${small ? "px-3 py-2" : "p-4"} flex items-center justify-between gap-3`}
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
          className="text-xs px-3 py-1.5 rounded border cursor-pointer"
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

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className="rounded-xl p-4 animate-pulse border h-24"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        />
      ))}
    </div>
  );
}
