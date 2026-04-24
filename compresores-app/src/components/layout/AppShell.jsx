import { useState, useEffect } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { ROLE_MODULES, MODULE_ROUTES } from "../../lib/constants";
import { supabase } from "../../lib/supabase";

/* ── Helpers ──────────────────────────────────────────────────────────── */
const getInitials = (name = "") =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** Map each module to a nav group */
const MODULE_GROUP = {
  Inicio: "Principal",
  Inventario: "Operaciones",
  Ventas: "Operaciones",
  Cotizaciones: "Operaciones",
  Compras: "Operaciones",
  Devoluciones: "Operaciones",
  Traspasos: "Logística",
  Ensambles: "Servicio",
  Órdenes: "Servicio",
  Herramientas: "Servicio",
  Productos: "Servicio",
  "→ Panel Admin": "Control",
};

const GROUP_ORDER = [
  "Principal",
  "Operaciones",
  "Logística",
  "Servicio",
  "Control",
];

/** Build grouped nav from role modules list */
function buildGroupedNav(modulos) {
  const allItems = [
    { name: "Inicio", label: "Dashboard", to: "/ops", end: true },
    ...modulos
      .filter((m) => m !== "→ Panel Admin")
      .map((m) => ({ name: m, label: m, to: MODULE_ROUTES[m], end: false })),
    ...(modulos.includes("→ Panel Admin")
      ? [
          {
            name: "→ Panel Admin",
            label: "Panel Admin",
            to: "/admin",
            end: false,
          },
        ]
      : []),
  ];

  const groups = {};
  allItems.forEach((item) => {
    const g = MODULE_GROUP[item.name] ?? "Otros";
    if (!groups[g]) groups[g] = [];
    groups[g].push(item);
  });
  return groups;
}

/* ── SVG Icons ────────────────────────────────────────────────────────── */
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

