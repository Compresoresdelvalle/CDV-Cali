import { useState, useEffect } from "react";
import {
  Outlet,
  Link,
  NavLink,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  Package,
  Tag,
  ShoppingCart,
  FileText,
  Receipt,
  Undo2,
  ShoppingBag,
  Truck,
  Shield,
  Wrench,
  Puzzle,
  Home,
  Bell,
  Menu,
  LogOut,
  Users,
  Calculator,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { ROLE_MODULES, MODULE_ROUTES } from "../../lib/constants";
import ThemeToggle from "../ui/ThemeToggle";
import GlobalSearch from "./GlobalSearch";
import Logo from "../ui/Logo";
import { supabase } from "../../lib/supabase";

/* ── Helpers ──────────────────────────────────────────────────────────── */
const getInitials = (name = "") =>
  name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** Icono lucide por módulo (claves = nombres de ROLE_MODULES). */
const MODULE_ICONS = {
  Inventario: Package,
  Productos: Tag,
  Ventas: ShoppingCart,
  Cotizaciones: FileText,
  Recibos: Receipt,
  Devoluciones: Undo2,
  Compras: ShoppingBag,
  Traspasos: Truck,
  Garantías: Shield,
  Órdenes: Wrench,
  Ensambles: Puzzle,
  Herramientas: Wrench,
  Clientes: Users,
  Cierre: Calculator,
};

/** Cada módulo se ubica en una sección del sidebar (estilo Lovable). */
const MODULE_SECTION = {
  Inventario: "Catálogo y stock",
  Productos: "Catálogo y stock",
  Ventas: "Operación comercial",
  Cotizaciones: "Operación comercial",
  Recibos: "Operación comercial",
  Clientes: "Operación comercial",
  Devoluciones: "Operación comercial",
  Compras: "Bodega y movimiento",
  Traspasos: "Bodega y movimiento",
  Garantías: "Bodega y movimiento",
  Órdenes: "Taller",
  Ensambles: "Taller",
  Herramientas: "Soporte",
  Cierre: "Soporte",
};

const SECTION_ORDER = [
  "Catálogo y stock",
  "Operación comercial",
  "Bodega y movimiento",
  "Taller",
  "Soporte",
];

/** Construye las secciones del sidebar a partir de los módulos del rol. */
function buildSections(modulos) {
  const sections = {};
  modulos
    .filter((m) => m !== "→ Panel Admin")
    .forEach((m) => {
      const section = MODULE_SECTION[m] ?? "Otros";
      if (!sections[section]) sections[section] = [];
      sections[section].push({
        id: m,
        label: m,
        href: MODULE_ROUTES[m],
        icon: MODULE_ICONS[m] ?? Package,
      });
    });
  return SECTION_ORDER.filter((s) => sections[s]).map((s) => ({
    label: s,
    modulos: sections[s],
  }));
}

/* ── Sidebar (desktop ≥ lg) ───────────────────────────────────────────── */
function SidebarItem({ href, label, iconNode }) {
  const location = useLocation();
  const active =
    location.pathname === href || location.pathname.startsWith(href + "/");

  return (
    <li>
      <Link
        to={href}
        data-active={active}
        className="group flex h-9 items-center gap-2.5 rounded-md px-3 text-[13px] text-white/70 transition-colors hover:bg-white/[0.04] hover:text-white data-[active=true]:bg-[--p-600]/15 data-[active=true]:text-white data-[active=true]:shadow-[inset_2px_0_0_var(--p-500)]"
      >
        {iconNode}
        <span className="truncate">{label}</span>
      </Link>
    </li>
  );
}

function SidebarOps({ sections, isAdmin }) {
  const location = useLocation();
  const inicioActive = location.pathname === "/ops";

  return (
    <aside className="chv-sidebar hidden lg:flex w-[240px] shrink-0 flex-col">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b border-white/[0.04] px-4">
        <Logo className="h-7 w-7" />
        <div className="leading-tight">
          <div className="text-[13px] font-semibold text-white/90">
            Compresores
          </div>
          <div className="text-[10.5px] uppercase tracking-[0.1em] text-white/40">
            del Valle
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {/* Inicio (Dashboard) */}
        <div className="mb-4">
          <div className="px-3 pb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-white/35">
            Principal
          </div>
          <ul className="space-y-0.5">
            <li>
              <Link
                to="/ops"
                data-active={inicioActive}
                className="group flex h-9 items-center gap-2.5 rounded-md px-3 text-[13px] text-white/70 transition-colors hover:bg-white/[0.04] hover:text-white data-[active=true]:bg-[--p-600]/15 data-[active=true]:text-white data-[active=true]:shadow-[inset_2px_0_0_var(--p-500)]"
              >
                <Home
                  className="h-[15px] w-[15px] shrink-0"
                  strokeWidth={1.75}
                />
                <span className="truncate">Inicio</span>
              </Link>
            </li>
          </ul>
        </div>

        {sections.map((section) => (
          <div key={section.label} className="mb-4">
            <div className="px-3 pb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-white/35">
              {section.label}
            </div>
            <ul className="space-y-0.5">
              {section.modulos.map((m) => (
                <SidebarItem
                  key={m.id}
                  href={m.href}
                  label={m.label}
                  iconNode={
                    <m.icon
                      className="h-[15px] w-[15px] shrink-0"
                      strokeWidth={1.75}
                    />
                  }
                />
              ))}
            </ul>
          </div>
        ))}

        {isAdmin && (
          <div className="mb-4">
            <div className="px-3 pb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-white/35">
              Control
            </div>
            <ul className="space-y-0.5">
              <li>
                <Link
                  to="/admin"
                  className="group flex h-9 items-center gap-2.5 rounded-md px-3 text-[13px] text-amber-400 transition-colors hover:bg-amber-400/10 hover:text-amber-300"
                >
                  <Shield
                    className="h-[15px] w-[15px] shrink-0"
                    strokeWidth={1.75}
                  />
                  <span className="truncate">Panel Admin</span>
                </Link>
              </li>
            </ul>
          </div>
        )}
      </nav>

      <div className="border-t border-white/[0.04] px-4 py-3 text-[10.5px] text-white/35">
        Sistema v1.0 · mayo 2026
      </div>
    </aside>
  );
}

/* ── Topbar (brand color) ─────────────────────────────────────────────── */
function HeaderOps({ perfil, rol, initials, alertCount, onLogout, onSearch }) {
  return (
    <header className="chv-topbar sticky top-0 z-30 hidden lg:flex h-14 items-center gap-3 px-4">
      {/* #33 — Buscador global funcional (dropdown de resultados en vivo) */}
      <GlobalSearch />

      <div className="flex-1" />

      {/* Sede activa del usuario */}
      {perfil?.sede_id && (
        <div className="hidden md:inline-flex h-8 items-center gap-2 rounded-md border border-white/15 bg-white/10 px-2.5 text-[12px]">
          <span className="h-1.5 w-1.5 rounded-full bg-[--succ-500]" />
          <span className="font-mono text-white">{perfil.sede_id}</span>
        </div>
      )}

      <ThemeToggle />

      {/* Alertas de stock → inventario */}
      <button
        onClick={onSearch}
        className="focus-ring relative grid h-9 w-9 place-items-center rounded-md text-white/85 hover:bg-white/10"
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
        <Bell className="h-4 w-4" strokeWidth={1.75} />
        {alertCount > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[--dang-500] px-1 text-[9px] font-bold leading-none text-white">
            {alertCount > 99 ? "99+" : alertCount}
          </span>
        )}
      </button>

      {/* Usuario + logout */}
      <div className="ml-1 flex h-8 items-center gap-2 pl-2">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-white/15 ring-1 ring-white/25 font-mono text-[11px] font-semibold text-white">
          {initials}
        </div>
        <div className="hidden text-left leading-tight sm:block">
          <div className="text-[12px] font-medium text-white">
            {perfil?.nombre}
          </div>
          <div className="text-[10.5px] text-white/70">{rol}</div>
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
function MobileHeader({ perfil, initials, onLogout }) {
  return (
    <header className="chv-topbar sticky top-0 z-30 flex lg:hidden h-14 items-center justify-between px-4">
      <div className="flex items-center gap-2.5">
        <Logo className="h-7 w-7" />
        <span className="text-[14px] font-semibold text-white">
          CDV Gestión
        </span>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <span className="text-[12px] text-white/85">
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

/* ── Bottom nav (móvil/tablet < lg) ───────────────────────────────────── */
function BottomNav({ items }) {
  return (
    <nav className="chv-bottomnav lg:hidden sticky bottom-0 z-30 grid grid-cols-5">
      {items.map((it) => {
        const { icon: Icon, fab } = it;
        if (fab) {
          return (
            <NavLink
              key={it.href + it.label}
              to={it.href}
              className="relative flex items-center justify-center"
            >
              {({ isActive }) => (
                <>
                  <span
                    className="absolute -top-5 grid h-12 w-12 place-items-center rounded-full bg-white ring-2 ring-white/30 shadow-[var(--shadow-elevation)]"
                    style={{ color: "var(--p-700)" }}
                  >
                    <Icon className="h-5 w-5" strokeWidth={2} />
                  </span>
                  <span
                    className={`mt-7 text-[10px] font-medium ${
                      isActive ? "text-white" : "text-white/75"
                    }`}
                  >
                    {it.label}
                  </span>
                </>
              )}
            </NavLink>
          );
        }
        return (
          <NavLink
            key={it.href + it.label}
            to={it.href}
            end={it.end}
            className="flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] min-h-[56px]"
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={`h-[18px] w-[18px] ${isActive ? "text-white" : "text-white/70"}`}
                  strokeWidth={isActive ? 2 : 1.75}
                />
                <span
                  className={
                    isActive ? "font-medium text-white" : "text-white/70"
                  }
                >
                  {it.label}
                </span>
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

/** Arma los 5 ítems del bottom-nav según el rol (con FAB central). */
function buildBottomNav(modulos) {
  const has = (m) => modulos.includes(m);

  const inicio = { label: "Inicio", href: "/ops", icon: Home, end: true };

  // FAB central: el módulo "primario" según rol (Ventas si vende, si no Inventario).
  const fabItem = has("Ventas")
    ? {
        label: "Vender",
        href: MODULE_ROUTES.Ventas,
        icon: ShoppingCart,
        fab: true,
      }
    : has("Órdenes")
      ? { label: "Orden", href: MODULE_ROUTES.Órdenes, icon: Wrench, fab: true }
      : {
          label: "Inventario",
          href: MODULE_ROUTES.Inventario,
          icon: Package,
          fab: true,
        };

  const candidates = [
    has("Inventario") && {
      label: "Inventario",
      href: MODULE_ROUTES.Inventario,
      icon: Package,
    },
    has("Compras") && {
      label: "Compras",
      href: MODULE_ROUTES.Compras,
      icon: ShoppingBag,
    },
    has("Traspasos") && {
      label: "Traspasos",
      href: MODULE_ROUTES.Traspasos,
      icon: Truck,
    },
    has("Órdenes") && {
      label: "Órdenes",
      href: MODULE_ROUTES.Órdenes,
      icon: Wrench,
    },
    has("Herramientas") && {
      label: "Más",
      href: MODULE_ROUTES.Herramientas,
      icon: Menu,
    },
  ].filter(Boolean);

  // Estructura: [izq1, izq2, FAB, der1, der2] → 5 columnas
  const left = candidates.slice(0, 2);
  const right = candidates.slice(2, 4);
  const items = [inicio, ...left, fabItem, ...right].slice(0, 5);

  // Garantizar exactamente 5 columnas (rellenar con el FAB-equivalente si falta).
  return items;
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

      if (perfil.rol !== "Admin" && perfil.sede_id) {
        q = q.eq("sede_id", perfil.sede_id);
      }

      const { count: c } = await q;
      setCount(c ?? 0);
    };

    fetchCount();

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

  const alertCount = useAlertasCount(perfil);

  const rol = perfil?.rol ?? "";
  const modulos = ROLE_MODULES[rol] ?? [];
  const isAdmin = modulos.includes("→ Panel Admin");
  const initials = getInitials(perfil?.nombre || "");

  const sections = buildSections(modulos);
  const bottomItems = buildBottomNav(modulos);

  const handleLogout = async () => {
    await logout();
    window.location.assign("/login");
  };

  const goToInventario = () => navigate("/ops/inventario");

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ backgroundColor: "var(--n-50)" }}
    >
      {/* Sidebar fija oscura (desktop) */}
      <SidebarOps sections={sections} isAdmin={isAdmin} />

      {/* Área principal */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Topbar desktop */}
        <HeaderOps
          perfil={perfil}
          rol={rol}
          initials={initials}
          alertCount={alertCount}
          onLogout={handleLogout}
          onSearch={goToInventario}
        />

        {/* Header móvil/tablet */}
        <MobileHeader
          perfil={perfil}
          initials={initials}
          onLogout={handleLogout}
        />

        {/* Contenido de página */}
        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
          <Outlet />
        </main>

        {/* Bottom nav móvil/tablet */}
        <BottomNav items={bottomItems} />
      </div>
    </div>
  );
}
