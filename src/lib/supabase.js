import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // localStorage: la sesión se COMPARTE entre pestañas de la misma ventana.
    // Es necesario para poder tener el mismo usuario abierto en varias pestañas
    // a la vez. Con sessionStorage cada pestaña quedaba aislada: la segunda
    // forzaba un re-login que rotaba el refresh token y tumbaba la sesión de la
    // primera ("refresh token already used"). Con localStorage la 2ª pestaña
    // reutiliza la misma sesión y Supabase sincroniza el refresh entre pestañas.
    // Tradeoff: el token sobrevive al cerrar la pestaña hasta que expira el JWT
    // (no es un riesgo nuevo relevante para estos 6 operarios; el JWT igual
    // caduca). Si más adelante se quiere cierre por inactividad, se agrega un
    // idle-timeout que llame a logout(), no se vuelve a sessionStorage.
    storage: window.localStorage,
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
