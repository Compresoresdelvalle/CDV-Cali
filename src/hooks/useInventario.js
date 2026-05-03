import { useEffect, useRef, useCallback } from "react";
import { useInventarioStore } from "../stores/inventarioStore";
import { useAuthStore } from "../stores/authStore";
import { useDebounce } from "./useDebounce";

const SENTINEL = Symbol("init");

/**
 * Hook que orquesta el ciclo de vida del inventario:
 * - Inicializa filtros según el rol del usuario
 * - Dispara re-fetch cuando cambian filtros (sede/estado/categoría)
 * - Debounce de 300ms para la búsqueda
 * - Provee `loadMore` para infinite scroll
 */
export function useInventario() {
  const store = useInventarioStore();
  const perfil = useAuthStore((s) => s.perfil);
  const initiated = useRef(false);

  // Debounce SOLO para disparar el fetch (filtroBusqueda en store se actualiza inmediato)
  const debouncedBusqueda = useDebounce(store.filtroBusqueda, 300);
  const prevDebounced = useRef(SENTINEL);

  // ── Init: una sola vez cuando el perfil está disponible ──────────────
  useEffect(() => {
    if (!perfil || initiated.current) return;
    initiated.current = true;

    if (perfil.rol === "Vendedor" && perfil.sede_id) {
      // Vendedor solo ve su sede → setear filtroSede dispara el effect
      // de re-fetch automáticamente. NO llamar fetchInventario aquí
      // (causaría doble fetch).
      useInventarioStore.setState({
        filtroSede: perfil.sede_id,
        items: [],
        page: 0,
        hasMore: true,
      });
    } else {
      // Admin/Bodeguero: filtroSede ya tiene su valor por defecto, fetch directo
      store.fetchInventario(false);
    }
  }, [perfil]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-fetch cuando cambian sede o estado ────────────────────────────
  useEffect(() => {
    if (!initiated.current) return;
    store.fetchInventario(false);
  }, [store.filtroSede, store.filtroEstado]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-fetch cuando el texto de búsqueda deja de cambiar (debounce) ──
  useEffect(() => {
    if (prevDebounced.current === SENTINEL) {
      // Primer render: solo inicializar el ref, no disparar fetch
      prevDebounced.current = debouncedBusqueda;
      return;
    }
    if (prevDebounced.current === debouncedBusqueda) return;
    prevDebounced.current = debouncedBusqueda;

    if (!initiated.current) return;
    store.fetchInventario(false);
  }, [debouncedBusqueda]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refactor manual: extraemos primitivos para que React Compiler pueda
  // preservar la memoización (evita "Compilation Skipped").
  const hasMore = store.hasMore;
  const loadingMore = store.loadingMore;
  const loading = store.loading;
  const fetchInventario = store.fetchInventario;
  const loadMore = useCallback(() => {
    if (hasMore && !loadingMore && !loading) {
      fetchInventario(true);
    }
  }, [hasMore, loadingMore, loading, fetchInventario]);

  return {
    items: store.items,
    loading: store.loading,
    loadingMore: store.loadingMore,
    hasMore: store.hasMore,
    error: store.error,
    filtroSede: store.filtroSede,
    filtroEstado: store.filtroEstado,
    filtroBusqueda: store.filtroBusqueda,
    setFiltros: store.setFiltros,
    setBusqueda: store.setBusqueda,
    loadMore,
  };
}
