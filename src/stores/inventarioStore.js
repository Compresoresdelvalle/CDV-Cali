import { create } from "zustand";
import { supabase } from "../lib/supabase";
import { applyKeywordSearch } from "../lib/search";

const PAGE_SIZE = 50;

// Tope de la pre-query de texto (ver `fetchInventario`). Si el texto empata con
// más productos que esto, el listado es un recorte: hay que decirlo, no callarlo.
const PRE_QUERY_CAP = 500;

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
  // Total REAL del filtro en el servidor (count: 'exact'), no lo ya cargado.
  total: null,
  // true cuando la búsqueda de texto empató con más de PRE_QUERY_CAP productos
  // y el listado quedó recortado: la UI debe avisar en vez de fingir totalidad.
  truncado: false,

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
      total: null,
      truncado: false,
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
      // Reset loadingMore también: si un fetch de scroll quedó en vuelo cuando
      // el usuario cambió un filtro, su early-return por seq obsoleto no lo
      // limpia. Resetearlo aquí evita que loadMore quede bloqueado para siempre.
      set({
        loading: true,
        error: null,
        items: [],
        page: 0,
        loadingMore: false,
      });
    }

    const seq = ++fetchSeq;

    try {
      const s = get();
      const offset = append ? s.page * PAGE_SIZE : 0;

      // Búsqueda server-side: solo el texto libre exige la pre-query de IDs
      // (con tope de 500 para no generar una URL gigante en el `.in()`). El
      // filtro por tipo NO dispara la pre-query: como casi todo el catálogo es
      // tipo='nuevo', ese tope truncaba el listado a 500 productos en silencio
      // (S4-02). El tipo se aplica directo sobre la query principal más abajo.
      // F12: extiende búsqueda a codigo_interno y codigo_proveedor.
      let productoIds = null;
      const busquedaRaw = s.filtroBusqueda.trim();
      const necesitaPreFiltro = !!busquedaRaw;
      // Sin texto de búsqueda NO hay pre-query, así que no hay recorte posible:
      // hay que APAGAR la bandera aquí. Si no, al limpiar la búsqueda (la X, o
      // borrar el texto) o al cambiar solo el filtro de sede, el banner
      // "Mostrando las primeras 500 de N" se quedaba pegado sobre un listado
      // que ya estaba completo — un aviso falso permanente.
      if (!necesitaPreFiltro) set({ total: null, truncado: false });
      if (necesitaPreFiltro) {
        // `count: 'exact'` devuelve cuántos productos empata el texto EN TOTAL,
        // aunque `.limit()` solo traiga los primeros: así sabemos si el listado
        // quedó recortado en vez de fingir que ya está todo (S4-02).
        let pq = supabase
          .from("productos")
          .select("id", { count: "exact" })
          .eq("activo", true)
          .limit(PRE_QUERY_CAP);
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
        const { data: prods, error: pqError, count: preCount } = await pq;
        if (seq !== fetchSeq) return;
        if (pqError) {
          set({ error: pqError.message, loading: false, loadingMore: false });
          return;
        }
        // S4-02 (bug vivo hasta S12): el `count` de la pre-query nunca se leía,
        // así que la bandera de truncado estaba muerta. Si el texto empata con
        // más de PRE_QUERY_CAP productos, el listado es un recorte y la UI debe
        // avisarlo — si no, el operario cree que el producto no existe.
        set({
          total: preCount ?? null,
          truncado: (preCount ?? 0) > PRE_QUERY_CAP,
        });
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
                             precio_venta, stock_minimo, stock_maximo, activo,
                             stand, posicion, en_piso),
          sede:sedes(id, nombre)
        `,
        )
        .eq("producto.activo", true)
        // Orden estable en el servidor: sin ORDER BY, `.range()` no garantiza
        // las mismas filas en el mismo orden entre páginas del scroll infinito
        // (S4-11). El orden visual final por nombre se hace luego en memoria.
        .order("producto_id", { ascending: true })
        .order("sede_id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      // #34: sede y estado multi-selección.
      if (s.filtroSede.length) q = q.in("sede_id", s.filtroSede);
      if (s.filtroEstado.length) q = q.in("estado_stock", s.filtroEstado);
      if (productoIds) q = q.in("producto_id", productoIds);
      // S4-02: cuando no hubo pre-query de texto, el tipo se filtra directo
      // sobre el join embebido (sin tope de 500).
      else if (s.filtroTipo.length) q = q.in("producto.tipo", s.filtroTipo);

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
      total: null,
      truncado: false,
      filtroSede: [],
      filtroBusqueda: "",
      filtroEstado: [],
      filtroTipo: [],
    }),
}));
