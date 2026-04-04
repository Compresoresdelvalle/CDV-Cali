import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { ADMIN_MODULES } from '../../lib/constants'

export default function AdminShell() {
  const { perfil, logout } = useAuthStore()
  const navigate  = useNavigate()
  const location  = useLocation()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#0F0F1F' }}>

      {/* ── Sidebar desktop (≥ md) ── */}
      <aside className="hidden md:flex flex-col w-64 min-h-screen border-r border-white/5"
             style={{ backgroundColor: '#1A1A2E' }}>

        {/* Logo admin */}
        <div className="px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shadow"
                 style={{ backgroundColor: '#E94560' }}>
              📊
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-tight">Panel Admin</p>
              <p className="text-white/40 text-xs">Compresores del Valle</p>
            </div>
          </div>
        </div>

        {/* Perfil */}
        <div className="px-5 py-4 border-b border-white/10">
          <p className="text-white font-semibold text-sm truncate">{perfil?.nombre}</p>
          <span className="text-xs text-white/40 bg-white/10 px-2 py-0.5 rounded-full mt-1 inline-block">
            Administrador
          </span>
        </div>

        {/* Módulos admin */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-1">
          {ADMIN_MODULES.map(({ nombre, icon, ruta }) => (
            <NavLink
              key={ruta}
              to={ruta}
              end={ruta === '/admin'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-150
                ${isActive
                  ? 'text-white'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                }`
              }
              style={({ isActive }) => isActive ? { backgroundColor: '#E9456020' } : {}}
            >
              <span className="text-lg leading-none">{icon}</span>
              <span className="truncate">{nombre}</span>
            </NavLink>
          ))}
        </nav>

        {/* Acciones inferiores */}
        <div className="px-3 pb-5 border-t border-white/10 pt-3 space-y-1">
          <NavLink
            to="/ops"
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl
                       text-white/50 hover:text-white hover:bg-white/5
                       text-sm font-medium transition-all duration-150"
          >
            <span className="text-lg">◀</span>
            <span>← Volver a Operaciones</span>
          </NavLink>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl
                       text-white/40 hover:text-white/70 hover:bg-white/5
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
        <header className="md:hidden flex items-center justify-between px-4 h-14 border-b border-white/10 flex-shrink-0"
                style={{ backgroundColor: '#1A1A2E' }}>
          <div className="flex items-center gap-2">
            <span className="text-lg">📊</span>
            <span className="text-white font-bold text-sm">Panel Admin</span>
          </div>
          <div className="flex items-center gap-2">
            <NavLink
              to="/ops"
              className="text-white/60 hover:text-white text-xs px-2 py-1 rounded-lg bg-white/10"
            >
              ◀ Ops
            </NavLink>
            <button
              onClick={handleLogout}
              className="text-white/60 hover:text-white text-lg p-1"
            >
              🚪
            </button>
          </div>
        </header>

        {/* Página */}
        <main className="flex-1 overflow-y-auto pb-20 md:pb-0" style={{ backgroundColor: '#0F0F1F' }}>
          <Outlet />
        </main>
      </div>

      {/* ── Bottom Nav móvil ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-white/10 z-20"
           style={{ backgroundColor: '#1A1A2E' }}>
        <div className="flex overflow-x-auto">
          {ADMIN_MODULES.slice(0, 5).map(({ nombre, icon, ruta }) => (
            <NavLink
              key={ruta}
              to={ruta}
              end={ruta === '/admin'}
              className={({ isActive }) =>
                `flex-1 min-w-[60px] flex flex-col items-center justify-center py-2 gap-0.5
                text-[10px] font-medium transition-colors duration-150
                ${isActive ? 'text-[#E94560]' : 'text-white/40 active:text-white/70'}`
              }
            >
              <span className="text-xl leading-none">{icon}</span>
              <span className="text-center leading-tight">{nombre.replace('Análisis ', '')}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
