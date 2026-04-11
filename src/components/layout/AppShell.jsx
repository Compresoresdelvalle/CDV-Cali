import { useState } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { ROLE_MODULES, MODULE_ROUTES } from "../../lib/constants";

/* ── Helpers ──────────────────────────────────────────────────────────── */
const getInitials = (name = "") =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const ROL_COLOR = {
  Admin: "#1d4ed8",
  Bodeguero: "#b45309",
  Vendedor: "#16a34a",
  Tecnico: "#7c3aed",
};

/* ── SVG Icon map ─────────────────────────────────────────────────────── */
const ICON_PATHS = {
  Inicio:
    "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  Inventario: "M20 7l-8-4-8 4m16 0-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  Ventas:
    "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z",
  Cotizaciones:
    "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  Compras:
    "M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4",
  Traspasos: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4",
  Órdenes:
    "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  Ensambles:
    "M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z",
  Herramientas:
    "M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z",
  Devoluciones: "M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6",
  Productos:
    "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z",
  "→ Panel Admin":
    "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
};

function NavIcon({ name, size = 16 }) {
  const d = ICON_PATHS[name] || "M12 6v6m0 0v6m0-6h6m-6 0H6";
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
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/* ── Simple inline icons ──────────────────────────────────────────────── */
function LogoutIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

/* ── Sidebar nav item ─────────────────────────────────────────────────── */
function SidebarItem({ name, label, to, iconsOnly, end: endProp = false }) {
  const isAdmin = name === "→ Panel Admin";
  return (
    <NavLink
      to={to}
      end={endProp}
      title={iconsOnly ? label || name : undefined}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg transition-all duration-150 cursor-pointer
        focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50
        ${iconsOnly ? "justify-center h-9 w-9 mx-auto" : "px-3 py-2"}
        ${
          isAdmin
            ? "text-amber-400 hover:bg-amber-400/10"
            : isActive
              ? "bg-white/10 text-white"
              : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
        }`
      }
    >
      <span className="flex-shrink-0">
        <NavIcon name={name} size={15} />
      </span>
      {!iconsOnly && (
        <span className="text-[13px] font-medium truncate">
          {label || name}
        </span>
      )}
    </NavLink>
  );
}

/* ── Section label ────────────────────────────────────────────────────── */
function SectionLabel({ children }) {
  return (
    <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider px-3 mt-5 mb-1.5 first:mt-2">
      {children}
    </p>
  );
}

/* ── AppShell ─────────────────────────────────────────────────────────── */
export default function AppShell() {
  const { perfil, logout } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);

  const rol = perfil?.rol ?? "";
  const modulos = ROLE_MODULES[rol] ?? [];
  const navMods = modulos.filter((m) => m !== "→ Panel Admin");
  const isAdmin = rol === "Admin";

  const avatarColor = ROL_COLOR[rol] || "#64748b";
  const initials = getInitials(perfil?.nombre || "");

  const handleLogout = async () => {
    await logout();
    window.location.href = "/login";
  };

  /* ── Sidebar shared content ─────────────────────────────────────────── */
  const SidebarContent = ({ iconsOnly = false }) => (
    <aside
      className="flex flex-col h-full select-none"
      style={{ backgroundColor: "#0f172a" }}
    >
      {/* Logo */}
      <div
        className={`flex-shrink-0 border-b border-white/5 ${iconsOnly ? "px-3 py-4 flex justify-center" : "px-4 py-4"}`}
      >
        {iconsOnly ? (
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-bold"
            style={{ backgroundColor: "#2563EB" }}
          >
            CV
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
              style={{ backgroundColor: "#2563EB" }}
            >
              CV
            </div>
            <div className="min-w-0">
              <p className="text-white text-[11px] font-bold leading-tight tracking-wide uppercase">
                Compresores
              </p>
              <p className="text-slate-500 text-[9px] leading-tight tracking-widest uppercase">
                Del Valle S.A.S.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav
        className={`flex-1 overflow-y-auto py-2 ${iconsOnly ? "px-2 space-y-1" : "px-2"}`}
      >
        {/* PRINCIPAL */}
        {!iconsOnly && <SectionLabel>Principal</SectionLabel>}
        <SidebarItem
          name="Inicio"
          label="Dashboard"
          to="/ops"
          end
          iconsOnly={iconsOnly}
        />

        {/* OPERACIONES */}
        {!iconsOnly && navMods.length > 0 && (
          <SectionLabel>Operaciones</SectionLabel>
        )}
        {navMods.map((mod) => (
          <SidebarItem
            key={mod}
            name={mod}
            to={MODULE_ROUTES[mod]}
            iconsOnly={iconsOnly}
          />
        ))}

        {/* ADMIN */}
        {isAdmin && (
          <>
            {!iconsOnly && <SectionLabel>Administración</SectionLabel>}
            <SidebarItem
              name="→ Panel Admin"
              label="Panel Admin"
              to="/admin"
              iconsOnly={iconsOnly}
            />
          </>
        )}
      </nav>

      {/* User card + logout */}
      <div className="flex-shrink-0 border-t border-white/5 p-3">
        {iconsOnly ? (
          <button
            onClick={handleLogout}
            title="Cerrar sesión"
            className="w-9 h-9 mx-auto flex items-center justify-center rounded-lg text-slate-500 hover:text-red-400 hover:bg-white/5 transition-all cursor-pointer"
          >
            <LogoutIcon />
          </button>
        ) : (
          <div>
            <div className="flex items-center gap-2.5 px-2 py-1.5 mb-0.5">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-semibold flex-shrink-0"
                style={{ backgroundColor: avatarColor }}
              >
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-slate-200 text-[12px] font-medium truncate leading-tight">
                  {perfil?.nombre}
                </p>
                <p className="text-slate-500 text-[10px] truncate leading-tight">
                  {rol}
                  {perfil?.sede_id ? ` · ${perfil.sede_id}` : ""}
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-white/5 text-[12px] transition-all cursor-pointer"
            >
              <LogoutIcon />
              <span>Cerrar sesión</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex flex-col w-56 xl:w-60 h-full flex-shrink-0">
        <SidebarContent iconsOnly={false} />
      </div>

      {/* Tablet sidebar (icons-only collapsible) */}
      <div
        className={`hidden sm:flex lg:hidden flex-col flex-shrink-0 h-full transition-all duration-200 ${collapsed ? "w-14" : "w-52"}`}
      >
        <SidebarContent iconsOnly={collapsed} />
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Topbar — tablet + desktop */}
        <header className="hidden sm:flex items-center gap-3 px-5 h-14 border-b border-slate-200 bg-white flex-shrink-0">
          {/* Collapse toggle (tablet) */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="lg:hidden p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
          >
            <MenuIcon />
          </button>

          {/* Search */}
          <div className="relative flex-1 max-w-lg">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <SearchIcon />
            </span>
            <input
              type="text"
              placeholder="Buscar productos, ventas, clientes..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-slate-100 border border-transparent rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-slate-200 transition-all"
            />
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2 ml-auto">
            <button className="relative p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer">
              <BellIcon />
            </button>

            <div className="flex items-center gap-2.5 ml-1">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0"
                style={{ backgroundColor: avatarColor }}
              >
                {initials}
              </div>
              <div className="hidden md:block">
                <p className="text-[13px] font-semibold text-slate-800 leading-tight">
                  {perfil?.nombre}
                </p>
                <p className="text-[11px] text-slate-500 leading-tight">
                  {rol}
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Mobile header */}
        <header className="sm:hidden flex items-center justify-between px-4 h-14 border-b border-slate-200 bg-white flex-shrink-0">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-bold"
              style={{ backgroundColor: "#2563EB" }}
            >
              CV
            </div>
            <span className="text-slate-800 font-semibold text-sm">
              CDV Gestión
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 text-xs">
              {perfil?.nombre?.split(" ")[0]}
            </span>
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
              style={{ backgroundColor: avatarColor }}
            >
              {initials}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto pb-20 sm:pb-0">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-30 flex-shrink-0">
        <div className="flex">
          {navMods.slice(0, 5).map((mod) => {
            const ruta = MODULE_ROUTES[mod];
            return (
              <NavLink
                key={mod}
                to={ruta}
                className={({ isActive }) =>
                  `flex-1 flex flex-col items-center justify-center py-2.5 gap-1 min-h-[56px]
                  text-[10px] font-medium transition-colors cursor-pointer
                  ${isActive ? "text-blue-600" : "text-slate-400"}`
                }
              >
                <span className="w-5 h-5 flex items-center justify-center">
                  <NavIcon name={mod} size={18} />
                </span>
                <span className="leading-tight truncate max-w-full px-0.5">
                  {mod}
                </span>
              </NavLink>
            );
          })}
          {isAdmin && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center py-2.5 gap-1 min-h-[56px]
                text-[10px] font-medium transition-colors cursor-pointer
                ${isActive ? "text-amber-500" : "text-slate-400"}`
              }
            >
              <span className="w-5 h-5 flex items-center justify-center">
                <NavIcon name="→ Panel Admin" size={18} />
              </span>
              <span>Admin</span>
            </NavLink>
          )}
        </div>
      </nav>
    </div>
  );
}
