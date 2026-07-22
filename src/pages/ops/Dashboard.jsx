import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import PageHeader from "../../components/layout/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import { formatCOP, safeError } from "../../lib/utils";
import { supabase } from "../../lib/supabase";

const ACTIVITY_DOT = {
  venta: "hsl(var(--success))",
  traspaso_entrada: "hsl(var(--info))",
  traspaso_salida: "hsl(var(--info))",
  ajuste: "hsl(var(--warning))",
  compra: "hsl(var(--primary))",
  devolucion: "hsl(var(--muted-foreground))",
};

const ALERT_LABEL = {
  warning: "Atención",
  danger: "Crítico",
  info: "Info",
};

/* ── KPI Card ──────────────────────────────────────────────────────────── */
function KpiCard({ title, value, subtitle, trend, icon, loading }) {
  return (
    <div className="kpi-card animate-fade-in">
      <div className="flex items-center justify-between mb-2">
        <p
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {title}
        </p>
        <span style={{ color: "hsl(var(--muted-foreground))" }}>{icon}</span>
      </div>
      <p
        className="text-2xl font-bold leading-tight"
        style={{ color: "hsl(var(--foreground))" }}
      >
        {loading ? (
          <span
            className="inline-block w-20 h-7 rounded animate-pulse"
            style={{ backgroundColor: "hsl(var(--muted))" }}
          />
        ) : (
          value
        )}
      </p>
      {(subtitle || trend) && (
        <div className="flex items-center gap-2 mt-1">
          {trend && !loading && (
            <span
              className="text-xs font-medium"
              style={{
                color: trend.positive
                  ? "hsl(var(--success))"
                  : "hsl(var(--destructive))",
              }}
            >
              {trend.positive ? "↑" : "↓"} {trend.value}
            </span>
          )}
          {subtitle && (
            <span
              className="text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Quick action button ───────────────────────────────────────────────── */
function QuickAction({ label, icon, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-3 rounded-lg border text-left transition-all cursor-pointer w-full"
      style={{
        borderColor: "hsl(var(--border))",
        backgroundColor: "hsl(var(--card))",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "hsl(var(--primary) / 0.3)";
        e.currentTarget.style.backgroundColor = "hsl(var(--primary) / 0.05)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "hsl(var(--border))";
        e.currentTarget.style.backgroundColor = "hsl(var(--card))";
      }}
    >
      <span style={{ color: "hsl(var(--muted-foreground))" }}>{icon}</span>
      <span
        className="text-sm font-medium"
        style={{ color: "hsl(var(--foreground))" }}
      >
        {label}
      </span>
    </button>
  );
}

/* ── SVG icons ─────────────────────────────────────────────────────────── */
function Icon({ d, size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  dollar: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
  package: "M20 7l-8-4-8 4m16 0-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  clock:
    "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 6v6l4 2",
  alert:
    "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01",
  cart: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z",
  truck:
    "M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4",
  arrows: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4",
  wrench:
    "M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z",
  chevron: "M9 18l6-6-6-6",
  refresh:
    "M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15",
};

const ROL_LABEL = {
  Admin: "Administrador",
  Bodeguero: "Bodeguero",
  Vendedor: "Vendedor",
  Tecnico: "Técnico",
};

function formatTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Ahora";
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs}h`;
  return `Hace ${Math.floor(hrs / 24)}d`;
}

function trendPercent(hoy, ayer) {
  if (!ayer || ayer === 0) return null;
  const pct = Math.round(((hoy - ayer) / ayer) * 100);
  return { value: `${Math.abs(pct)}%`, positive: pct >= 0 };
}

/* ── Dashboard ─────────────────────────────────────────────────────────── */
export default function Dashboard() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [kpis, setKpis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const cargarKpis = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("fn_dashboard_kpis");
    if (err) {
      setError(safeError(err, "Error al cargar el dashboard"));
    } else {
      setKpis(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargarKpis();
  }, [cargarKpis]);

  const nombre = perfil?.nombre?.split(" ")[0] ?? "Usuario";
  const rol = ROL_LABEL[perfil?.rol] ?? perfil?.rol ?? "";
  const sede = perfil?.sede_id ?? "";
  const fecha = new Date().toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Ventas de MOSTRADOR de la sede del usuario (la RPC ya filtra por sede para
  // los no-Admin). Se renombró de "Ventas hoy" a "Mostrador hoy" al agregar la
  // tarjeta de servicios, para que el vendedor distinga sus dos fuentes.
  const ventasHoy = kpis?.ventas_hoy ?? 0;
  const ventasAyer = kpis?.ventas_ayer ?? 0;
  const trend = trendPercent(ventasHoy, ventasAyer);
  // Servicios (abonos de OT) de la sede del usuario, cobrados hoy. Antes el
  // vendedor no veía esta plata en su panel aunque sí la recauda.
  const serviciosHoy = kpis?.servicios_hoy ?? 0;
  const serviciosAyer = kpis?.servicios_ayer ?? 0;
  const trendServicios = trendPercent(serviciosHoy, serviciosAyer);
  const alertas = kpis?.alertas ?? [];
  const actividad = kpis?.actividad_reciente ?? [];

  /* Quick actions filtered by role */
  const QUICK_ACTIONS = [
    {
      label: "Nueva Venta",
      icon: <Icon d={ICONS.cart} />,
      url: "/ops/ventas/nueva",
      roles: ["Admin", "Vendedor"],
    },
    {
      label: "Buscar Producto",
      icon: <Icon d={ICONS.package} />,
      url: "/ops/inventario",
      roles: ["Admin", "Bodeguero", "Vendedor", "Tecnico"],
    },
    {
      label: "Nuevo Traspaso",
      icon: <Icon d={ICONS.arrows} />,
      url: "/ops/traspasos",
      roles: ["Admin", "Bodeguero", "Vendedor"],
    },
    {
      label: "Orden de Trabajo",
      icon: <Icon d={ICONS.wrench} />,
      url: "/ops/ordenes",
      roles: ["Admin", "Tecnico", "Vendedor"],
    },
    {
      label: "Registrar Compra",
      icon: <Icon d={ICONS.truck} />,
      url: "/ops/compras",
      roles: ["Admin", "Bodeguero"],
    },
  ].filter((a) => a.roles.includes(perfil?.rol));

  return (
    <div
      className="p-4 sm:p-6 space-y-6 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      {/* Header */}
      <PageHeader
        title={`Bienvenido, ${nombre}`}
        description={`${rol}${sede ? ` · ${sede}` : ""} · ${fecha}`}
        actions={
          <button
            onClick={cargarKpis}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors"
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
            <Icon d={ICONS.refresh} size={13} />
            Actualizar
          </button>
        }
      />

      {error && (
        <div
          className="px-4 py-3 rounded-lg text-sm"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.1)",
            color: "hsl(var(--destructive))",
          }}
        >
          Error al cargar datos: {error}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
        <KpiCard
          title="Mostrador hoy"
          value={formatCOP(ventasHoy)}
          icon={<Icon d={ICONS.dollar} size={15} />}
          trend={trend}
          subtitle="vs. ayer"
          loading={loading}
        />
        <KpiCard
          title="Servicios hoy"
          value={formatCOP(serviciosHoy)}
          icon={<Icon d={ICONS.dollar} size={15} />}
          trend={trendServicios}
          subtitle="abonos de OT · vs. ayer"
          loading={loading}
        />
        <KpiCard
          title="Productos activos"
          value={(kpis?.total_productos_activos ?? 0).toLocaleString("es-CO")}
          icon={<Icon d={ICONS.package} size={15} />}
          subtitle="en catálogo"
          loading={loading}
        />
        <KpiCard
          title="Alertas de stock"
          value={kpis?.alertas_count ?? 0}
          icon={<Icon d={ICONS.alert} size={15} />}
          subtitle="bajo o agotado"
          loading={loading}
        />
        <KpiCard
          title="Actividad hoy"
          value={
            actividad.filter(
              (a) =>
                a.created_at &&
                new Date(a.created_at).toDateString() ===
                  new Date().toDateString(),
            ).length
          }
          icon={<Icon d={ICONS.clock} size={15} />}
          subtitle="movimientos"
          loading={loading}
        />
      </div>

      {/* Bottom 3-col grid */}
      <div className="grid md:grid-cols-3 gap-4 md:gap-6">
        {/* Quick actions */}
        <div className="space-y-3">
          <h3
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Acciones rápidas
          </h3>
          <div className="grid grid-cols-1 gap-2">
            {QUICK_ACTIONS.map((a) => (
              <QuickAction
                key={a.label}
                label={a.label}
                icon={a.icon}
                onClick={() => navigate(a.url)}
              />
            ))}
          </div>
        </div>

        {/* Alerts */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Alertas de stock
            </h3>
            <button
              onClick={() => navigate("/ops/inventario")}
              className="flex items-center gap-1 text-xs transition-colors cursor-pointer"
              style={{ color: "hsl(var(--muted-foreground))" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = "hsl(var(--foreground))")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = "hsl(var(--muted-foreground))")
              }
            >
              Ver inventario
              <Icon d={ICONS.chevron} size={12} />
            </button>
          </div>
          <div className="space-y-2">
            {loading ? (
              [1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-11 rounded-lg animate-pulse"
                  style={{ backgroundColor: "hsl(var(--muted))" }}
                />
              ))
            ) : alertas.length === 0 ? (
              <p
                className="text-sm py-4 text-center"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Sin alertas activas ✓
              </p>
            ) : (
              alertas.map((alert, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-lg border"
                  style={{
                    borderColor: "hsl(var(--border))",
                    backgroundColor: "hsl(var(--card))",
                  }}
                >
                  <span
                    style={{
                      color:
                        alert.severity === "danger"
                          ? "hsl(var(--destructive))"
                          : alert.severity === "warning"
                            ? "hsl(var(--warning))"
                            : "hsl(var(--info))",
                    }}
                  >
                    <Icon d={ICONS.alert} size={15} />
                  </span>
                  <span
                    className="text-sm flex-1 min-w-0 truncate"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {alert.message}
                  </span>
                  <StatusBadge status={alert.severity}>
                    {ALERT_LABEL[alert.severity] ?? alert.severity}
                  </StatusBadge>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent activity */}
        <div className="space-y-3">
          <h3
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Actividad reciente
          </h3>
          <div className="space-y-1">
            {loading ? (
              [1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="h-10 rounded-lg animate-pulse"
                  style={{ backgroundColor: "hsl(var(--muted))" }}
                />
              ))
            ) : actividad.length === 0 ? (
              <p
                className="text-sm py-4 text-center"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Sin actividad reciente
              </p>
            ) : (
              actividad.map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 p-2.5 rounded-lg transition-colors"
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor =
                      "hsl(var(--muted) / 0.5)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "")
                  }
                >
                  <div
                    className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                    style={{
                      backgroundColor:
                        ACTIVITY_DOT[item.type] ??
                        "hsl(var(--muted-foreground))",
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm leading-tight truncate"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {item.action}
                    </p>
                    <p
                      className="text-xs mt-0.5"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {item.user} · {formatTimeAgo(item.created_at)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
