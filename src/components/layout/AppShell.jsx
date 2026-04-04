import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { ROLE_MODULES, MODULE_ICONS, MODULE_ROUTES } from '../../lib/constants'

/* ─── SVG Icons ─────────────────────────────────────────────────────────── */
function LogoutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M6.75 15.75H3.75A1.5 1.5 0 0 1 2.25 14.25V3.75A1.5 1.5 0 0 1 3.75 2.25h3M12 12.75 15.75 9 12 5.25M15.75 9H6.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  )
}

function AdminIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2.25" y="2.25" width="5.25" height="5.25" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10.5" y="2.25" width="5.25" height="5.25" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2.25" y="10.5" width="5.25" height="5.25" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10.5" y="10.5" width="5.25" height="5.25" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M3 6h16M3 11h16M3 16h16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

function ChevronIcon({ open }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"
      className={`transition-transform duration-200 ${open ? '' : 'rotate-180'}`}
    >
      <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ─── Emoji → SVG fallback (para módulos usamos emojis solo en tablet/móvil como texto) ── */
/* Por UX industrial mantenemos los emojis en nav items, son aceptables como iconos funcionales */

/* ─── NavItem para sidebar ───────────────────────────────────────────────── */
function SidebarItem({ modulo, iconsOnly }) {
  const ruta   = MODULE_ROUTES[modulo]
  const icon   = MODULE_ICONS[modulo]
  const isAdmin = modulo === '→ Panel Admin'

  return (
    <NavLink
      to={ruta}
      end={ruta === '/ops/inventario'}
      title={iconsOnly ? modulo : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl transition-all duration-150 cursor-pointer
        focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50
        ${iconsOnly ? 'justify-center h-11 w-11 mx-auto' : 'px-3 py-3'}
        ${isAdmin
          ? 'border border-accent/30 text-accent hover:bg-accent/10'
          : isActive
          ? 'bg-white/20 text-white'
          : 'text-white/65 hover:bg-white/10 hover:text-white'
        }`
      }
    >
      <span className="text-lg leading-none flex-shrink-0">{icon}</span>
      {!iconsOnly && (
        <span className="text-sm font-medium truncate">{modulo}</span>
      )}
    </NavLink>
  )
}

/* ─── AppShell ───────────────────────────────────────────────────────────── */
export default function AppShell() {
  const { perfil, logout } = useAuthStore()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)  // móvil drawer
  const [collapsed,   setCollapsed]   = useState(false)  // tablet collapse

  const rol     = perfil?.rol ?? ''
  const modulos = ROLE_MODULES[rol] ?? []
  const navMods = modulos.filter(m => m !== '→ Panel Admin')

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  /* ── Sidebar compartida (desktop full / tablet icons-only) ─────────── */
  const SidebarContent = ({ iconsOnly = false }) => (
    <aside
      className="flex flex-col h-full"
      style={{ backgroundColor: '#14352A' }}
    >
      {/* Logo */}
      <div className={`border-b border-white/10 flex-shrink-0 ${iconsOnly ? 'px-2 py-4 flex justify-center' : 'px-5 py-5'}`}>
        {iconsOnly ? (
          <div className="w-9 h-9 rounded-xl bg-accent/90 flex items-center justify-center">
            <GearIcon />
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent/90 flex items-center justify-center flex-shrink-0">
              <GearIcon />
            </div>
            <div>
              <p className="text-white font-semibold text-sm leading-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                Compresores del Valle
              </p>
              <p className="text-white/40 text-[10px]">Sistema Operativo</p>
            </div>
          </div>
        )}
      </div>

      {/* Perfil (solo sidebar expandida) */}
      {!iconsOnly && (
        <div className="px-5 py-3.5 border-b border-white/10 flex-shrink-0">
          <p className="text-white font-medium text-sm truncate">{perfil?.nombre}</p>
          <span className="text-xs text-white/40 mt-0.5 inline-block">{rol}</span>
        </div>
      )}

      {/* Menú */}
      <nav className={`flex-1 overflow-y-auto py-3 ${iconsOnly ? 'px-2 space-y-1' : 'px-3 space-y-0.5'}`}>
        {modulos.map(modulo => (
          <SidebarItem key={modulo} modulo={modulo} iconsOnly={iconsOnly} />
        ))}
      </nav>

      {/* Footer */}
      <div className={`border-t border-white/10 flex-shrink-0 py-3 ${iconsOnly ? 'px-2' : 'px-3'}`}>
        {iconsOnly ? (
          <button
            onClick={handleLogout}
            title="Cerrar sesión"
            className="w-11 h-11 mx-auto flex items-center justify-center rounded-xl
                       text-white/40 hover:text-white/80 hover:bg-white/8
                       transition-all duration-150 cursor-pointer"
          >
            <LogoutIcon />
          </button>
        ) : (
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl
                       text-white/50 hover:text-white hover:bg-white/8
                       text-sm font-medium transition-all duration-150 cursor-pointer"
          >
            <LogoutIcon />
            <span>Cerrar sesión</span>
          </button>
        )}
      </div>
    </aside>
  )

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className="flex h-screen bg-surface overflow-hidden">

      {/* ── Desktop sidebar (≥ 1024px) — ancho completo ─────────────── */}
      <div className="hidden lg:flex flex-col w-60 xl:w-64 h-full flex-shrink-0">
        <SidebarContent iconsOnly={false} />
      </div>

      {/* ── Tablet sidebar (640–1023px) — icons-only colapsable ─────── */}
      <div className={`hidden sm:flex lg:hidden flex-col flex-shrink-0 h-full transition-all duration-200 ${collapsed ? 'w-16' : 'w-52'}`}>
        <SidebarContent iconsOnly={collapsed} />
      </div>

      {/* ── Contenido principal ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">

        {/* Header tablet+desktop */}
        <header className="hidden sm:flex items-center justify-between px-5 h-14 border-b border-border bg-white flex-shrink-0">
          <div className="flex items-center gap-3">
            {/* Botón colapsar sidebar (tablet) */}
            <button
              onClick={() => setCollapsed(c => !c)}
              className="lg:hidden p-2 rounded-lg text-text-sub hover:text-text hover:bg-surface transition-colors cursor-pointer"
              aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
            >
              <MenuIcon />
            </button>
            <span className="text-text font-semibold text-sm">{perfil?.nombre}</span>
            <span className="hidden md:inline-block text-xs text-text-muted bg-surface px-2 py-0.5 rounded-full">{rol}</span>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-text-sub hover:text-stock-out text-sm
                       px-3 py-2 rounded-lg hover:bg-stock-out/8 transition-all cursor-pointer"
          >
            <LogoutIcon />
            <span className="hidden md:inline">Salir</span>
          </button>
        </header>

        {/* Header móvil (< 640px) */}
        <header className="sm:hidden flex items-center justify-between px-4 h-14 flex-shrink-0"
                style={{ backgroundColor: '#14352A' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/90 flex items-center justify-center">
              <GearIcon />
            </div>
            <span className="text-white font-semibold text-sm" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
              CDV Gestión
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-white/60 text-xs">{perfil?.nombre?.split(' ')[0]}</span>
            <button
              onClick={handleLogout}
              aria-label="Cerrar sesión"
              className="p-2 text-white/60 hover:text-white transition-colors cursor-pointer"
            >
              <LogoutIcon />
            </button>
          </div>
        </header>

        {/* Área de página */}
        <main className="flex-1 overflow-y-auto pb-20 sm:pb-0">
          <Outlet />
        </main>
      </div>

      {/* ── Bottom Nav móvil (< 640px) ──────────────────────────────── */}
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 border-t border-white/20 z-30 flex-shrink-0"
        style={{ backgroundColor: '#14352A' }}
      >
        <div className="flex">
          {navMods.slice(0, 5).map(modulo => {
            const ruta = MODULE_ROUTES[modulo]
            const icon = MODULE_ICONS[modulo]
            return (
              <NavLink
                key={modulo}
                to={ruta}
                end={ruta === '/ops/inventario'}
                className={({ isActive }) =>
                  `flex-1 flex flex-col items-center justify-center py-2.5 gap-1 min-h-[56px]
                  text-[10px] font-medium transition-colors cursor-pointer
                  ${isActive ? 'text-accent' : 'text-white/45'}`
                }
              >
                <span className="text-[22px] leading-none">{icon}</span>
                <span className="leading-tight text-center">{modulo}</span>
              </NavLink>
            )
          })}
          {rol === 'Admin' && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center py-2.5 gap-1 min-h-[56px]
                text-[10px] font-medium transition-colors cursor-pointer
                ${isActive ? 'text-accent' : 'text-accent/45'}`
              }
            >
              <span className="text-[22px] leading-none">📊</span>
              <span className="leading-tight">Admin</span>
            </NavLink>
          )}
        </div>
      </nav>
    </div>
  )
}
