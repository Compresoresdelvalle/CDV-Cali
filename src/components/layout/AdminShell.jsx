import { useState, useEffect, useRef } from "react";
import {
  Outlet,
  Link,
  NavLink,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  ArrowLeftCircle,
  Bell,
  LogOut,
  Menu,
  X,
  LayoutDashboard,
  ClipboardList,
  ClipboardCheck,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import ThemeToggle from "../ui/ThemeToggle";
import NotificacionesBell from "../admin/NotificacionesBell";
import Logo from "../ui/Logo";
import ErrorBoundary from "../ui/ErrorBoundary";
import { supabase } from "../../lib/supabase";
import { SECCIONES_ADMIN, getInitials } from "../../lib/admin-shell-ui";

/* ── Hook: conteo de alertas de stock (admin = todas las sedes) ─────────── */
function useAlertasCountAdmin(perfil) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!perfil?.id) return;

    const fetchCount = async () => {
      const { count: c, error } = await supabase
        .from("inventario")
        // productos!inner + activo: no contar alertas de productos dados de baja.
        .select("id, producto:productos!inner(activo)", {
          count: "exact",
          head: true,
        })
        .eq("producto.activo", true)
        .in("estado_stock", ["Bajo", "Agotado"]);
      // Si la consulta falla, conservar el último conteo conocido en vez de
      // caer a 0 (que leería como "todo en orden" siendo mentira).
      if (!error) setCount(c ?? 0);
    };

    fetchCount();

    const channel = supabase
      .channel("alertas-stock-admin")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventario" },
        fetchCount,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [perfil?.id]);

  return count;
}

/* ── Sidebar admin (desktop ≥ lg) ─────────────────────────────────────── */
function SidebarAdminItem({ href, label, icon }) {
  const Icon = icon;
  const location = useLocation();
  const active =
    href === "/admin"
      ? location.pathname === "/admin"
      : location.pathname === href || location.pathname.startsWith(href + "/");

  return (
    <li>
      <Link
        to={href}
        data-active={active}
        className="group flex h-9 items-center gap-2.5 rounded-md px-3 text-[13px] text-white/70 transition-colors hover:bg-white/[0.04] hover:text-white data-[active=true]:bg-[--info-500]/15 data-[active=true]:text-white data-[active=true]:shadow-[inset_2px_0_0_var(--info-500)]"
      >
        <Icon className="h-[15px] w-[15px] shrink-0" strokeWidth={1.75} />
        <span className="truncate">{label}</span>
      </Link>
    </li>
  );
}

