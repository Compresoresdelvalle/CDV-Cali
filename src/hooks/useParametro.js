import { useState, useEffect } from "react";
import { create } from "zustand";
import { supabase } from "../lib/supabase";

/**
 * Caché en memoria de parámetros del sistema (Fase 9).
 *
 * Las fases 10–17 consumen valores como `iva_pct`, `validez_cotizacion_dias`, etc.
 * Para evitar un round-trip a la BD por cada lectura, mantenemos un store
 * Zustand mínimo que cachea cada par key→value tras su primer fetch.
 *
 * Si el admin cambia un parámetro, debe llamarse `invalidateParametros()` (o
 * `invalidateParametro(key)`) para forzar el siguiente fetch.
 */
const useCache = create(() => ({ params: {} }));

// Dedupe de requests en vuelo: si dos componentes piden la misma key
// simultáneamente en frío, comparten una sola promesa.
const inflight = new Map();

/** Lee un parámetro de la BD (o caché). Retorna `null` si no existe. */
export async function getParametro(key) {
  const { params } = useCache.getState();
  if (params[key] !== undefined) return params[key];
  if (inflight.has(key)) return inflight.get(key);
  const promise = (async () => {
    try {
      const { data, error } = await supabase.rpc("fn_get_parametro", {
        p_key: key,
      });
      if (error) throw error;
      useCache.setState((s) => ({ params: { ...s.params, [key]: data } }));
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

// Suscripción Realtime opcional — invalida caché cuando cambia un parámetro
// en otra tab. Llamar `subscribeParametros()` una vez al iniciar la app.
let realtimeChannel = null;
export function subscribeParametros() {
  if (realtimeChannel) return realtimeChannel;
  realtimeChannel = supabase
    .channel("parametros_sistema_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "parametros_sistema" },
      (payload) => {
        const key = payload.new?.key ?? payload.old?.key;
        if (key) invalidateParametro(key);
      },
    )
    .subscribe();
  return realtimeChannel;
}
export function unsubscribeParametros() {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

/** Lee un parámetro como entero. Retorna `fallback` si no existe o no parseable. */
export async function getParametroInt(key, fallback = 0) {
  const v = await getParametro(key);
  if (v == null) return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

/** Invalida un parámetro específico (vuelve a fetchear la próxima vez). */
export function invalidateParametro(key) {
  useCache.setState((s) => {
    const next = { ...s.params };
    delete next[key];
    return { params: next };
  });
}

/** Invalida toda la caché de parámetros. */
export function invalidateParametros() {
  useCache.setState({ params: {} });
}

/**
 * Hook React para leer un parámetro como string.
 * Devuelve `{ value, loading, error }`.
 *
 * Ejemplo:
 *   const { value: iva, loading } = useParametro('iva_pct');
 */
export function useParametro(key) {
  const [value, setValue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    getParametro(key)
      .then((v) => {
        if (mounted) {
          setValue(v);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (mounted) {
          setError(e);
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [key]);

  return { value, loading, error };
}
