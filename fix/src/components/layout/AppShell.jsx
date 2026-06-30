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
  X,
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

/* ── Header móvil/tablet (< lg) ───────────────────────────────────────────
 * FIX: ahora expone sede activa, alertas de stock (campana con contador) y un
 * botón de avatar que abre el menú completo (drawer "Más"). El logout se mueve
 * al drawer para no saturar la barra superior.
 * ──────────────────────────────────────────────────────────────────────── */
function MobileHeader({ perfil, initials, alertCount, onBell, onMenu }) {
  return (
    <header
      className="chv-topbar sticky top-0 z-30 flex lg:hidden h-14 items-center justify-between px-4"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        height: "calc(3.5rem + env(safe-area-inset-top))",
      }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Logo className="h-7 w-7" />
        <span className="truncate text-[14px] font-semibold text-white">
          CDV Gestión
        </span>
        {perfil?.sede_id && (
          <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-white/15 bg-white/10 px-2 font-mono text-[11px] text-white">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: "var(--succ-500)" }}
            />
            {perfil.sede_id}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <ThemeToggle />
        <button
          onClick={onBell}
          className="focus-ring relative grid h-9 w-9 place-items-center rounded-md text-white/85 hover:bg-white/10"
          aria-label={
            alertCount > 0
              ? `${alertCount} alertas de stock`
              : "Sin alertas de stock"
          }
        >
          <Bell className="h-4 w-4" strokeWidth={1.75} />
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
          className="focus-ring grid h-9 w-9 place-items-center rounded-full bg-white/15 font-mono text-[10px] font-semibold text-white ring-1 ring-white/25"
          aria-label="Abrir menú"
        >
          {initials}
        </button>
      </div>
    </header>
  );
}

/* ── Drawer "Más" (móvil/tablet < lg) ─────────────────────────────────────
 * Hoja inferior con acceso a TODOS los módulos del rol + Panel Admin +
 * búsqueda global. Es lo que cierra el agujero principal: la barra inferior
 * de 5 botones ya no es la única vía de navegación.
 * ──────────────────────────────────────────────────────────────────────── */
function SheetLink({ to, end, icon: Icon, label, onClose, accent }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClose}
      className="flex min-h-[48px] items-center gap-2.5 rounded-lg px-3 text-[14px] font-medium transition-colors"
      style={({ isActive }) => ({
        backgroundColor: isActive ? "var(--p-50)" : "var(--n-50)",
        color: accent
          ? "var(--warn-700)"
          : isActive
            ? "var(--p-700)"
            : "var(--n-800)",
      })}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

function MoreSheet({
  open,
  onClose,
  sections,
  isAdmin,
  perfil,
  rol,
  initials,
  onLogout,
}) {
  if (!open) return null;
  return (
    <div
      className="lg:hidden fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
        aria-hidden="true"
      />
      <div
        className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col overflow-hidden rounded-t-2xl"
        style={{ backgroundColor: "var(--n-0)" }}
      >
        {/* Header del drawer */}
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--n-150)" }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-mono text-[12px] font-semibold text-white"
              style={{ backgroundColor: "var(--p-600)" }}
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
              <div className="text-[11px]" style={{ color: "var(--n-500)" }}>
                {rol}
                {perfil?.sede_id ? ` · ${perfil.sede_id}` : ""}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar menú"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md"
            style={{ color: "var(--n-500)" }}
          >
            <X className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>

        {/* Búsqueda global (ahora también en móvil) */}
        <div className="px-4 pt-3">
          <GlobalSearch />
        </div>

        {/* Módulos */}
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <SheetLink
            to="/ops"
            end
            icon={Home}
            label="Inicio"
            onClose={onClose}
          />

          {sections.map((section) => (
            <div key={section.label} className="mt-3">
              <div
                className="px-2 pb-1.5 font-mono text-[10px] uppercase tracking-[0.1em]"
                style={{ color: "var(--n-300)" }}
              >
                {section.label}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {section.modulos.map((m) => (
                  <SheetLink
                    key={m.id}
                    to={m.href}
                    icon={m.icon}
                    label={m.label}
                    onClose={onClose}
                  />
                ))}
              </div>
            </div>
          ))}

          {isAdmin && (
            <div className="mt-3">
              <div
                className="px-2 pb-1.5 font-mono text-[10px] uppercase tracking-[0.1em]"
                style={{ color: "var(--n-300)" }}
              >
                Control
              </div>
              <SheetLink
                to="/admin"
                icon={Shield}
                label="Panel Admin"
                onClose={onClose}
                accent
              />
            </div>
          )}

          <button
            onClick={onLogout}
            className="mt-4 flex min-h-[48px] w-full items-center gap-2.5 rounded-lg px-3 text-[14px] font-medium"
            style={{ color: "var(--dang-600)" }}
          >
            <LogOut className="h-[18px] w-[18px]" strokeWidth={1.75} />
            Cerrar sesión
          </button>
        </nav>
      </div>
    </div>
  );
}

/* ── Bottom nav (móvil/tablet < lg) ───────────────────────────────────────
 * FIX: el FAB ya NO sobresale (antes `-top-5` flotaba sobre la barra y tapaba
 * contenido). Ahora la acción primaria va al ras, resaltada con un chip claro
 * dentro de la propia barra. Se respeta la safe-area inferior de iOS con
 * `pb-[env(safe-area-inset-bottom)]`.
 * ──────────────────────────────────────────────────────────────────────── */
