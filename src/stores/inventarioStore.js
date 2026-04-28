import { create } from "zustand";
import { supabase } from "../lib/supabase";
import { sanitizeSearch } from "../lib/utils";

const PAGE_SIZE = 50;

export const useInventarioStore = create((set, get) => ({
  items: [],
  loading: false,
  loadingMore: false,
  hasMore: true,
  page: 0,
  error: null,

  // Filtros
  filtroSede: null,
  filtroBusqueda: "",
  filtroEstado: null,

  // Actualiza filtros de sede/estado y resetea paginación
  setFiltros: (partial) =>
    set((s) => ({
      filtroSede:
        partial.filtroSede !== undefined ? partial.filtroSede : s.filtroSede,
      filtroEstado:
        partial.filtroEstado !== undefined
          ? partial.filtroEstado
          : s.filtroEstado,
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

    try {
      const s = get();
      const offset = append ? s.page * PAGE_SIZE : 0;

      // Búsqueda server-side: primero obtenemos IDs de productos que coinciden
      let productoIds = null;
      const busquedaRaw = s.filtroBusqueda.trim();
      if (busquedaRaw) {
        const busqueda = sanitizeSearch(busquedaRaw);
        const { data: prods } = await supabase
          .from("productos")
          .select("id")
          .or(`nombre.ilike.%${busqueda}%,referencia.ilike.%${busqueda}%`)
          .eq("activo", true);

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

      let q = supabase
        .from("inventario")
        .select(
          `
          id, cantidad, estado_stock, ubicacion_id, sede_id,
          producto:productos(id, referencia, nombre, categoria, marca,
                             precio_venta, stock_minimo, stock_maximo, activo),
          sede:sedes(id, nombre)
        `,
        )
        .range(offset, offset + PAGE_SIZE - 1);

      if (s.filtroSede) q = q.eq("sede_id", s.filtroSede);
      if (s.filtroEstado) q = q.eq("estado_stock", s.filtroEstado);
      if (productoIds) q = q.in("producto_id", productoIds);

      const { data, error } = await q;

      if (error) {
        set({ error: error.message, loading: false, loadingMore: false });
        return;
      }

      // Filtrar productos inactivos y ordenar por nombre en cliente
      const items = (data ?? [])
        .filter((i) => i.producto?.activo !== false)
        .sort((a, b) =>
          (a.producto?.nombre ?? "").localeCompare(
            b.producto?.nombre ?? "",
            "es",
          ),
        );

      if (append) {
        set((prev) => ({
          items: [...prev.items, ...items],
          page: prev.page + 1,
          hasMore: items.length === PAGE_SIZE,
          loadingMore: false,
        }));
      } else {
        set({
          items,
          page: 1,
          hasMore: items.length === PAGE_SIZE,
          loading: false,
        });
      }
    } catch (e) {
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
      filtroSede: null,
      filtroBusqueda: "",
      filtroEstado: null,
    }),
}));
