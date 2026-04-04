import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'

import { useAuthStore } from './stores/authStore'
import Login            from './pages/Login'
import RoleGuard        from './components/layout/RoleGuard'
import AppShell         from './components/layout/AppShell'
import AdminShell       from './components/layout/AdminShell'

// Placeholder genérico para módulos aún no implementados
function Placeholder({ name }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="text-6xl mb-4">🚧</div>
      <h2 className="text-2xl font-bold text-text mb-2">{name}</h2>
      <p className="text-text-sub">Módulo en desarrollo — próximas fases</p>
    </div>
  )
}

export default function App() {
  const init = useAuthStore(s => s.init)

  // Inicializar sesión al montar
  useEffect(() => { init() }, [init])

  return (
    <BrowserRouter>
      <Routes>

        {/* Login público */}
        <Route path="/login" element={<Login />} />

        {/* ── App de Operaciones ── */}
        <Route
          path="/ops"
          element={
            <RoleGuard roles={['Admin', 'Bodeguero', 'Vendedor', 'Tecnico']}>
              <AppShell />
            </RoleGuard>
          }
        >
          <Route index element={<Navigate to="inventario" replace />} />

          <Route path="inventario"
            element={
              <RoleGuard roles={['Admin', 'Bodeguero', 'Vendedor']}>
                <Placeholder name="Inventario" />
              </RoleGuard>
            }
          />
          <Route path="ventas/*"
            element={
              <RoleGuard roles={['Admin', 'Vendedor']}>
                <Placeholder name="Ventas" />
              </RoleGuard>
            }
          />
          <Route path="compras/*"
            element={
              <RoleGuard roles={['Admin', 'Bodeguero']}>
                <Placeholder name="Compras" />
              </RoleGuard>
            }
          />
          <Route path="traspasos/*"
            element={
              <RoleGuard roles={['Admin', 'Bodeguero', 'Vendedor']}>
                <Placeholder name="Traspasos" />
              </RoleGuard>
            }
          />
          <Route path="ordenes/*"
            element={
              <RoleGuard roles={['Admin', 'Tecnico']}>
                <Placeholder name="Órdenes de Servicio" />
              </RoleGuard>
            }
          />
          <Route path="ensambles/*"
            element={
              <RoleGuard roles={['Admin', 'Bodeguero', 'Tecnico']}>
                <Placeholder name="Ensambles" />
              </RoleGuard>
            }
          />
          <Route path="cotizaciones/*"
            element={
              <RoleGuard roles={['Admin', 'Vendedor']}>
                <Placeholder name="Cotizaciones" />
              </RoleGuard>
            }
          />
          <Route path="herramientas" element={<Placeholder name="Herramientas" />} />
          <Route path="devoluciones"
            element={
              <RoleGuard roles={['Admin', 'Bodeguero']}>
                <Placeholder name="Devoluciones" />
              </RoleGuard>
            }
          />
          <Route path="productos"  element={<Placeholder name="Productos" />} />
        </Route>

        {/* ── Panel Admin ── */}
        <Route
          path="/admin"
          element={
            <RoleGuard roles={['Admin']}>
              <AdminShell />
            </RoleGuard>
          }
        >
          <Route index           element={<Placeholder name="Dashboard Admin" />} />
          <Route path="alertas"  element={<Placeholder name="Alertas de Stock" />} />
          <Route path="conteo"   element={<Placeholder name="Conteo Cíclico" />} />
          <Route path="abc"      element={<Placeholder name="Análisis ABC" />} />
          <Route path="reorden"  element={<Placeholder name="Puntos de Reorden" />} />
          <Route path="auditoria" element={<Placeholder name="Auditoría" />} />
          <Route path="usuarios" element={<Placeholder name="Gestión de Usuarios" />} />
          <Route path="top10"    element={<Placeholder name="Top 10 Productos" />} />
        </Route>

        {/* Fallback → login */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