function BottomNav({ items, onMore }) {
  return (
    <nav
      className="chv-bottomnav lg:hidden sticky bottom-0 z-30 grid grid-cols-5"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {items.map((it) => {
        if (it.spacer) return <span key={it.id} aria-hidden="true" />;

        const { icon: Icon } = it;

        if (it.fab) {
          return (
            <NavLink
              key={it.id}
              to={it.href}
              className="flex min-h-[56px] flex-col items-center justify-center gap-1 py-2 text-[10px]"
            >
              {({ isActive }) => (
                <>
                  <span
                    className="grid h-7 w-12 place-items-center rounded-[10px] bg-white"
                    style={{ color: "var(--p-700)" }}
                  >
                    <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                  </span>
                  <span
                    className={`text-[10px] font-medium ${
                      isActive ? "text-white" : "text-white/85"
                    }`}
                  >
                    {it.label}
                  </span>
                </>
              )}
            </NavLink>
          );
        }

        if (it.more) {
          return (
            <button
              key={it.id}
              onClick={onMore}
              className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-2 text-[10px] text-white/70"
              aria-label="Más opciones"
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
              <span>{it.label}</span>
            </button>
          );
        }

        return (
          <NavLink
            key={it.id}
            to={it.href}
            end={it.end}
            className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-2 text-[10px]"
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

/** Arma exactamente 5 columnas: [Inicio, dest1, FAB(centro), dest2, Más].
 *
 * FIX vs versión anterior:
 *  - El FAB queda SIEMPRE en el centro (índice 2), no descentrado.
 *  - El módulo del FAB se excluye de los destinos → sin enlaces duplicados.
 *  - El 5º botón es "Más", que abre el drawer con TODOS los módulos (antes
 *    "Más" enlazaba a Herramientas y además se cortaba con slice(0,5)).
 *  - Claves únicas por `id` (antes href+label colisionaba).
 *  - Relleno con spacers si el rol tuviera <2 destinos, para no descuadrar la
 *    rejilla ni el FAB.
 */
function buildBottomNav(modulos) {
  const has = (m) => modulos.includes(m);

  const inicio = {
    id: "inicio",
    label: "Inicio",
    href: "/ops",
    icon: Home,
    end: true,
  };

  // Acción primaria del rol (FAB central).
  const fabModule = has("Ventas")
    ? "Ventas"
    : has("Órdenes")
      ? "Órdenes"
      : "Inventario";
  const FAB_LABEL = {
    Ventas: "Vender",
    Órdenes: "Orden",
    Inventario: "Inventario",
  };
  const fabItem = {
    id: "fab",
    label: FAB_LABEL[fabModule],
    href: MODULE_ROUTES[fabModule],
    icon: MODULE_ICONS[fabModule] ?? Package,
    fab: true,
  };

  // Dos destinos secundarios por prioridad, sin repetir el del FAB.
  const PRIORIDAD = [
    "Inventario",
    "Órdenes",
    "Ventas",
    "Compras",
    "Traspasos",
    "Cotizaciones",
    "Ensambles",
    "Herramientas",
  ];
  const dests = PRIORIDAD.filter((m) => m !== fabModule && has(m))
    .slice(0, 2)
    .map((m) => ({
      id: m,
      label: m,
      href: MODULE_ROUTES[m],
      icon: MODULE_ICONS[m] ?? Package,
    }));

  const masItem = { id: "mas", label: "Más", icon: Menu, more: true };

  const items = [inicio, dests[0], fabItem, dests[1], masItem].filter(Boolean);

  // Garantizar 5 columnas con el FAB centrado (insertar spacers antes del FAB).
  let guard = 0;
  while (items.length < 5 && guard++ < 4) {
    items.splice(3, 0, { id: `sp${items.length}`, spacer: true });
  }
  return items.slice(0, 5);
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
  const location = useLocation();

  const alertCount = useAlertasCount(perfil);
  const [moreOpen, setMoreOpen] = useState(false);

  const rol = perfil?.rol ?? "";
  const modulos = ROLE_MODULES[rol] ?? [];
  const isAdmin = modulos.includes("→ Panel Admin");
  const initials = getInitials(perfil?.nombre || "");

  const sections = buildSections(modulos);
  const bottomItems = buildBottomNav(modulos);

  // Cerrar el drawer al cambiar de ruta y bloquear el scroll de fondo.
  useEffect(() => {
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
          alertCount={alertCount}
          onBell={goToInventario}
          onMenu={() => setMoreOpen(true)}
        />

        {/* Contenido de página */}
        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
          <Outlet />
        </main>

        {/* Bottom nav móvil/tablet */}
        <BottomNav items={bottomItems} onMore={() => setMoreOpen(true)} />
      </div>

      {/* Drawer "Más" — acceso completo en móvil/tablet */}
      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        sections={sections}
        isAdmin={isAdmin}
        perfil={perfil}
        rol={rol}
        initials={initials}
        onLogout={handleLogout}
      />
    </div>
  );
}
