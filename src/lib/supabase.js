import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ── Timeout de red ───────────────────────────────────────────────────────────
// El `fetch` del navegador NO tiene timeout propio. Si la conexión se cae a
// medio request (wifi inestable en bodega/almacén, el service worker de la PWA
// reactivándose, o el navegador congelando la pestaña en segundo plano), la
// promesa NUNCA se resuelve ni se rechaza: no corre el .catch ni el .finally.
// Como todas las pantallas hacen `finally { setLoading(false) }`, el spinner
// quedaba girando indefinidamente — la "carga casi infinita" que se reportó en
// Compras, que en realidad podía pasar en cualquier pantalla.
//
// Con este wrapper la request se aborta a los 20s y entra al .catch de la
// pantalla, que ya muestra su mensaje de error. El servidor corta a los 8s por
// statement_timeout, así que 20s solo se alcanza cuando algo está realmente
// colgado, nunca por una consulta legítimamente lenta.
const FETCH_TIMEOUT_MS = 20000;

function fetchConTimeout(input, init = {}) {
  const controller = new AbortController();
  let porTimeout = false;
  const timer = setTimeout(() => {
    porTimeout = true;
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  // supabase-js puede traer su propia señal (p.ej. `.abortSignal()`): la
  // encadenamos para no romper esa cancelación.
  const externa = init.signal;
  const onAbortExterno = () => controller.abort();
  if (externa) {
    if (externa.aborted) controller.abort();
    else externa.addEventListener("abort", onAbortExterno, { once: true });
  }

  return fetch(input, { ...init, signal: controller.signal })
    .catch((err) => {
      if (porTimeout) {
        const e = new Error(
          "La conexión tardó demasiado. Revisa tu señal e inténtalo de nuevo.",
        );
        e.name = "TimeoutError";
        throw e;
      }
      throw err;
    })
    .finally(() => {
      clearTimeout(timer);
      if (externa) externa.removeEventListener("abort", onAbortExterno);
    });
}

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
    // Aplica el timeout a TODA petición HTTP (consultas, RPC y auth). No afecta
    // Realtime, que va por WebSocket y tiene su propio manejo de reconexión.
    fetch: fetchConTimeout,
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
