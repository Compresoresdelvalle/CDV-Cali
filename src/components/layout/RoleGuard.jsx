import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'

/**
 * Guard de roles y autenticación.
 *
 * Props:
 *   roles  — array de roles permitidos. Si omitido, solo requiere autenticación.
 *   children — contenido protegido
 *
 * Lógica:
 *   1. Si loading → spinner de pantalla completa
 *   2. Si no autenticado → /login
 *   3. Si rol no está en la lista → /ops (o /login si tampoco aplica)
 *   4. Si ok → renderiza children
 */
export default function RoleGuard({ roles, children }) {
  const { session, perfil, loading } = useAuthStore()

  // Esperar a que el store inicialice la sesión
  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-text-sub text-sm">Cargando...</p>
        </div>
      </div>
    )
  }

  // Sin sesión → login
  if (!session || !perfil) {
    return <Navigate to="/login" replace />
  }

  // Verificar rol si se especificaron restricciones
  if (roles && roles.length > 0 && !roles.includes(perfil.rol)) {
    // Admin siempre puede ir a cualquier parte de ops
    if (perfil.rol === 'Admin') return <>{children}</>
    return <Navigate to="/ops" replace />
  }

  return <>{children}</>
}
