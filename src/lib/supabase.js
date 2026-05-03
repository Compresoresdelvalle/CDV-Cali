import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // sessionStorage: el token se borra al cerrar la pestaña — protege
    // contra XSS persistente y robo via extensiones; el operario tendrá
    // que volver a hacer login al cerrar la ventana, pero es aceptable
    // para una app industrial con datos sensibles.
    storage: window.sessionStorage,
    storageKey: "compresores-auth",
    flowType: "pkce",
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
  global: {
    headers: { "x-client-info": "compresores-app" },
  },
});

// Refresh global automático: si una request falla con 401, intenta refrescar.
// Sirve como red de seguridad si el autoRefresh interno se queda corto.
let refreshing = false;
supabase.auth.onAuthStateChange((event) => {
  if (event === "TOKEN_REFRESHED" && import.meta.env.DEV) {
    console.log("[supabase] token refrescado");
  }
  if (event === "SIGNED_OUT") {
    refreshing = false;
  }
});

export async function ensureSession() {
  if (refreshing) return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  const expiresAt = data.session.expires_at ?? 0;
  const now = Math.floor(Date.now() / 1000);
  // Si falta menos de 5 minutos, refresca proactivamente
  if (expiresAt - now < 300) {
    refreshing = true;
    try {
      await supabase.auth.refreshSession();
    } finally {
      refreshing = false;
    }
  }
}

// Activar ensureSession cuando la pestaña vuelve a foco — protege contra
// el caso "operario deja la app abierta horas, vuelve y el token expiró".
if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) ensureSession();
  });
  window.addEventListener("focus", () => ensureSession());
}
