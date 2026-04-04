import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { EMAIL_MAP } from '../lib/constants'

export const useAuthStore = create((set, get) => ({
  // Estado
  session: null,
  user: null,       // datos de auth.users
  perfil: null,     // datos de la tabla usuarios (rol, sede_id, nombre)
  loading: true,
  error: null,

  // Inicializar: recuperar sesión existente al montar la app
  // Retorna la función de cleanup para cancelar la suscripción
  init: async () => {
    set({ loading: true })
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        const perfil = await get()._fetchPerfil(session.user.id)
        set({ session, user: session.user, perfil, loading: false })
      } else {
        set({ session: null, user: null, perfil: null, loading: false })
      }
    } catch {
      set({ loading: false })
    }

    // Escuchar cambios de sesión (token refresh, logout desde otra pestaña)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        const perfil = await get()._fetchPerfil(session.user.id)
        set({ session, user: session.user, perfil })
      } else {
        set({ session: null, user: null, perfil: null })
      }
    })

    return () => subscription.unsubscribe()
  },

  // Login con nombre de usuario y PIN (4 dígitos)
  login: async (nombre, pin) => {
    set({ error: null })
    const email = EMAIL_MAP[nombre]
    if (!email) {
      set({ error: 'Usuario no encontrado' })
      return false
    }
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: pin,
    })
    if (error) {
      set({ error: 'PIN incorrecto' })
      return false
    }
    const perfil = await get()._fetchPerfil(data.user.id)
    set({ session: data.session, user: data.user, perfil, error: null })
    return true
  },

  // Logout: limpia el estado Zustand siempre, incluso si signOut falla
  logout: async () => {
    try {
      await supabase.auth.signOut()
    } catch {
      // signOut falló (red, token expirado, etc.) — limpiamos igual
    } finally {
      set({ session: null, user: null, perfil: null, error: null })
    }
  },

  // Limpiar error
  clearError: () => set({ error: null }),

  // Helper privado: obtener perfil de tabla usuarios
  _fetchPerfil: async (userId) => {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, nombre, rol, sede_id, activo')
      .eq('id', userId)
      .single()
    if (error || !data) return null
    return data
  },

  // Helpers de conveniencia
  get isAuthenticated() {
    return !!get().session
  },
  get rol() {
    return get().perfil?.rol ?? null
  },
  get sedeId() {
    return get().perfil?.sede_id ?? null
  },
  get nombreUsuario() {
    return get().perfil?.nombre ?? ''
  },
}))
