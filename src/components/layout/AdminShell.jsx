import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { ADMIN_MODULES } from '../../lib/constants'

/* ─── SVG Icons ──────────────────────────────────────────────────────────── */
function LogoutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M6.75 15.75H3.75A1.5 1.5 0 0 1 2.25 14.25V3.75A1.5 1.5 0 0 1 3.75 2.25h3M12 12.75 15.75 9 12 5.25M15.75 9H6.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M11.25 13.5 6.75 9l4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function AdminLogoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.75" />
      <rect x="12.5" y="2" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.75" />
      <rect x="2" y="12.5" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.75" />
      <rect x="12.5" y="12.5" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.75" />
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

/* ─── NavItem admin ──────────────────────────────────────────────────────── */
function AdminNavItem({ nombre, icon, ruta, iconsOnly }) {
  return (
    <NavLink
      to={ruta}
      end={ruta === '/admin'}
      title={iconsOnly ? nombre : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl transition-all duration-150 cursor-pointer
        focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E94560]/40
        ${iconsOnly ? 'justify-center h-11 w-11 mx-auto' : 'px-3 py-3'}
        ${isActive
          ? 'bg-[#E94560]/15 text-white'
          : 'text-white/50 hover:bg-white/5 hover:text-white/80'
        }`
      }
    >
      <span className="text-lg leading-none flex-shrink-0">{icon}</span>
      {!iconsOnly && (
        <span className="text-sm font-medium truncate">{nombre}</span>
      )}
    </NavLink>
  )
}

/* ─── AdminShell ─────────────────────────────────────────────────────────── */
export default function AdminShell() {
  const { perfil, logout } = useAuthStore()
  const navigate  = useNavigate()
  const [collapsed, setCollapsed] = useState(false)

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  /* ── Sidebar content ────────────────────────────────────────────────── */
  const SidebarContent = ({ iconsOnly = false }) => (
    <aside
      className="flex flex-col h-full"
      style={{ backgroundColor: '#1A1A2E', borderRight: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* Logo */}
      <div className={`border-b border-white/8 flex-shrink-0 ${iconsOnly ? 'px-2 py-4 flex justify-center' : 'px-5 py-5'}`}>
        {iconsOnly ? (
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white"
            style={{ backgroundColor: '#E94560' }}
          >
            <AdminLogoIcon />
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-white"
              style={{ backgroundColor: '#E94560' }}
            >
              <AdminLogoIcon />
            </div>
            <div>
              <p className="text-white font-semibold text-sm leading-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                Panel Admin
              </p>
              <p className="text-white/35 text-[10px]">Compresores del Valle</p>
            </div>
          </div>
        )}
      </div>

      {/* Perfil */}
      {!iconsOnly && (
        <div className="px-5 py-3.5 border-b border-white/8 flex-shrink-0">
          <p className="text-white font-medium text-sm truncate">{perfil?.nombre}</p>
          <span className="text-[11px] font-semibold text-[#E94560] mt-0.5 inline-block">Admin</span>
        </div>
      )}

      {/* Módulos */}
      <nav className={`flex-1 overflow-y-auto py-3 ${iconsOnly ? 'px-2 space-y-1' : 'px-3 space-y-0.5'}`}>
        {ADMIN_MODULES.map(({ nombre, icon, ruta }) => (
          <AdminNavItem key={ruta} nombre={nombre} icon={icon} ruta={ruta} iconsOnly={iconsOnly} />
        ))}
      </nav>

      {/* Footer */}
      <div className={`border-t border-white/8 flex-shrink-0 py-3 space-y-0.5 ${iconsOnly ? 'px-2' : 'px-3'}`}>
        {iconsOnly ? (
          <>
            <NavLink
              to="/ops"
              title="Volver a Operaciones"
              className="w-11 h-11 mx-auto flex items-center justify-center rounded-xl
                         text-white/35 hover:text-white/70 hover:bg-white/5 transition-all cursor-pointer"
            >
              <BackIcon />
            </NavLink>
            <button
              onClick={handleLogout}
              title="Cerrar sesión"
              className="w-11 h-11 mx-auto flex items-center justify-center rounded-xl
                         text-white/35 hover:text-white/70 hover:bg-white/5 transition-all cursor-pointer"
            >
              <LogoutIcon />
            </button>
          </>
        ) : (
          <>
            <NavLink
              to="/ops"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl
                         text-white/45 hover:text-white/80 hover:bg-white/5
                         text-sm font-medium transition-all duration-150 cursor-pointer"
            >
              <BackIcon />
              <span>← Volver a Operaciones</span>
            </NavLink>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl
                         text-white/35 hover:text-white/70 hover:bg-white/5
                         text-sm font-medium transition-all duration-150 cursor-pointer"
            >
              <LogoutIcon />
              <span>Cerrar sesión</span>
            </button>
          </>
        )}
      </div>
    </aside>
  )

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#0A0A1A' }}>

      {/* Desktop sidebar (≥ 1024px) */}
      <div className="hidden lg:flex flex-col w-60 xl:w-64 h-full flex-shrink-0">
        <SidebarContent iconsOnly={false} />
      </div>

      {/* Tablet sidebar icons-only colapsable (640–1023px) */}
      <div className={`hidden sm:flex lg:hidden flex-col flex-shrink-0 h-full transition-all duration-200 ${collapsed ? 'w-16' : 'w-52'}`}>
        <SidebarContent iconsOnly={collapsed} />
      </div>

      {/* Contenido */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">

        {/* Header tablet+desktop */}
        <header
          className="hidden sm:flex items-center justify-between px-5 h-14 flex-shrink-0"
          style={{ backgroundColor: '#1A1A2E', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCollapsed(c => !c)}
              className="lg:hidden p-2 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors cursor-pointer"
              aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
            >
              <MenuIcon />
            </button>
            <span className="text-white/80 font-medium text-sm">{perfil?.nombre}</span>
            <span className="text-xs font-semibold text-[#E94560] bg-[#E94560]/10 px-2 py-0.5 rounded-full">Admin</span>
          </div>
          <div className="flex items-center gap-2">
            <NavLink
              to="/ops"
              className="flex items-center gap-1.5 text-white/40 hover:text-white/80 text-sm px-3 py-1.5
                         rounded-lg hover:bg-white/5 transition-all cursor-pointer"
            >
              <BackIcon />
              <span className="hidden md:inline">Operaciones</span>
            </NavLink>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-white/40 hover:text-white/70 text-sm
                         px-3 py-1.5 rounded-lg hover:bg-white/5 transition-all cursor-pointer"
            >
              <LogoutIcon />
              <span className="hidden md:inline">Salir</span>
            </button>
          </div>
        </header>

        {/* Header móvil */}
        <header
          className="sm:hidden flex items-center justify-between px-4 h-14 flex-shrink-0"
          style={{ backgroundColor: '#1A1A2E', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ backgroundColor: '#E94560' }}>
              <AdminLogoIcon />
            </div>
            <span className="text-white font-semibold text-sm" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
              Panel Admin
            </span>
          </div>
          <div className="flex items-center gap-1">
            <NavLink
              to="/ops"
              className="p-2 text-white/45 hover:text-white/80 cursor-pointer"
              title="Volver a Operaciones"
            >
              <BackIcon />
            </NavLink>
            <button
              onClick={handleLogout}
              className="p-2 text-white/45 hover:text-white/80 cursor-pointer"
              aria-label="Cerrar sesión"
            >
              <LogoutIcon />
            </button>
          </div>
        </header>

        {/* Página */}
        <main className="flex-1 overflow-y-auto pb-20 sm:pb-0" style={{ backgroundColor: '#0A0A1A' }}>
          <Outlet />
        </main>
      </div>

      {/* Bottom Nav móvil */}
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-white/8 flex-shrink-0"
        style={{ backgroundColor: '#1A1A2E' }}
      >
        <div className="flex overflow-x-auto">
          {ADMIN_MODULES.slice(0, 5).map(({ nombre, icon, ruta }) => (
            <NavLink
              key={ruta}
              to={ruta}
              end={ruta === '/admin'}
              className={({ isActive }) =>
                `flex-1 min-w-[60px] flex flex-col items-center justify-center py-2.5 gap-1 min-h-[56px]
                text-[10px] font-medium transition-colors cursor-pointer
                ${isActive ? 'text-[#E94560]' : 'text-white/35'}`
              }
            >
              <span className="text-[22px] leading-none">{icon}</span>
              <span className="leading-tight text-center">{nombre.replace('Análisis ', '')}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