function SidebarAdmin() {
  return (
    <aside className="chv-sidebar-admin hidden lg:flex w-[240px] shrink-0 flex-col">
      <div className="flex h-14 items-center gap-2.5 border-b border-white/[0.04] px-4">
        <Logo className="h-7 w-7" />
        <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-white/80">
          Panel administrativo
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {SECCIONES_ADMIN.map((seccion) => (
          <div key={seccion.id} className="mb-4">
            <div className="px-3 pb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-white/35">
              {seccion.label}
            </div>
            <ul className="space-y-0.5">
              {seccion.modulos.map((m) => (
                <SidebarAdminItem
                  key={m.id}
                  href={m.href}
                  label={m.label}
                  icon={m.icon}
                />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.04] px-4 py-3 text-[10.5px] text-white/35">
        Acceso restringido · solo Admin
      </div>
    </aside>
  );
}

/* ── Topbar admin (gradiente de marca) ────────────────────────────────── */
function HeaderAdmin({ perfil, initials, onLogout }) {
  return (
    <header className="chv-topbar chv-topbar-admin sticky top-0 z-30 hidden lg:flex h-14 items-center gap-3 px-4">
      <Link
        to="/ops"
        className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-2.5 text-[12px] font-medium text-white hover:bg-white/20"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={2} />
        Volver a Operaciones
      </Link>

      <div className="ml-3 hidden md:flex items-center gap-2">
        <span className="dot-pulse h-1.5 w-1.5 rounded-full bg-[--info-500]" />
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-white/75">
          Modo administrador
        </span>
      </div>

      <div className="flex-1" />

      <ThemeToggle />

      <NotificacionesBell />

      <Link
        to="/admin/alertas"
        className="focus-ring relative grid h-9 w-9 place-items-center rounded-md text-white/85 hover:bg-white/10"
        aria-label="Ver alertas"
        title="Ver alertas"
      >
        <Bell className="h-4 w-4" strokeWidth={1.75} />
      </Link>

      <div className="ml-1 flex h-8 items-center gap-2 pl-2">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-white/15 ring-1 ring-white/25 font-mono text-[11px] font-semibold text-white">
          {initials}
        </div>
        <div className="hidden text-left leading-tight sm:block">
          <div className="text-[12px] font-medium text-white">
            {perfil?.nombre}
          </div>
          <div className="text-[10.5px] text-white/70">Admin</div>
        </div>
        <button
          onClick={onLogout}
          className="focus-ring ml-1 grid h-9 w-9 place-items-center rounded-md text-white/85 hover:bg-white/10"
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}

/* ── Header móvil/tablet (< lg) ───────────────────────────────────────────
 * Salida rápida a Operaciones, alertas con contador y avatar que abre el menú
 * admin completo (drawer). Respeta el notch con env(safe-area-inset-top).
 * ──────────────────────────────────────────────────────────────────────── */
function MobileHeaderAdmin({ initials, alertCount, onBell, onMenu }) {
  return (
    <header
      className="chv-topbar chv-topbar-admin sticky top-0 z-30 flex lg:hidden items-center justify-between px-4"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        height: "calc(3.5rem + env(safe-area-inset-top))",
      }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Logo className="h-7 w-7" />
        <span className="font-mono text-[12px] font-semibold uppercase tracking-[0.1em] text-white">
          Panel Admin
        </span>
      </div>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <Link
          to="/ops"
          className="focus-ring grid h-10 w-10 place-items-center rounded-md text-white/90 hover:bg-white/10"
          aria-label="Volver a Operaciones"
          title="Volver a Operaciones"
        >
          <ArrowLeftCircle className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </Link>
        <button
          onClick={onBell}
          className="focus-ring relative grid h-10 w-10 place-items-center rounded-md text-white/90 hover:bg-white/10"
          aria-label={
            alertCount > 0
              ? `${alertCount} alertas de stock`
              : "Sin alertas de stock"
          }
        >
          <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
          {alertCount > 0 && (
            <span
              className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold leading-none text-white"
              style={{ backgroundColor: "var(--dang-500)" }}
            >
              {alertCount > 99 ? "99+" : alertCount}
            </span>
          )}
        </button>
        <button
          onClick={onMenu}
          className="focus-ring grid h-10 w-10 place-items-center rounded-full bg-white/15 font-mono text-[11px] font-semibold text-white ring-1 ring-white/25"
          aria-label="Abrir menú administrativo"
        >
          {initials}
        </button>
      </div>
    </header>
  );
}

/* ── Drawer admin "Más" (móvil/tablet < lg) ───────────────────────────────
 * Acceso a los 12 módulos del panel admin agrupados por sección + salida
 * destacada a Operaciones. Cierra con Escape y restaura el foco.
 * ──────────────────────────────────────────────────────────────────────── */
function AdminSheetLink({ to, end, icon, label, onClose }) {
  const Icon = icon;
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClose}
      className="flex min-h-[56px] items-center gap-3 rounded-xl border px-3 text-[13.5px] font-medium transition-colors"
      style={({ isActive }) => ({
        borderColor: isActive ? "var(--info-500)" : "var(--n-150)",
        backgroundColor: isActive ? "var(--info-50)" : "var(--n-0)",
        color: isActive ? "var(--info-700)" : "var(--n-800)",
      })}
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px]"
        style={{
          backgroundColor: "var(--info-50)",
          color: "var(--info-700)",
        }}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

function MoreSheetAdmin({ open, onClose, perfil, initials, onLogout }) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (prevFocus instanceof HTMLElement) prevFocus.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="lg:hidden fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Menú administrativo"
    >
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
        aria-hidden="true"
      />
      <div
        className="absolute inset-x-0 bottom-0 flex max-h-[90vh] flex-col overflow-hidden rounded-t-3xl"
        style={{
          backgroundColor: "var(--n-0)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div className="flex justify-center pt-2.5">
          <span
            className="h-1 w-10 rounded-full"
            style={{ backgroundColor: "var(--n-150)" }}
          />
        </div>

        {/* Header del drawer */}
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--n-150)" }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-mono text-[12px] font-semibold text-white"
              style={{ backgroundColor: "var(--info-600)" }}
            >
              {initials}
            </div>
            <div className="min-w-0 leading-tight">
              <div
                className="truncate text-[14px] font-semibold"
                style={{ color: "var(--n-950)" }}
              >
                {perfil?.nombre}
              </div>
              <div
                className="font-mono text-[10.5px] uppercase tracking-[0.1em]"
                style={{ color: "var(--info-700)" }}
              >
                Modo administrador
              </div>
            </div>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Cerrar menú"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-md"
            style={{ color: "var(--n-500)" }}
          >
            <X className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {/* Salida destacada a Operaciones */}
          <NavLink
            to="/ops"
            onClick={onClose}
            className="flex min-h-[52px] items-center gap-3 rounded-xl border px-3 text-[13.5px] font-semibold"
            style={{
              borderColor: "var(--info-500)",
              backgroundColor: "var(--info-50)",
              color: "var(--info-700)",
            }}
          >
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px]"
              style={{
                backgroundColor: "var(--n-0)",
                color: "var(--info-700)",
              }}
            >
              <ArrowLeftCircle
                className="h-[18px] w-[18px]"
                strokeWidth={1.75}
              />
            </span>
            Volver a Operaciones
          </NavLink>

          {SECCIONES_ADMIN.map((seccion) => (
            <div key={seccion.id} className="mt-3">
              <div
                className="px-1 pb-1.5 font-mono text-[10px] uppercase tracking-[0.1em]"
                style={{ color: "var(--n-300)" }}
              >
                {seccion.label}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {seccion.modulos.map((m) => (
                  <AdminSheetLink
                    key={m.id}
                    to={m.href}
                    end={m.href === "/admin"}
                    icon={m.icon}
                    label={m.label}
                    onClose={onClose}
                  />
                ))}
              </div>
            </div>
          ))}

          <button
            onClick={onLogout}
            className="mt-4 flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-xl border text-[14px] font-semibold"
            style={{
              borderColor: "var(--n-150)",
              color: "var(--dang-600)",
            }}
          >
            <LogOut className="h-[18px] w-[18px]" strokeWidth={1.75} />
            Cerrar sesión
          </button>
        </nav>
      </div>
    </div>
  );
}

/* ── Bottom nav admin (móvil/tablet < lg) ─────────────────────────────────
 * Barra CONTEXTUAL de administración: Resumen · Alertas · Conteo · Auditoría
 * + "Más" (drawer con los 12 módulos). No muestra accesos de Operaciones.
 * ──────────────────────────────────────────────────────────────────────── */
const ADMIN_TABS = [
  {
    id: "resumen",
    label: "Resumen",
    href: "/admin",
    icon: LayoutDashboard,
    end: true,
  },
  {
    id: "alertas",
    label: "Alertas",
    href: "/admin/alertas",
    icon: Bell,
    badge: true,
  },
  { id: "conteo", label: "Conteo", href: "/admin/conteo", icon: ClipboardList },
  {
    id: "auditoria",
    label: "Auditoría",
    href: "/admin/auditoria",
    icon: ClipboardCheck,
  },
];

function BottomNavAdmin({ alertCount, onMore }) {
  return (
    <nav
      className="chv-bottomnav lg:hidden sticky bottom-0 z-30 grid grid-cols-5"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {ADMIN_TABS.map((it) => {
        const { icon: Icon } = it;
        return (
          <NavLink
            key={it.id}
            to={it.href}
            end={it.end}
            className="relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-2 text-[10px]"
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={`h-[18px] w-[18px] ${isActive ? "text-white" : "text-white/85"}`}
                  strokeWidth={isActive ? 2 : 1.75}
                />
                <span
                  className={`leading-tight text-center ${
                    isActive ? "font-medium text-white" : "text-white/85"
                  }`}
                >
                  {it.label}
                </span>
                {it.badge && alertCount > 0 && (
                  <span
                    className="absolute right-[18%] top-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold leading-none text-white"
                    style={{ backgroundColor: "var(--dang-500)" }}
                  >
                    {alertCount > 99 ? "99+" : alertCount}
                  </span>
                )}
              </>
            )}
          </NavLink>
        );
      })}

      <button
        onClick={onMore}
        className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-2 text-[10px] text-white/85"
        aria-label="Más opciones administrativas"
      >
        <Menu className="h-[18px] w-[18px]" strokeWidth={1.75} />
        <span>Más</span>
      </button>
    </nav>
  );
}

