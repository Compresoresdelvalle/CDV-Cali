import { Outlet, Link, NavLink, useLocation } from "react-router-dom";
import { ArrowLeftCircle, Bell, LogOut } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import ThemeToggle from "../ui/ThemeToggle";
import Logo from "../ui/Logo";
import {
  SECCIONES_ADMIN,
  MODULOS_ADMIN,
  getInitials,
} from "../../lib/admin-shell-ui";

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

/* ── Header móvil/tablet (< lg) ───────────────────────────────────────── */
function MobileHeaderAdmin({ perfil, initials, onLogout }) {
  return (
    <header className="chv-topbar chv-topbar-admin sticky top-0 z-30 flex lg:hidden h-14 items-center justify-between px-4">
      <div className="flex items-center gap-2.5">
        <Logo className="h-7 w-7" />
        <span className="font-mono text-[12px] font-semibold uppercase tracking-[0.1em] text-white">
          Panel Admin
        </span>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Link
          to="/ops"
          className="focus-ring grid h-9 w-9 place-items-center rounded-md text-white/85 hover:bg-white/10"
          aria-label="Volver a Operaciones"
          title="Volver a Operaciones"
        >
          <ArrowLeftCircle className="h-4 w-4" strokeWidth={1.75} />
        </Link>
        <span className="hidden sm:inline text-[12px] text-white/85">
          {perfil?.nombre?.split(" ")[0]}
        </span>
        <div className="grid h-7 w-7 place-items-center rounded-full bg-white/15 ring-1 ring-white/25 font-mono text-[10px] font-semibold text-white">
          {initials}
        </div>
        <button
          onClick={onLogout}
          className="focus-ring grid h-9 w-9 place-items-center rounded-md text-white/85 hover:bg-white/10"
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}

/* ── Bottom nav admin (móvil/tablet < lg) ─────────────────────────────── */
function BottomNavAdmin() {
  const items = MODULOS_ADMIN.slice(0, 5);
  return (
    <nav className="chv-bottomnav lg:hidden sticky bottom-0 z-30 flex">
      {items.map((it) => {
        const { icon: Icon } = it;
        return (
          <NavLink
            key={it.id}
            to={it.href}
            end={it.href === "/admin"}
            className="flex flex-1 min-w-[60px] flex-col items-center justify-center gap-0.5 py-2 text-[10px] min-h-[56px]"
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={`h-[18px] w-[18px] ${isActive ? "text-white" : "text-white/70"}`}
                  strokeWidth={isActive ? 2 : 1.75}
                />
                <span
                  className={`leading-tight text-center ${
                    isActive ? "font-medium text-white" : "text-white/70"
                  }`}
                >
                  {it.label.replace("Análisis ", "")}
                </span>
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

/* ── AdminShell ───────────────────────────────────────────────────────── */
export default function AdminShell() {
  const { perfil, logout } = useAuthStore();
  const initials = getInitials(perfil?.nombre || "");

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
          perfil={perfil}
          initials={initials}
          onLogout={handleLogout}
        />

        {/* Página */}
        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
          <Outlet />
        </main>

        {/* Bottom nav móvil/tablet */}
        <BottomNavAdmin />
      </div>
    </div>
  );
}
