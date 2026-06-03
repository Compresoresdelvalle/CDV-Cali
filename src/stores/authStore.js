import { create } from "zustand";
import { supabase } from "../lib/supabase";
import { EMAIL_BY_UID, EMAIL_MAP } from "../lib/constants";
import { usuarioDisplayName } from "../lib/user-display";

export const useAuthStore = create((set, get) => ({
  // Estado
  session: null,
  user: null, // datos de auth.users
  perfil: null, // datos de la tabla usuarios (rol, sede_id, nombre)
  loading: true,
  error: null,

  // Inicializar: recuperar sesión existente al montar la app
  // Retorna la función de cleanup para cancelar la suscripción
  init: async () => {
    set({ loading: true });
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        const perfil = await get()._fetchPerfil(session.user.id);
        set({ session, user: session.user, perfil, loading: false });
      } else {
        set({ session: null, user: null, perfil: null, loading: false });
      }
    } catch {
      set({ loading: false });
    }

    // Escuchar cambios de sesión (token refresh, logout desde otra pestaña).
    // Se subscribe DESPUÉS de getSession para evitar el doble dispatch
    // INITIAL_SESSION + getSession-resolve que puede confundir el state.
    //
    // IMPORTANTE — NO usar `await` de otras funciones de Supabase dentro de
    // este callback. Supabase lo ejecuta mientras mantiene su lock interno de
    // auth (Web Locks API). Llamar aquí a `supabase.from(...)` o `supabase.auth.*`
    // intenta re-adquirir ese mismo lock → DEADLOCK que congela la app al volver
    // de otra pestaña (al re-enfocar se refresca el token → dispara este callback).
    // Por eso el trabajo asíncrono (consulta del perfil) se difiere con
    // setTimeout(0), para que corra FUERA del lock.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        set({ session: null, user: null, perfil: null });
        return;
      }
      // Refrescamos siempre la referencia de sesión/usuario (token nuevo).
      set({ session, user: session.user });

      // El perfil (rol, sede) solo cambia con un login o una actualización de
      // usuario. INITIAL_SESSION ya fue resuelto por init() y TOKEN_REFRESHED no
      // cambia la identidad, así que evitamos un round-trip innecesario a la BD.
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        setTimeout(async () => {
          const perfil = await get()._fetchPerfil(session.user.id);
          set({ perfil });
        }, 0);
      }
    });

    return () => subscription.unsubscribe();
  },

  // Login con el usuario seleccionado (objeto de la tabla `usuarios`) y PIN.
  // El email se resuelve por `id` (inmutable) y solo como respaldo por nombre,
  // para que renombrar usuarios en el panel de Admin no rompa el login.
  login: async (usuario, pin) => {
    set({ error: null });
    const email = EMAIL_BY_UID[usuario?.id] ?? EMAIL_MAP[usuario?.nombre];
    if (!email) {
      set({ error: "Usuario no encontrado" });
      return false;
    }
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: pin,
    });
    if (error) {
      set({ error: "PIN incorrecto" });
      return false;
    }
    const perfil = await get()._fetchPerfil(data.user.id);
    set({ session: data.session, user: data.user, perfil, error: null });
    return true;
  },

  // Logout: limpia el estado Zustand siempre, incluso si signOut falla
  logout: async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // signOut falló (red, token expirado, etc.) — limpiamos igual
    } finally {
      set({ session: null, user: null, perfil: null, error: null });
    }
  },

  // Limpiar error
  clearError: () => set({ error: null }),

  // Helper privado: obtener perfil de tabla usuarios.
  // Devuelve null si el usuario está desactivado (activo=false) — esto
  // fuerza redirect a /login via RoleGuard cuando un Admin desactiva
  // a un usuario que ya estaba con sesión iniciada.
  _fetchPerfil: async (userId) => {
    const { data, error } = await supabase
      .from("usuarios")
      .select("id, nombre, rol, sede_id, activo")
      .eq("id", userId)
      .single();
    if (error || !data) return null;
    if (data.activo === false) {
      // Cerrar sesión si el usuario fue desactivado
      await supabase.auth.signOut();
      return null;
    }
    return { ...data, nombre: usuarioDisplayName(data) };
  },

  // Helpers de conveniencia (funciones — Zustand no expone reactivamente
  // los `get` accessors definidos en el objeto inicial). Se invocan como
  // `useAuthStore((s) => s.isAuthenticated())`.
  isAuthenticated: () => !!get().session,
  rol: () => get().perfil?.rol ?? null,
  sedeId: () => get().perfil?.sede_id ?? null,
  nombreUsuario: () => get().perfil?.nombre ?? "",
}));
