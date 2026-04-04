import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { ROLE_MODULES, MODULE_ICONS, MODULE_ROUTES } from '../../lib/constants'

export default function AppShell() {
  const { perfil, logout } = useAuthStore()
  const navigate = useNavigate()

  const rol = perfil?.rol ?? ''
  const modulos = ROLE_MODULES[rol] ?? []

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  // Módulos de navegación: max 5 en bottom nav móvil (excluye Panel Admin)
  const navModulos = modulos.filter(m => m !== '→ Panel Admin')

  return (
    <div className="flex h-screen bg-surface overflow-hidden">

      {/* ── Sidebar desktop (≥ md) ── */}
      <aside className="hidden md:flex flex-col w-64 min-h-screen"
             style={{ backgroundColor: '#14352A' }}>

        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center text-lg shadow">
              ⚙️
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-tight">Compresores</p>
              <p className="text-white/50 text-xs">del Valle S.A.S.</p>
            </div>
          </div>
        </div>

        {/* Perfil */}
        <div className="px-5 py-4 border-b border-white/10">
          <p className="text-white font-semibold text-sm truncate">{perfil?.nombre}</p>
          <span className="text-xs text-white/50 bg-white/10 px-2 py-0.5 rounded-full mt-1 inline-block">
            {rol}
          </span>
        </div>

        {/* Menú */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-1">
          {modulos.map(modulo => {
            const ruta = MODULE_ROUTES[modulo]
            const icon = MODULE_ICONS[modulo]
            const isAdmin = modulo === '→ Panel Admin'

            return (
              <NavLink
                key={modulo}
                to={ruta}
                end={ruta === '/ops/inventario'}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-150
                  ${isAdmin
                    ? 'mt-2 border border-accent/40 text-accent hover:bg-accent/10'
                    : isActive
                    ? 'bg-white/20 text-white'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                <span className="text-lg leading-none">{icon}</span>
                <span className="truncate">{modulo}</span>
              </NavLink>
            )
          })}
        </nav>

        {/* Cerrar sesión */}
        <div className="px-3 pb-5 border-t border-white/10 pt-3">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl
                       text-white/60 hover:text-white hover:bg-white/10
                       text-sm font-medium transition-all duration-150"
          >
            <span className="text-lg">🚪</span>
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* ── Contenido principal ── */}
      <div className="flex-1 flex flex-col min-h-0">

        {/* Header móvil */}
        <header className="md:hidden flex items-center justify-between px-4 h-14 shadow-sm z-10 flex-shrink-0"
                style={{ backgroundColor: '#14352A' }}>
          <div className="flex items-center gap-2">
            <span className="text-lg">⚙️</span>
            <span className="text-white font-bold text-sm">Compresores del Valle</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-white/70 text-xs">{perfil?.nombre?.split(' ')[0]}</span>
            <button
              onClick={handleLogout}
              className="text-white/70 hover:text-white text-lg transition-colors p-1"
              title="Cerrar sesión"
            >
              🚪
            </button>
          </div>
        </header>

        {/* Página */}
        <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
          <Outlet />
        </main>
      </div>

      {/* ── Bottom Nav móvil (< md) ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-white/20 z-20 safe-area-bottom"
           style={{ backgroundColor: '#14352A' }}>
        <div className="flex">
          {navModulos.slice(0, 5).map(modulo => {
            const ruta  = MODULE_ROUTES[modulo]
            const icon  = MODULE_ICONS[modulo]
            return (
              <NavLink
                key={modulo}
                to={ruta}
                end={ruta === '/ops/inventario'}
                className={({ isActive }) =>
                  `flex-1 flex flex-col items-center justify-center py-2 gap-0.5
                  text-[10px] font-medium transition-colors duration-150
                  ${isActive ? 'text-accent' : 'text-white/50 active:text-white/80'}`
                }
              >
                <span className="text-xl leading-none">{icon}</span>
                <span className="max-w-[56px] text-center leading-tight">{modulo}</span>
              </NavLink>
            )
          })}
          {/* Acceso a Panel Admin para Admin */}
          {rol === 'Admin' && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center py-2 gap-0.5
                text-[10px] font-medium transition-colors
                ${isActive ? 'text-accent' : 'text-accent/50 active:text-accent'}`
              }
            >
              <span className="text-xl leading-none">📊</span>
              <span>Admin</span>
            </NavLink>
          )}
        </div>
      </nav>
    </div>
  )
}
