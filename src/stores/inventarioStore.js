import { create } from "zustand";
import { supabase } from "../lib/supabase";
import { applyKeywordSearch } from "../lib/search";

const PAGE_SIZE = 50;

// Token de versión global: cada fetch toma uno; los resultados de fetches
// obsoletos (el usuario cambió filtros/búsqueda mientras una query iba lenta)
// se descartan al volver.
let fetchSeq = 0;

export const useInventarioStore = create((set, get) => ({
  items: [],
  loading: false,
  loadingMore: false,
  hasMore: true,
  page: 0,
  error: null,

  // Filtros — #34: multi-selección. Arrays vacíos = sin filtro (todos).
  filtroSede: [], // string[] de IDs de sede
  filtroBusqueda: "",
  filtroEstado: [], // string[] de 'OK' | 'Bajo' | 'Agotado'
  filtroTipo: [], // string[] de 'nuevo' | 'segunda_mano'

  // Actualiza filtros de sede/estado/tipo y resetea paginación
  setFiltros: (partial) =>
    set((s) => ({
      filtroSede:
        partial.filtroSede !== undefined ? partial.filtroSede : s.filtroSede,
      filtroEstado:
        partial.filtroEstado !== undefined
          ? partial.filtroEstado
          : s.filtroEstado,
      filtroTipo:
        partial.filtroTipo !== undefined ? partial.filtroTipo : s.filtroTipo,
      filtroBusqueda:
        partial.filtroBusqueda !== undefined
          ? partial.filtroBusqueda
          : s.filtroBusqueda,
      items: [],
      page: 0,
      hasMore: true,
      error: null,
    })),

  // Solo actualiza el texto de búsqueda, sin resetear items
  // (el reset ocurre cuando el valor debounced activa el fetch)
  setBusqueda: (v) => set({ filtroBusqueda: v }),

  // Fetch principal — lee los filtros actuales del estado
  fetchInventario: async (append = false) => {
    const state = get();

    if (append) {
      if (!state.hasMore || state.loadingMore) return;
      set({ loadingMore: true });
    } else {
      set({ loading: true, error: null, items: [], page: 0 });
    }

    const seq = ++fetchSeq;

    try {
      const s = get();
      const offset = append ? s.page * PAGE_SIZE : 0;

      // Búsqueda server-side: primero obtenemos IDs de productos que coinciden
      // F12: extiende búsqueda a codigo_interno y codigo_proveedor.
      // F12: aplica filtro tipo (nuevo/segunda_mano) en la pre-query.
      // Tope de 500 para no generar una URL gigante en el `.in()` posterior.
      let productoIds = null;
      const busquedaRaw = s.filtroBusqueda.trim();
      const necesitaPreFiltro = !!busquedaRaw || s.filtroTipo.length > 0;
      if (necesitaPreFiltro) {
        let pq = supabase
          .from("productos")
          .select("id")
          .eq("activo", true)
          .limit(500);
        if (busquedaRaw) {
          // #32: cada palabra debe aparecer en alguna de estas columnas.
          pq = applyKeywordSearch(pq, busquedaRaw, [
            "nombre",
            "referencia",
            "codigo_interno",
            "codigo_proveedor",
          ]);
        }
        // #34: tipo multi-selección.
        if (s.filtroTipo.length) pq = pq.in("tipo", s.filtroTipo);
        const { data: prods, error: pqError } = await pq;
        if (seq !== fetchSeq) return;
        if (pqError) {
          set({ error: pqError.message, loading: false, loadingMore: false });
          return;
        }
        productoIds = prods?.map((p) => p.id) ?? [];
        if (productoIds.length === 0) {
          set({
            items: [],
            page: 1,
            hasMore: false,
            loading: false,
            loadingMore: false,
          });
          return;
        }
      }

      // `productos!inner` + filtro `activo` → PostgREST descarta las filas de
      // inventario cuyo producto está inactivo. Un join embebido normal solo
      // anularía la relación, dejando filas que truncarían la paginación.
      let q = supabase
        .from("inventario")
        .select(
          `
          id, cantidad, estado_stock, ubicacion_id, sede_id,
          producto:productos!inner(id, referencia, codigo_interno, codigo_proveedor,
                             tipo, nombre, categoria, marca,
                             precio_venta, stock_minimo, stock_maximo, activo),
          sede:sedes(id, nombre)
        `,
        )
        .eq("producto.activo", true)
        .range(offset, offset + PAGE_SIZE - 1);

      // #34: sede y estado multi-selección.
      if (s.filtroSede.length) q = q.in("sede_id", s.filtroSede);
      if (s.filtroEstado.length) q = q.in("estado_stock", s.filtroEstado);
      if (productoIds) q = q.in("producto_id", productoIds);

      const { data, error } = await q;
      if (seq !== fetchSeq) return; // un fetch más nuevo ya está en curso

      if (error) {
        set({ error: error.message, loading: false, loadingMore: false });
        return;
      }

      const raw = data ?? [];
      // Orden por nombre dentro de la página.
      const items = [...raw].sort((a, b) =>
        (a.producto?.nombre ?? "").localeCompare(
          b.producto?.nombre ?? "",
          "es",
        ),
      );

      if (append) {
        set((prev) => ({
          items: [...prev.items, ...items],
          page: prev.page + 1,
          hasMore: raw.length === PAGE_SIZE,
          loadingMore: false,
        }));
      } else {
        set({
          items,
          page: 1,
          hasMore: raw.length === PAGE_SIZE,
          loading: false,
        });
      }
    } catch (e) {
      if (seq !== fetchSeq) return;
      set({ error: e.message, loading: false, loadingMore: false });
    }
  },

  // Actualiza un item en memoria (llamado desde Realtime)
  updateItem: (id, changes) =>
    set((s) => ({
      items: s.items.map((item) =>
        item.id === id ? { ...item, ...changes } : item,
      ),
    })),

  reset: () =>
    set({
      items: [],
      loading: false,
      loadingMore: false,
      hasMore: true,
      page: 0,
      error: null,
      filtroSede: [],
      filtroBusqueda: "",
      filtroEstado: [],
      filtroTipo: [],
    }),
}));