/* ── AdminShell ───────────────────────────────────────────────────────── */
export default function AdminShell() {
  const { perfil, logout } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const initials = getInitials(perfil?.nombre || "");
  const alertCount = useAlertasCountAdmin(perfil);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [moreOpen]);

  const handleLogout = async () => {
    await logout();
    window.location.assign("/login");
  };

  return (
    <div
      className="admin-shell flex h-screen overflow-hidden"
      style={{ backgroundColor: "var(--n-50)" }}
    >
      {/* Sidebar oscuro (desktop) */}
      <SidebarAdmin />

      {/* Área principal */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Topbar desktop */}
        <HeaderAdmin
          perfil={perfil}
          initials={initials}
          onLogout={handleLogout}
        />

        {/* Header móvil/tablet */}
        <MobileHeaderAdmin
          initials={initials}
          alertCount={alertCount}
          onBell={() => navigate("/admin/alertas")}
          onMenu={() => setMoreOpen(true)}
        />

        {/* Página */}
        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
          {/* La barrera contiene el fallo en el contenido: si una pantalla del
              panel revienta, el sidebar y la navegación siguen vivos y se ve el
              error real en vez de una pantalla en blanco. */}
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>

        {/* Bottom nav móvil/tablet */}
        <BottomNavAdmin
          alertCount={alertCount}
          onMore={() => setMoreOpen(true)}
        />
      </div>

      {/* Drawer admin "Más" */}
      <MoreSheetAdmin
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        perfil={perfil}
        initials={initials}
        onLogout={handleLogout}
      />
    </div>
  );
}