function LogoutIcon() {
  return (
    <svg
      width="14"
      height="14"
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
      width="18"
      height="18"
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
      width="17"
      height="17"
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

/* ── Nav group label ──────────────────────────────────────────────────── */
function GroupLabel({ children }) {
  return (
    <p
      className="text-[10px] uppercase tracking-widest px-3 mt-4 mb-1 first:mt-2"
      style={{ color: "hsl(var(--sidebar-foreground) / 0.4)" }}
    >
      {children}
    </p>
  );
}

/* ── Sidebar nav item ─────────────────────────────────────────────────── */
function SidebarNavItem({ name, label, to, iconsOnly, end: endProp = false }) {
  const location = useLocation();
  const isAdmin = name === "→ Panel Admin";
  const isActive = endProp
    ? location.pathname === to
    : location.pathname.startsWith(to);

  return (
    <NavLink
      to={to}
      end={endProp}
      title={iconsOnly ? label || name : undefined}
      className={() =>
        [
          "flex items-center gap-3 rounded-md text-sm transition-colors duration-150",
          "focus:outline-none focus-visible:ring-1",
          iconsOnly ? "justify-center h-9 w-9 mx-auto" : "px-3 py-2",
          isAdmin && !isActive
            ? "text-amber-400 hover:bg-amber-400/10"
            : isActive
              ? "font-medium"
              : "",
        ].join(" ")
      }
      style={({ isActive: navActive }) => {
        if (isAdmin && !navActive) return { color: "rgb(251 191 36)" };
        if (navActive)
          return {
            backgroundColor: "hsl(var(--sidebar-accent))",
            color: "hsl(var(--sidebar-accent-foreground))",
          };
        return {
          color: "hsl(var(--sidebar-foreground))",
        };
      }}
      onMouseEnter={(e) => {
        if (!isActive)
          e.currentTarget.style.backgroundColor =
            "hsl(var(--sidebar-accent) / 0.5)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = "";
      }}
    >
      <span className="shrink-0">
        <NavIcon name={name} size={15} />
      </span>
      {!iconsOnly && <span className="truncate">{label || name}</span>}
    </NavLink>
  );
}

/* ── Sidebar component ────────────────────────────────────────────────── */
function Sidebar({
  collapsed,
  onToggle,
  modulos,
  perfil,
  rol,
  initials,
  onLogout,
}) {
  const grouped = buildGroupedNav(modulos);

  return (
    <aside
      className="flex flex-col h-full select-none border-r"
      style={{
        backgroundColor: "hsl(var(--sidebar-background))",
        borderColor: "hsl(var(--sidebar-border))",
      }}
    >
      {/* Header / Logo */}
      <div
        className={`flex-shrink-0 border-b p-4 ${collapsed ? "flex justify-center" : ""}`}
        style={{ borderColor: "hsl(var(--sidebar-border))" }}
      >
        {collapsed ? (
          <span
            className="text-lg font-bold"
            style={{ color: "hsl(var(--sidebar-primary))" }}
          >
            CV
          </span>
        ) : (
          <div className="space-y-0.5">
            <h2
              className="text-sm font-bold tracking-wide"
              style={{ color: "hsl(var(--sidebar-accent-foreground))" }}
            >
              COMPRESORES
            </h2>
            <p
              className="text-[10px] tracking-widest uppercase"
              style={{ color: "hsl(var(--sidebar-foreground) / 0.6)" }}
            >
              del Valle S.A.S.
            </p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav
        className={`flex-1 overflow-y-auto py-2 ${collapsed ? "px-2 space-y-1" : "px-2"}`}
      >
        {GROUP_ORDER.filter((g) => grouped[g]).map((groupName) => (
          <div key={groupName}>
            {!collapsed && <GroupLabel>{groupName}</GroupLabel>}
            <div className={`space-y-0.5 ${collapsed ? "" : "mb-1"}`}>
              {grouped[groupName].map((item) => (
                <SidebarNavItem
                  key={item.to}
                  name={item.name}
                  label={item.label}
                  to={item.to}
                  end={item.end}
                  iconsOnly={collapsed}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div
        className="flex-shrink-0 border-t p-3"
        style={{ borderColor: "hsl(var(--sidebar-border))" }}
      >
        {collapsed ? (
          <button
            onClick={onLogout}
            title="Cerrar sesión"
            className="w-9 h-9 mx-auto flex items-center justify-center rounded-lg transition-colors cursor-pointer"
            style={{ color: "hsl(var(--sidebar-foreground) / 0.6)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.color = "hsl(var(--destructive))")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.color =
                "hsl(var(--sidebar-foreground) / 0.6)")
            }
          >
            <LogoutIcon />
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{
                  backgroundColor: "hsl(var(--sidebar-primary) / 0.2)",
                  color: "hsl(var(--sidebar-primary))",
                }}
              >
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="text-xs font-medium truncate"
                  style={{ color: "hsl(var(--sidebar-accent-foreground))" }}
                >
                  {perfil?.nombre}
                </p>
                <p
                  className="text-[10px] truncate"
                  style={{ color: "hsl(var(--sidebar-foreground) / 0.6)" }}
                >
                  {rol}
                  {perfil?.sede_id ? ` · ${perfil.sede_id}` : ""}
                </p>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="flex items-center gap-2 text-xs w-full px-1 transition-colors cursor-pointer"
              style={{ color: "hsl(var(--sidebar-foreground) / 0.6)" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = "hsl(var(--destructive))")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color =
                  "hsl(var(--sidebar-foreground) / 0.6)")
              }
            >
              <LogoutIcon />
              <span>Cerrar sesión</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

/* ── Hook: conteo de alertas de stock ────────────────────────────────── */
function useAlertasCount(perfil) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!perfil?.id) return;

    const fetchCount = async () => {
      let q = supabase
        .from("inventario")
        .select("id", { count: "exact", head: true })
        .in("estado_stock", ["Bajo", "Agotado"]);

      // No-Admin: filtrar solo su sede
      if (perfil.rol !== "Admin" && perfil.sede_id) {
        q = q.eq("sede_id", perfil.sede_id);
      }

      const { count: c } = await q;
      setCount(c ?? 0);
    };

    fetchCount();

    // Actualizar en tiempo real cuando cambia el inventario
    const channel = supabase
      .channel("alertas-stock-count")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventario" },
        fetchCount,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [perfil?.id, perfil?.rol, perfil?.sede_id]);

  return count;
}

/* ── AppShell ─────────────────────────────────────────────────────────── */
export default function AppShell() {
  const { perfil, logout } = useAuthStore();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const alertCount = useAlertasCount(perfil);

  const rol = perfil?.rol ?? "";
  const modulos = ROLE_MODULES[rol] ?? [];
  const navMods = modulos.filter((m) => m !== "→ Panel Admin");
  const initials = getInitials(perfil?.nombre || "");

  const handleLogout = async () => {
    await logout();
    window.location.href = "/login";
  };

  const sidebarProps = {
    collapsed,
    onToggle: () => setCollapsed((c) => !c),
    modulos,
    perfil,
    rol,
    initials,
    onLogout: handleLogout,
  };

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      {/* Desktop sidebar — always expanded */}
      <div className="hidden lg:flex flex-col w-56 xl:w-60 h-full shrink-0">
        <Sidebar {...sidebarProps} collapsed={false} />
      </div>

      {/* Tablet sidebar — collapsible */}
      <div
        className={`hidden sm:flex lg:hidden flex-col shrink-0 h-full transition-all duration-200 ${
          collapsed ? "w-14" : "w-52"
        }`}
      >
        <Sidebar {...sidebarProps} />
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Topbar */}
        <header
          className="hidden sm:flex items-center gap-3 px-4 h-14 border-b shrink-0 sticky top-0 z-30"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          {/* Tablet collapse toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="lg:hidden p-2 rounded-lg transition-colors cursor-pointer"
            style={{ color: "hsl(var(--muted-foreground))" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "hsl(var(--muted))";
              e.currentTarget.style.color = "hsl(var(--foreground))";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "";
              e.currentTarget.style.color = "hsl(var(--muted-foreground))";
            }}
            aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
          >
            <MenuIcon />
          </button>

          {/* Search */}
          <div className="flex-1 max-w-md">
            <div className="relative">
              <span
                className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                <SearchIcon />
              </span>
              <input
                type="text"
                placeholder="Buscar productos, ventas, clientes..."
                className="w-full pl-9 pr-4 h-9 text-sm rounded-md border-0 focus:outline-none focus:ring-1 transition-all"
                style={{
                  backgroundColor: "hsl(var(--muted) / 0.5)",
                  color: "hsl(var(--foreground))",
                }}
              />
            </div>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => navigate("/ops/inventario")}
              className="relative p-2 rounded-lg transition-colors cursor-pointer"
              style={{ color: "hsl(var(--muted-foreground))" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "hsl(var(--muted))";
                e.currentTarget.style.color = "hsl(var(--foreground))";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "";
                e.currentTarget.style.color = "hsl(var(--muted-foreground))";
              }}
              aria-label={
                alertCount > 0
                  ? `${alertCount} alertas de stock`
                  : "Sin alertas de stock"
              }
              title={
                alertCount > 0
                  ? `${alertCount} producto${alertCount !== 1 ? "s" : ""} con stock bajo o agotado`
                  : "Sin alertas de stock"
              }
            >
              <BellIcon />
              {alertCount > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-0.5 text-[10px] font-bold rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor: "hsl(var(--destructive))",
                    color: "hsl(var(--destructive-foreground))",
                  }}
                >
                  {alertCount > 99 ? "99+" : alertCount}
                </span>
              )}
            </button>

            <div
              className="hidden sm:flex items-center gap-2 pl-3 border-l"
              style={{ borderColor: "hsl(var(--border))" }}
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                style={{
                  backgroundColor: "hsl(var(--primary) / 0.1)",
                  color: "hsl(var(--primary))",
                }}
              >
                {initials}
              </div>
              <div className="hidden md:block text-xs">
                <p
                  className="font-medium leading-tight"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {perfil?.nombre}
                </p>
                <p
                  className="leading-tight"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {rol}
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Mobile header */}
        <header
          className="sm:hidden flex items-center justify-between px-4 h-14 border-b shrink-0"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold"
              style={{
                backgroundColor: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
              }}
            >
              CV
            </div>
            <span
              className="font-semibold text-sm"
              style={{ color: "hsl(var(--foreground))" }}
            >
              CDV Gestión
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {perfil?.nombre?.split(" ")[0]}
            </span>
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{
                backgroundColor: "hsl(var(--primary) / 0.1)",
                color: "hsl(var(--primary))",
              }}
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
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 z-30 flex shrink-0 border-t"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div className="flex w-full">
          {navMods.slice(0, 5).map((mod) => (
            <NavLink
              key={mod}
              to={MODULE_ROUTES[mod]}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center py-2.5 gap-1 min-h-[56px]
                text-[10px] font-medium transition-colors cursor-pointer ${
                  isActive ? "text-primary" : ""
                }`
              }
              style={({ isActive }) => ({
                color: isActive
                  ? "hsl(var(--primary))"
                  : "hsl(var(--muted-foreground))",
              })}
            >
              <span className="w-5 h-5 flex items-center justify-center">
                <NavIcon name={mod} size={18} />
              </span>
              <span className="leading-tight truncate max-w-full px-0.5">
                {mod}
              </span>
            </NavLink>
          ))}
          {modulos.includes("→ Panel Admin") && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center py-2.5 gap-1 min-h-[56px]
                text-[10px] font-medium transition-colors cursor-pointer`
              }
              style={({ isActive }) => ({
                color: isActive
                  ? "rgb(251 191 36)"
                  : "hsl(var(--muted-foreground))",
              })}
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
